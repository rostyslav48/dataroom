import { expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import type { ApiError as ApiErrorDto, ErrorCode } from '@dataroom/contracts';
import {
  ApiError,
  CompleteUploadResponse,
  DataRoomDto,
  DeletePreviewDto,
  InitUploadResponse,
  ListChildrenResponse,
  ListDataRoomsResponse,
  ListSharesResponse,
  MeResponse,
  NodeDetailResponse,
  NodeDto,
  ResolveShareResponse,
  ShareDto,
  ERROR_STATUS,
  SHARE_TOKEN_HEADER,
  endpoints,
} from './contracts';
import { env } from './env';
import { signAccessToken } from './jwt';
import { IDENTITIES, type IdentityName } from './db';

/**
 * The harness's own view of the API.
 *
 * Two jobs. First, arranging a flow's world — creating the room and folders a spec needs, rather
 * than clicking through six dialogs to reach the assertion it actually cares about. Second, making
 * the claims a browser cannot: "the parent is *not* readable" is an absence on screen and a
 * specific status code on the wire, and only one of those is worth asserting.
 *
 * Every response is parsed with its `.strict()` contract schema, so any drift between what the API
 * returns and what the frontend was built against fails here with a legible error instead of
 * surfacing as an undefined three components deep.
 */

export type Caller =
  | { kind: 'user'; identity: IdentityName }
  | { kind: 'anonymous'; shareToken?: string }
  | { kind: 'raw'; bearer: string };

function headersFor(caller: Caller): Record<string, string> {
  switch (caller.kind) {
    case 'user': {
      const { id, email } = IDENTITIES[caller.identity];
      const { jwtAccessSecret, accessTokenTtlSeconds } = env();
      return {
        Authorization: `Bearer ${signAccessToken({ sub: id, email }, jwtAccessSecret, accessTokenTtlSeconds)}`,
      };
    }
    case 'raw':
      return { Authorization: `Bearer ${caller.bearer}` };
    case 'anonymous':
      return caller.shareToken ? { [SHARE_TOKEN_HEADER]: caller.shareToken } : {};
  }
}

export async function contextFor(caller: Caller): Promise<APIRequestContext> {
  // No `baseURL`. Playwright joins with `new URL(path, baseURL)` semantics, so a leading-slash path
  // resolves against the *origin* and silently drops the `/api/v1` prefix — every request would 404
  // in a way that reads like a routing bug in the API. Absolute URLs are built in `Api.absolute`.
  return playwrightRequest.newContext({ extraHTTPHeaders: headersFor(caller) });
}

const fill = (path: string, params: Record<string, string>): string =>
  path.replace(/:([A-Za-z]+)/g, (_match, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`No value for :${key} in ${path}`);
    return encodeURIComponent(value);
  });

/**
 * Just enough of a Zod schema to parse with.
 *
 * `zod` is a dependency of `@dataroom/contracts`, not of `e2e`, and adding it would mean editing
 * the lockfile — Wave-0 property. Structural typing makes that unnecessary: every `.strict()`
 * schema in the contracts package satisfies this interface, and the DTO types still flow through.
 */
interface Schema<T> {
  parse(value: unknown): T;
}

/** Thin wrapper: parse on success, and give a failure a message worth reading. */
export class Api {
  constructor(private readonly context: APIRequestContext) {}

  static async as(caller: Caller): Promise<Api> {
    return new Api(await contextFor(caller));
  }

  dispose(): Promise<void> {
    return this.context.dispose();
  }

  get raw(): APIRequestContext {
    return this.context;
  }

  /** `/nodes/x` → `https://api.example.com/api/v1/nodes/x`. See the note in `contextFor`. */
  absolute(path: string): string {
    return `${env().apiBase}${path}`;
  }

  private async send(
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    options: { data?: unknown; params?: Record<string, string | number> } = {},
  ): Promise<string> {
    const response = await this.context[method](this.absolute(path), {
      ...(options.data === undefined ? {} : { data: options.data }),
      ...(options.params === undefined ? {} : { params: options.params }),
    });

    const body = await response.text();
    if (!response.ok()) {
      throw new Error(`${method.toUpperCase()} ${path} → ${response.status()}\n${body}`);
    }
    return body;
  }

  private async call<T>(
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    schema: Schema<T>,
    options: { data?: unknown; params?: Record<string, string | number> } = {},
  ): Promise<T> {
    return schema.parse(JSON.parse(await this.send(method, path, options)));
  }

  /** For the endpoints that answer 204 — there is no body, so there is nothing to parse. */
  private async callVoid(
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    options: { data?: unknown } = {},
  ): Promise<void> {
    await this.send(method, path, options);
  }

  /**
   * Assert a request is refused, refused *for the stated reason*, and refused with the status the
   * contract maps that reason to.
   *
   * The code matters more than the status: 403 covers FORBIDDEN, ACCESS_REVOKED, SHARE_EXPIRED and
   * WRONG_ACCOUNT, and the frontend renders a different screen for each. A test that accepted any
   * 403 would pass while the user saw the wrong one.
   *
   * The status is asserted too, from `ERROR_STATUS` rather than from a number written here — so the
   * expectation cannot drift from the contract, and a spec that names the wrong code fails on both
   * axes instead of one. Wave 7 QA found three assertions in this suite naming a code the API never
   * returns for that case; this makes that class of mistake louder.
   */
  async expectDenied(
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    code: ErrorCode,
    options: { data?: unknown } = {},
  ): Promise<ApiErrorDto> {
    const response = await this.context[method](this.absolute(path), {
      ...(options.data === undefined ? {} : { data: options.data }),
    });
    const body = await response.text();
    expect(response.ok(), `expected ${code} from ${method.toUpperCase()} ${path}, got ${response.status()} ${body}`).toBe(false);

    const error = ApiError.parse(JSON.parse(body));
    expect(error.code, `${method.toUpperCase()} ${path}`).toBe(code);
    expect(response.status(), `${method.toUpperCase()} ${path} — status for ${code}`).toBe(
      ERROR_STATUS[code],
    );
    return error;
  }

  // ── identity ────────────────────────────────────────────────────────────
  me = () => this.call('get', endpoints.auth.me.path, MeResponse);

  // ── data rooms ──────────────────────────────────────────────────────────
  listRooms = () => this.call('get', endpoints.dataRooms.list.path, ListDataRoomsResponse);
  createRoom = (name: string) =>
    this.call('post', endpoints.dataRooms.create.path, DataRoomDto, { data: { name } });
  deleteRoom = (id: string) =>
    this.callVoid('delete', fill(endpoints.dataRooms.remove.path, { id }));

  // ── nodes ───────────────────────────────────────────────────────────────
  node = (id: string) => this.call('get', fill(endpoints.nodes.get.path, { id }), NodeDetailResponse);
  children = (id: string, params: Record<string, string | number> = {}) =>
    this.call('get', fill(endpoints.nodes.children.path, { id }), ListChildrenResponse, { params });
  deletePreview = (id: string) =>
    this.call('get', fill(endpoints.nodes.deletePreview.path, { id }), DeletePreviewDto);
  createFolder = (parentId: string, name: string) =>
    this.call('post', endpoints.nodes.createFolder.path, NodeDto, { data: { parentId, name } });
  rename = (id: string, name: string) =>
    this.call('patch', fill(endpoints.nodes.rename.path, { id }), NodeDto, { data: { name } });
  remove = (id: string) => this.callVoid('delete', fill(endpoints.nodes.remove.path, { id }));

  // ── shares ──────────────────────────────────────────────────────────────
  sharesOf = (id: string) =>
    this.call('get', fill(endpoints.shares.listForNode.path, { id }), ListSharesResponse);
  createPublicLink = (nodeId: string, expiresAt: string | null = null) =>
    this.call('post', fill(endpoints.shares.create.path, { id: nodeId }), ShareDto, {
      data: { type: 'public_link', expiresAt, recipients: [] },
    });
  createPermissionedShare = (nodeId: string, recipients: string[], expiresAt: string | null = null) =>
    this.call('post', fill(endpoints.shares.create.path, { id: nodeId }), ShareDto, {
      data: { type: 'permissioned', expiresAt, recipients },
    });
  sharesOfRoom = (id: string) =>
    this.call('get', fill(endpoints.shares.listForRoom.path, { id }), ListSharesResponse);
  addRecipients = (shareId: string, emails: string[]) =>
    this.call('post', fill(endpoints.shares.addRecipients.path, { id: shareId }), ShareDto, {
      data: { emails },
    });
  revokeRecipient = (shareId: string, recipientId: string) =>
    this.callVoid('delete', fill(endpoints.shares.revokeRecipient.path, { id: shareId, recipientId }));
  revokeShare = (shareId: string) =>
    this.callVoid('delete', fill(endpoints.shares.revoke.path, { id: shareId }));
  resolveShare = (token: string) =>
    this.call('get', fill(endpoints.shares.resolve.path, { token }), ResolveShareResponse);

  // ── uploads ─────────────────────────────────────────────────────────────
  initUpload = (body: { parentId: string; name: string; sizeBytes: number; mimeType: string }) =>
    this.call('post', endpoints.uploads.init.path, InitUploadResponse, { data: body });
  completeUpload = (versionId: string) =>
    this.call('post', fill(endpoints.uploads.complete.path, { versionId }), CompleteUploadResponse);
}

/** The token in a public link's `url`, which is all `/s/:token` needs. */
export function tokenFromShareUrl(url: string | null): string {
  if (url === null) throw new Error('Share has no url — was it created as a public link, or revoked?');
  const token = url.split('/s/')[1];
  if (!token) throw new Error(`Not a share url: ${url}`);
  return token.replace(/[/?#].*$/, '');
}

export { fill as fillPath };
