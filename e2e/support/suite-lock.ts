import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:net';

const LOOPBACK = '127.0.0.1';
const LOCK_PORT_MIN = 41_000;
const LOCK_PORT_COUNT = 10_000;

export interface ShareResolveProcessLockOptions {
  port: number;
  retryIntervalMs?: number;
  timeoutMs?: number;
  onWait?: (message: string) => void;
}

export interface ShareResolveProcessLock {
  readonly port: number;
  release(): Promise<void>;
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error(
      `The E2E share-resolve lock port must be an integer from 1024 to 65535; got ${port}.`,
    );
  }
}

/** Stable per target (or explicit source-IP key), without needing a shared file or new dependency. */
export function shareResolveLockPort(key: string): number {
  const digest = createHash('sha256').update(key).digest();
  return LOCK_PORT_MIN + (digest.readUInt32BE(0) % LOCK_PORT_COUNT);
}

function listen(port: number): Promise<Server | null> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        resolve(null);
        return;
      }
      reject(error);
    });
    server.listen(port, LOOPBACK, () => resolve(server));
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Hold an OS-managed loopback listener for the complete Playwright invocation.
 *
 * Two independent runner processes on one host cannot bind the same port, so only one reaches the
 * source-IP-limited share endpoint at a time. The OS releases the listener even after an abrupt
 * process exit, unlike a lock file that can strand a stale lease. Distributed runners still need
 * their CI provider's concurrency primitive because no local lock can cross host boundaries.
 */
export async function acquireShareResolveProcessLock({
  port,
  retryIntervalMs = 250,
  timeoutMs = 30 * 60_000,
  onWait = () => undefined,
}: ShareResolveProcessLockOptions): Promise<ShareResolveProcessLock> {
  validatePort(port);
  if (!Number.isFinite(retryIntervalMs) || retryIntervalMs <= 0) {
    throw new Error(
      `The E2E share-resolve lock retry interval must be positive; got ${retryIntervalMs}.`,
    );
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error(`The E2E share-resolve lock timeout cannot be negative; got ${timeoutMs}.`);
  }

  const deadline = Date.now() + timeoutMs;
  let announcedWait = false;

  let server = await listen(port);
  while (server === null) {
    if (!announcedWait) {
      announcedWait = true;
      onWait(
        `Another Playwright process holds the share-resolve lock on ${LOOPBACK}:${port}; waiting for it to finish.`,
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for the E2E share-resolve lock on ${LOOPBACK}:${port}. ` +
          'Set E2E_SHARE_LOCK_PORT to a different unused port only if this listener is unrelated.',
      );
    }
    await delay(Math.min(retryIntervalMs, Math.max(1, deadline - Date.now())));
    server = await listen(port);
  }

  let released = false;
  return {
    port,
    release: async () => {
      if (released) return;
      released = true;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
