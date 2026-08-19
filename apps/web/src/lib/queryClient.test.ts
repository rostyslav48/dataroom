import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusManager, QueryObserver } from '@tanstack/react-query';
import { createQueryClient } from './queryClient';

afterEach(() => {
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

describe('createQueryClient', () => {
  it('reuses fresh data for ten seconds, then fetches it again once stale', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-19T00:00:00Z'));
    const client = createQueryClient();
    const queryKey = ['policy', 'cache-window'] as const;
    const fetchValue = vi.fn().mockResolvedValue('fresh');

    client.setQueryData(queryKey, 'cached');
    vi.advanceTimersByTime(9_999);

    await expect(client.fetchQuery({ queryKey, queryFn: fetchValue })).resolves.toBe('cached');
    expect(fetchValue).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2);
    await expect(client.fetchQuery({ queryKey, queryFn: fetchValue })).resolves.toBe('fresh');
    expect(fetchValue).toHaveBeenCalledOnce();

    client.clear();
  });

  it('refetches an observed stale query when window focus returns', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-19T00:00:00Z'));
    focusManager.setFocused(false);

    const client = createQueryClient();
    const queryKey = ['policy', 'focus'] as const;
    const fetchValue = vi.fn().mockResolvedValue('after-focus');
    client.setQueryData(queryKey, 'cached');
    client.mount();

    const observer = new QueryObserver(client, { queryKey, queryFn: fetchValue });
    const unsubscribe = observer.subscribe(() => undefined);

    try {
      vi.advanceTimersByTime(9_999);
      focusManager.setFocused(true);
      await Promise.resolve();
      expect(fetchValue).not.toHaveBeenCalled();

      focusManager.setFocused(false);
      vi.advanceTimersByTime(2);
      focusManager.setFocused(true);
      await vi.waitFor(() => {
        expect(fetchValue).toHaveBeenCalledOnce();
      });
      expect(observer.getCurrentResult().data).toBe('after-focus');
    } finally {
      unsubscribe();
      client.unmount();
      client.clear();
    }
  });

  it('surfaces failed queries and mutations after their first attempt', async () => {
    const client = createQueryClient();
    const query = vi.fn().mockRejectedValue(new Error('query failed'));
    const mutation = vi.fn().mockRejectedValue(new Error('mutation failed'));

    await expect(
      client.fetchQuery({ queryKey: ['policy', 'query-retry'], queryFn: query }),
    ).rejects.toThrow('query failed');
    await expect(
      client.getMutationCache().build(client, { mutationFn: mutation }).execute(undefined),
    ).rejects.toThrow('mutation failed');

    expect(query).toHaveBeenCalledOnce();
    expect(mutation).toHaveBeenCalledOnce();
    client.clear();
  });
});
