import { z } from 'zod';
import {
  CompleteUploadResponse,
  DeletePreviewDto,
  InitUploadResponse,
  ListChildrenResponse,
  ListDataRoomsResponse,
  ListSharesResponse,
  MeResponse,
  NodeDetailResponse,
  NodeDto,
  NodeStatsDto,
  NodeSortField,
  ResolveShareResponse,
  RetryUploadResponse,
  ShareDto,
  DataRoomDto,
  endpoints,
  isSafeReturnTo,
} from '@dataroom/contracts';
import { apiRequest, buildUrl, type QueryParams } from './api';

/**
 * One typed function per contract endpoint, and no endpoint reachable any other way.
 *
 * Features call these rather than `apiRequest` directly, so the schema a response is parsed with
 * is chosen once, next to the path it belongs to, instead of at each of a dozen call sites.
 */

const NoContent = z.void();

export interface ShareTokenOption {
  shareToken?: string | undefined;
}

// ── auth ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The Google sign-in redirect is a browser navigation, not a fetch: it must leave the SPA. The
 * `returnTo` is round-tripped through OAuth `state` and validated server-side as a same-origin
 * path, so we only ever send one.
 */
export function googleSignInUrl(returnTo?: string): string {
  const query: QueryParams = isSafeReturnTo(returnTo) ? { returnTo } : {};
  return buildUrl(endpoints.auth.googleStart, {}, query);
}

export function getMe(signal?: AbortSignal): Promise<MeResponse> {
  return apiRequest({ endpoint: endpoints.auth.me, schema: MeResponse, signal });
}

export function logout(): Promise<void> {
  return apiRequest({ endpoint: endpoints.auth.logout, schema: NoContent });
}

// ── data rooms ───────────────────────────────────────────────────────────────────────────────

export function listDataRooms(signal?: AbortSignal): Promise<ListDataRoomsResponse> {
  return apiRequest({
    endpoint: endpoints.dataRooms.list,
    schema: ListDataRoomsResponse,
    signal,
  });
}

export function createDataRoom(name: string): Promise<DataRoomDto> {
  return apiRequest({
    endpoint: endpoints.dataRooms.create,
    schema: DataRoomDto,
    body: { name },
  });
}

export function getDataRoom(
  id: string,
  options: ShareTokenOption = {},
  signal?: AbortSignal,
): Promise<DataRoomDto> {
  return apiRequest({
    endpoint: endpoints.dataRooms.get,
    schema: DataRoomDto,
    params: { id },
    shareToken: options.shareToken,
    signal,
  });
}

export function renameDataRoom(id: string, name: string): Promise<DataRoomDto> {
  return apiRequest({
    endpoint: endpoints.dataRooms.update,
    schema: DataRoomDto,
    params: { id },
    body: { name },
  });
}

export function deleteDataRoom(id: string): Promise<void> {
  return apiRequest({ endpoint: endpoints.dataRooms.remove, schema: NoContent, params: { id } });
}

// ── nodes ────────────────────────────────────────────────────────────────────────────────────

export function getNode(
  id: string,
  options: ShareTokenOption = {},
  signal?: AbortSignal,
): Promise<NodeDetailResponse> {
  return apiRequest({
    endpoint: endpoints.nodes.get,
    schema: NodeDetailResponse,
    params: { id },
    shareToken: options.shareToken,
    signal,
  });
}

export interface ListChildrenParams {
  sort?: NodeSortField;
  dir?: 'asc' | 'desc';
  cursor?: string | undefined;
  limit?: number;
  q?: string | undefined;
}

export function listChildren(
  id: string,
  params: ListChildrenParams = {},
  options: ShareTokenOption = {},
  signal?: AbortSignal,
): Promise<ListChildrenResponse> {
  return apiRequest({
    endpoint: endpoints.nodes.children,
    schema: ListChildrenResponse,
    params: { id },
    query: {
      sort: params.sort ?? 'name',
      dir: params.dir ?? 'asc',
      cursor: params.cursor,
      limit: params.limit,
      q: params.q,
    },
    shareToken: options.shareToken,
    signal,
  });
}

export function getNodeStats(
  id: string,
  options: ShareTokenOption = {},
  signal?: AbortSignal,
): Promise<NodeStatsDto> {
  return apiRequest({
    endpoint: endpoints.nodes.stats,
    schema: NodeStatsDto,
    params: { id },
    shareToken: options.shareToken,
    signal,
  });
}

export function getDeletePreview(id: string, signal?: AbortSignal): Promise<DeletePreviewDto> {
  return apiRequest({
    endpoint: endpoints.nodes.deletePreview,
    schema: DeletePreviewDto,
    params: { id },
    signal,
  });
}

export function createFolder(parentId: string, name: string): Promise<NodeDto> {
  return apiRequest({
    endpoint: endpoints.nodes.createFolder,
    schema: NodeDto,
    body: { parentId, name },
  });
}

export function renameNode(id: string, name: string): Promise<NodeDto> {
  return apiRequest({
    endpoint: endpoints.nodes.rename,
    schema: NodeDto,
    params: { id },
    body: { name },
  });
}

export function moveNode(id: string, parentId: string): Promise<NodeDto> {
  return apiRequest({
    endpoint: endpoints.nodes.move,
    schema: NodeDto,
    params: { id },
    body: { parentId },
  });
}

export function deleteNode(id: string): Promise<void> {
  return apiRequest({ endpoint: endpoints.nodes.remove, schema: NoContent, params: { id } });
}

/** URL of the content redirect. Handed to pdf.js, which follows the 302 to the signed URL. */
export function nodeContentUrl(id: string): string {
  return buildUrl(endpoints.nodes.content, { id });
}

export function nodeDownloadUrl(id: string): string {
  return buildUrl(endpoints.nodes.download, { id });
}

// ── uploads ──────────────────────────────────────────────────────────────────────────────────

export interface InitUploadInput {
  parentId: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
}

export function initUpload(input: InitUploadInput): Promise<InitUploadResponse> {
  return apiRequest({
    endpoint: endpoints.uploads.init,
    schema: InitUploadResponse,
    body: input,
  });
}

export function completeUpload(versionId: string): Promise<CompleteUploadResponse> {
  return apiRequest({
    endpoint: endpoints.uploads.complete,
    schema: CompleteUploadResponse,
    params: { versionId },
  });
}

/**
 * Fresh signed URL for the SAME reserved node and version. Retry never re-runs `init`: that
 * reserves a second node and auto-suffixes its name, so a flaky connection would leave
 * `report (2).pdf`, `report (3).pdf` behind.
 */
export function retryUpload(versionId: string): Promise<RetryUploadResponse> {
  return apiRequest({
    endpoint: endpoints.uploads.retry,
    schema: RetryUploadResponse,
    params: { versionId },
  });
}

export function abortUpload(versionId: string): Promise<void> {
  return apiRequest({
    endpoint: endpoints.uploads.abort,
    schema: NoContent,
    params: { versionId },
  });
}

// ── shares ───────────────────────────────────────────────────────────────────────────────────

export function listSharesForNode(
  nodeId: string,
  signal?: AbortSignal,
): Promise<ListSharesResponse> {
  return apiRequest({
    endpoint: endpoints.shares.listForNode,
    schema: ListSharesResponse,
    params: { id: nodeId },
    signal,
  });
}

export function listSharesForRoom(roomId: string, signal?: AbortSignal): Promise<ListSharesResponse> {
  return apiRequest({
    endpoint: endpoints.shares.listForRoom,
    schema: ListSharesResponse,
    params: { id: roomId },
    signal,
  });
}

export interface CreateShareInput {
  type: 'public_link' | 'permissioned';
  expiresAt?: string | null;
  recipients?: string[];
}

export function createShare(nodeId: string, input: CreateShareInput): Promise<ShareDto> {
  return apiRequest({
    endpoint: endpoints.shares.create,
    schema: ShareDto,
    params: { id: nodeId },
    body: {
      type: input.type,
      expiresAt: input.expiresAt ?? null,
      recipients: input.recipients ?? [],
    },
  });
}

export function addShareRecipients(shareId: string, emails: string[]): Promise<ShareDto> {
  return apiRequest({
    endpoint: endpoints.shares.addRecipients,
    schema: ShareDto,
    params: { id: shareId },
    body: { emails },
  });
}

export function revokeShareRecipient(shareId: string, recipientId: string): Promise<void> {
  return apiRequest({
    endpoint: endpoints.shares.revokeRecipient,
    schema: NoContent,
    params: { id: shareId, recipientId },
  });
}

export function revokeShare(shareId: string): Promise<void> {
  return apiRequest({
    endpoint: endpoints.shares.revoke,
    schema: NoContent,
    params: { id: shareId },
  });
}

export function resolveShare(token: string, signal?: AbortSignal): Promise<ResolveShareResponse> {
  return apiRequest({
    endpoint: endpoints.shares.resolve,
    schema: ResolveShareResponse,
    params: { token },
    signal,
  });
}
