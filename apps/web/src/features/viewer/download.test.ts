import { afterEach, describe, expect, it, vi } from 'vitest';
import { SHARE_TOKEN_HEADER } from '@dataroom/contracts';
import { tokenStore } from '@/lib/tokenStore';
import { downloadNode } from './download';

vi.mock('@/lib/browser', () => ({ saveBlob: vi.fn() }));

const { saveBlob } = await import('@/lib/browser');

afterEach(() => {
  tokenStore.clear();
  vi.restoreAllMocks();
});

describe('downloadNode', () => {
  it('omits credentials across the signed-storage redirect', async () => {
    tokenStore.set('access-token', '2026-08-19T19:00:00.000Z');
    const response = new Response('file bytes', { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

    await downloadNode('node-1', 'report.pdf', 'share-token');

    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/nodes/node-1/download'), {
      credentials: 'omit',
      headers: {
        Authorization: 'Bearer access-token',
        [SHARE_TOKEN_HEADER]: 'share-token',
      },
    });
    expect(saveBlob).toHaveBeenCalledOnce();
    const [blob, filename] = vi.mocked(saveBlob).mock.calls[0]!;
    expect(filename).toBe('report.pdf');
    expect(blob.size).toBe(10);
    expect(await blob.text()).toBe('file bytes');
  });
});
