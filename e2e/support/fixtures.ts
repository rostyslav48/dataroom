import { randomBytes } from 'node:crypto';
import { test as base, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { DataRoomDto, NodeDto } from '@dataroom/contracts';
import { fixtures } from './contracts';
import { Api } from './api';
import { env } from './env';
import { signIn, type Session } from './session';
import {
  assertShareResolveTopology,
  protectShareResolveBrowserContext,
} from './shared-route';
import { ui, type Ui } from './selectors';
import type { IdentityName } from './db';

/**
 * Shared arrangement for the five flows.
 *
 * ## Where the data comes from
 *
 * The canonical fixture tree — Project Atlas, Legal/NDA.pdf, Financials/Q3/balance-sheet.pdf,
 * overview.pdf — is built by `pnpm db:seed` from `contracts/fixtures.ts`, the same file the
 * backend's integration tests seed and the frontend's MSW handlers serve. This suite invents no
 * sample data of its own: a fixture only one side uses proves nothing about the other.
 *
 * ## Why each spec still builds its own subtree
 *
 * Three of the five flows are destructive — they rename, revoke and delete. Mutating the shared
 * fixture tree would make the suite pass once and then fail until someone re-seeded, which is the
 * fastest way to teach a team to ignore a red E2E run. So specs read the fixture tree, and *write*
 * only inside a scratch folder they created and tear down afterwards. The suite is re-runnable
 * against a long-lived deployed environment, which is what INT-5 requires of it.
 */

export interface RoomHandle {
  room: DataRoomDto;
  rootNodeId: string;
}

export interface Scratch {
  /** A folder created under the fixture room's root, deleted after the test. */
  folder: NodeDto;
  /** Unique per test, so parallel or repeated runs never collide on a sibling name. */
  prefix: string;
}

interface Fixtures {
  ownerApi: Api;
  viewerApi: Api;
  strangerApi: Api;
  /** Anonymous caller, optionally carrying a public-link token in `X-Share-Token`. */
  anonymousApi: (shareToken?: string) => Promise<Api>;
  room: RoomHandle;
  scratch: Scratch;
}

interface WorkerFixtures {
  shareResolveTopology: void;
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  shareResolveTopology: [
    async ({}, use, workerInfo) => {
      assertShareResolveTopology(workerInfo.config);
      await use();
    },
    { scope: 'worker', auto: true },
  ],

  ownerApi: async ({}, use) => {
    const api = await Api.as({ kind: 'user', identity: 'owner' });
    await use(api);
    await api.dispose();
  },

  viewerApi: async ({}, use) => {
    const api = await Api.as({ kind: 'user', identity: 'viewer' });
    await use(api);
    await api.dispose();
  },

  strangerApi: async ({}, use) => {
    const api = await Api.as({ kind: 'user', identity: 'stranger' });
    await use(api);
    await api.dispose();
  },

  anonymousApi: async ({}, use) => {
    const created: Api[] = [];
    await use(async (shareToken?: string) => {
      const api = await Api.as(
        shareToken === undefined ? { kind: 'anonymous' } : { kind: 'anonymous', shareToken },
      );
      created.push(api);
      return api;
    });
    for (const api of created) await api.dispose();
  },

  room: async ({ ownerApi }, use) => {
    const rooms = await ownerApi.listRooms();
    const room = rooms.owned.find((candidate) => candidate.id === fixtures.IDS.room);

    expect(
      room,
      'The canonical fixture room is missing from this environment. Run `pnpm db:seed` against ' +
        'the database the API under test is using — every spec reads the fixture tree.',
    ).toBeDefined();

    await use({ room: room as DataRoomDto, rootNodeId: (room as DataRoomDto).rootNodeId });
  },

  scratch: async ({ ownerApi, room }, use, testInfo) => {
    const prefix = `e2e-${testInfo.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 24)}-${randomBytes(3).toString('hex')}`;
    const folder = await ownerApi.createFolder(room.rootNodeId, prefix);

    await use({ folder, prefix });

    // Best-effort: a spec whose whole point is deleting this folder will already have removed it.
    await ownerApi.remove(folder.id).catch(() => undefined);
  },
});

export { expect };

/** A browser context that has been signed in, plus its page and locator registry. */
export interface OpenedAs {
  context: BrowserContext;
  page: Page;
  ui: Ui;
  session: Session;
}

export async function openAs(browser: Browser, identity: IdentityName): Promise<OpenedAs> {
  const context = await browser.newContext({ baseURL: env().webUrl });
  await protectShareResolveBrowserContext(context);
  const session = await signIn(context, identity);
  const page = await context.newPage();
  return { context, page, ui: ui(page), session };
}

/**
 * A context with no session of any kind — the state a public link is actually opened in.
 *
 * `newContext` is genuinely clean in Playwright: no cookies, no storage, no service workers carried
 * over from another test. That matters here, because "the recipient could still read it" and "the
 * recipient's browser had it cached" are the two outcomes flow 3 has to tell apart.
 */
export async function openAnonymous(browser: Browser): Promise<Omit<OpenedAs, 'session'>> {
  const context = await browser.newContext({ baseURL: env().webUrl });
  await protectShareResolveBrowserContext(context);
  const page = await context.newPage();
  return { context, page, ui: ui(page) };
}

export { ui, routes } from './selectors';
export { Api, tokenFromShareUrl } from './api';
export { env } from './env';
