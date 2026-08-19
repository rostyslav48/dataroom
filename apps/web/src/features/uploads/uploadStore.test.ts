import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { UPLOAD_CONCURRENCY, fixtures } from '@dataroom/contracts';
import { useMockApi } from '@/test/msw';
import { FakeXhr, installFakeXhr, restoreXhr } from '@/test/fakeXhr';
import { childrenOf, state } from '@/mocks/db';
import { forceError } from '@/mocks/errorMode';
import { aggregateProgress, uploadIsActive, useUploadStore } from './uploadStore';

useMockApi();

const { IDS } = fixtures;

function pdf(name: string, size = 1024): File {
  return new File([new Uint8Array(size)], name, { type: 'application/pdf' });
}

const store = () => useUploadStore.getState();

beforeEach(() => {
  installFakeXhr();
  useUploadStore.getState().reset();
  useUploadStore.getState().setInvalidator(null);
});

afterEach(() => {
  useUploadStore.getState().reset();
  restoreXhr();
});

async function waitForStatus(index: number, status: string): Promise<void> {
  await waitFor(() => {
    expect(store().items[index]?.status).toBe(status);
  });
}

describe('upload queue', () => {
  it('creates a row per file immediately, three uploading and the rest queued', async () => {
    store().enqueue(
      Array.from({ length: 8 }, (_, index) => pdf(`file-${String(index)}.pdf`)),
      IDS.rootNode,
    );

    expect(store().items).toHaveLength(8);
    await waitFor(() => {
      const uploading = store().items.filter((item) => item.status === 'uploading');
      expect(uploading).toHaveLength(UPLOAD_CONCURRENCY);
    });
    expect(store().items.filter((item) => item.status === 'queued')).toHaveLength(5);
  });

  it('starts a queued file as soon as one in flight finishes', async () => {
    store().enqueue(
      Array.from({ length: 4 }, (_, index) => pdf(`file-${String(index)}.pdf`)),
      IDS.rootNode,
    );
    await waitFor(() => {
      expect(FakeXhr.instances).toHaveLength(UPLOAD_CONCURRENCY);
    });

    FakeXhr.instances[0]?.succeed();
    await waitFor(() => {
      expect(FakeXhr.instances).toHaveLength(4);
    });
  });

  it('reports progress from real XHR progress events', async () => {
    store().enqueue([pdf('report.pdf', 2048)], IDS.rootNode);
    await waitFor(() => {
      expect(FakeXhr.instances).toHaveLength(1);
    });

    FakeXhr.last().emitProgress(512, 2048);
    await waitFor(() => {
      expect(store().items[0]?.progress).toBe(25);
    });

    FakeXhr.last().emitProgress(1536, 2048);
    await waitFor(() => {
      expect(store().items[0]?.progress).toBe(75);
    });
  });

  it('uploads a zero-byte file without dividing by zero', async () => {
    store().enqueue([new File([], 'empty.pdf', { type: 'application/pdf' })], IDS.rootNode);
    await waitFor(() => {
      expect(FakeXhr.instances).toHaveLength(1);
    });

    FakeXhr.last().emitProgress(0, 0, false);
    expect(store().items[0]?.progress).toBe(100);

    FakeXhr.last().succeed();
    await waitForStatus(0, 'done');
  });

  it('completes the upload and makes the file visible in the folder', async () => {
    store().enqueue([pdf('new-doc.pdf')], IDS.rootNode);
    await waitFor(() => {
      expect(FakeXhr.instances).toHaveLength(1);
    });
    FakeXhr.last().succeed();

    await waitForStatus(0, 'done');
    expect(childrenOf(IDS.rootNode).map((node) => node.name)).toContain('new-doc.pdf');
  });

  it('invalidates the folder it uploaded into', async () => {
    const invalidate = vi.fn();
    store().setInvalidator(invalidate);
    store().enqueue([pdf('new-doc.pdf')], IDS.rootNode);
    await waitFor(() => {
      expect(FakeXhr.instances).toHaveLength(1);
    });
    FakeXhr.last().succeed();

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith(IDS.rootNode);
    });
  });

  it('surfaces the auto-suffixed name the server reserved', async () => {
    store().enqueue([pdf('overview.pdf')], IDS.rootNode);
    await waitFor(() => {
      expect(store().items[0]?.finalName).toBe('overview (2).pdf');
    });
    expect(store().items[0]?.requestedName).toBe('overview.pdf');
  });
});

describe('client-side rejection', () => {
  it('fails an oversize file in its own row while the others continue', async () => {
    const huge = new File([new Uint8Array(10)], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(huge, 'size', { value: 200_000_000 });

    store().enqueue([huge, pdf('fine.pdf')], IDS.rootNode);

    expect(store().items[0]?.status).toBe('error');
    expect(store().items[0]?.error?.code).toBe('FILE_TOO_LARGE');
    await waitForStatus(1, 'uploading');
  });

  it('fails an unsupported type in its own row, with a reason', () => {
    const exe = new File([new Uint8Array(4)], 'installer.exe', { type: 'application/x-msdownload' });
    store().enqueue([exe], IDS.rootNode);

    expect(store().items[0]?.status).toBe('error');
    expect(store().items[0]?.error?.code).toBe('UNSUPPORTED_TYPE');
    expect(FakeXhr.instances).toHaveLength(0);
  });
});

describe('failure, retry and cancel', () => {
  it('marks a transport failure as an error with a retryable row', async () => {
    store().enqueue([pdf('flaky.pdf')], IDS.rootNode);
    await waitFor(() => {
      expect(FakeXhr.instances).toHaveLength(1);
    });

    FakeXhr.last().networkError();
    await waitForStatus(0, 'error');
    expect(store().items[0]?.error?.code).toBe('NETWORK');
  });

  it('retries through /uploads/:versionId/retry and never through init', async () => {
    const initCalls: string[] = [];
    const retryCalls: string[] = [];
    const originalFetch = globalThis.fetch.bind(globalThis);
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/uploads/init')) initCalls.push(url);
        if (url.endsWith('/retry')) retryCalls.push(url);
        return originalFetch(input, init);
      }),
    );

    store().enqueue([pdf('flaky.pdf')], IDS.rootNode);
    await waitFor(() => {
      expect(FakeXhr.instances).toHaveLength(1);
    });
    const versionId = store().items[0]?.versionId;
    expect(versionId).toBeDefined();

    FakeXhr.last().networkError();
    await waitForStatus(0, 'error');

    store().retry(store().items[0]?.localId ?? '');
    await waitFor(() => {
      expect(retryCalls).toHaveLength(1);
    });
    expect(initCalls).toHaveLength(1);
    expect(retryCalls[0]).toContain(versionId);

    await waitFor(() => {
      expect(FakeXhr.instances).toHaveLength(2);
    });
    FakeXhr.last().succeed();
    await waitForStatus(0, 'done');

    // The retry reused the reserved node: exactly one file, and no "(2)" copy beside it.
    expect(childrenOf(IDS.rootNode).filter((node) => node.name.startsWith('flaky'))).toHaveLength(1);
    expect(store().items[0]?.versionId).toBe(versionId);
  });

  it('re-queues rather than retrying when init itself failed, since no node was reserved', async () => {
    forceError('INTERNAL', { endpointKey: 'uploads.init', times: 1 });
    store().enqueue([pdf('doomed.pdf')], IDS.rootNode);
    await waitForStatus(0, 'error');
    expect(store().items[0]?.versionId).toBeUndefined();

    store().retry(store().items[0]?.localId ?? '');
    await waitFor(() => {
      expect(FakeXhr.instances).toHaveLength(1);
    });
    FakeXhr.last().succeed();
    await waitForStatus(0, 'done');
    expect(childrenOf(IDS.rootNode).filter((node) => node.name.startsWith('doomed'))).toHaveLength(1);
  });

  it('cancel aborts the request and tells the server to abandon the version', async () => {
    store().enqueue([pdf('cancel-me.pdf')], IDS.rootNode);
    await waitFor(() => {
      expect(FakeXhr.instances).toHaveLength(1);
    });
    const versionId = store().items[0]?.versionId ?? '';

    store().cancel(store().items[0]?.localId ?? '');

    expect(FakeXhr.last().aborted).toBe(true);
    expect(store().items[0]?.status).toBe('canceled');
    await waitFor(() => {
      expect(state.uploads.get(versionId)?.aborted).toBe(true);
    });
    expect(childrenOf(IDS.rootNode).map((node) => node.name)).not.toContain('cancel-me.pdf');
  });

  it('reports a server-side rejection at init with the contract code', async () => {
    forceError('FILE_TOO_LARGE', { endpointKey: 'uploads.init', times: 1 });
    store().enqueue([pdf('rejected.pdf')], IDS.rootNode);
    await waitForStatus(0, 'error');
    expect(store().items[0]?.error?.code).toBe('FILE_TOO_LARGE');
  });
});

describe('queue bookkeeping', () => {
  it('knows when uploads are in flight', async () => {
    expect(uploadIsActive(store().items)).toBe(false);
    store().enqueue([pdf('a.pdf')], IDS.rootNode);
    expect(uploadIsActive(store().items)).toBe(true);

    await waitFor(() => {
      expect(FakeXhr.instances).toHaveLength(1);
    });
    FakeXhr.last().succeed();
    await waitForStatus(0, 'done');
    expect(uploadIsActive(store().items)).toBe(false);
  });

  it('averages progress across the queue for the panel header', () => {
    expect(aggregateProgress([])).toBe(0);
    store().enqueue([pdf('a.pdf'), pdf('b.pdf')], IDS.rootNode);
    expect(aggregateProgress(store().items)).toBe(0);
  });

  it('dismisses one row and clears the finished ones', async () => {
    store().enqueue([pdf('a.pdf'), pdf('b.pdf')], IDS.rootNode);
    await waitFor(() => {
      expect(FakeXhr.instances).toHaveLength(2);
    });
    FakeXhr.instances[0]?.succeed();
    await waitForStatus(0, 'done');

    store().clearFinished();
    expect(store().items.some((item) => item.status === 'done')).toBe(false);

    const remaining = store().items[0]?.localId ?? '';
    store().dismiss(remaining);
    expect(store().items.find((item) => item.localId === remaining)).toBeUndefined();
  });

  it('does not publish a stale failure after reset aborts an in-flight PUT', async () => {
    store().enqueue([pdf('a.pdf')], IDS.rootNode);
    await waitFor(() => {
      expect(FakeXhr.instances).toHaveLength(1);
    });

    const updates = vi.fn();
    const unsubscribe = useUploadStore.subscribe(updates);
    store().reset();
    const updatesAtReset = updates.mock.calls.length;

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(FakeXhr.last().aborted).toBe(true);
    expect(store().items).toEqual([]);
    expect(updates).toHaveBeenCalledTimes(updatesAtReset);
    unsubscribe();
  });

  it('keeps the queue across a folder change, because it lives outside the page', async () => {
    store().enqueue([pdf('a.pdf')], IDS.rootNode);
    await waitFor(() => {
      expect(FakeXhr.instances).toHaveLength(1);
    });
    // Simulates navigating: nothing about the store is tied to a mounted component.
    expect(useUploadStore.getState().items).toHaveLength(1);
    expect(useUploadStore.getState().items[0]?.parentId).toBe(IDS.rootNode);
  });
});
