import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from './tokenStore';

afterEach(() => {
  tokenStore.clear();
  vi.restoreAllMocks();
});

describe('tokenStore', () => {
  it('holds the token in memory and returns it', () => {
    tokenStore.set('abc', '2026-01-15T10:15:00.000Z');
    expect(tokenStore.get()).toBe('abc');
    expect(tokenStore.expiresAt()).toBe(Date.parse('2026-01-15T10:15:00.000Z'));
  });

  it('clears both the token and the expiry', () => {
    tokenStore.set('abc');
    tokenStore.clear();
    expect(tokenStore.get()).toBeNull();
    expect(tokenStore.expiresAt()).toBeNull();
  });

  it('writes nothing to web storage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    tokenStore.set('abc', '2026-01-15T10:15:00.000Z');
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
