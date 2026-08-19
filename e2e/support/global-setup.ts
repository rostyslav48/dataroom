import type { FullConfig } from '@playwright/test';
import { acquireShareResolveProcessLock, shareResolveLockPort } from './suite-lock';

function integerEnvironment(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer; got ${raw}.`);
  return value;
}

/** Serialize whole Playwright invocations before any worker can consume the shared IP quota. */
export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  const apiTarget = (process.env.E2E_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  const key = process.env.E2E_SHARE_LOCK_KEY ?? apiTarget;
  const port = integerEnvironment('E2E_SHARE_LOCK_PORT', shareResolveLockPort(key));
  const timeoutMs = integerEnvironment('E2E_SHARE_LOCK_TIMEOUT_MS', 30 * 60_000);
  const lock = await acquireShareResolveProcessLock({
    port,
    timeoutMs,
    onWait: (message) => console.log(message),
  });

  return () => lock.release();
}
