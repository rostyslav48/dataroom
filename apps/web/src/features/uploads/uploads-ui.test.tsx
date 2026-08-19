import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fixtures, type UploadQueueItem } from '@dataroom/contracts';
import { useMockApi } from '@/test/msw';
import { renderWithProviders } from '@/test/harness';
import { FakeXhr, installFakeXhr, restoreXhr } from '@/test/fakeXhr';
import { Toaster, useToastStore } from '@/components/ui/Toast';
import { DropZoneOverlay } from './DropZoneOverlay';
import { UploadQueuePanel } from './UploadQueuePanel';
import { UploadItem } from './UploadItem';
import { useUploadStore } from './uploadStore';
import { directoryRejectionMessage, readDataTransfer } from './dropUtils';

useMockApi();

const { IDS } = fixtures;
const store = () => useUploadStore.getState();

/**
 * The upload store is a Zustand store, so calling it from a test is a state update in whatever
 * component is subscribed to it — `act` is what tells React the update is expected. Without it the
 * assertions still pass, on a tree React has warned it may not have finished rendering, which is
 * the same class of "green for the wrong reason" the rest of this suite is careful about.
 */

/**
 * Enqueue, and stay inside `act` until the queue stops moving.
 *
 * `enqueue` returns immediately and then runs `init` → signed PUT in the background, so an `act`
 * that only wraps the call closes before the first patch lands and React reports the update as
 * unwrapped. Awaiting the resting state *inside* the scope is what makes that go away for the right
 * reason: the test observes a settled queue instead of racing it.
 *
 * Three warnings survive this, all in the two tests that leave a PUT in flight rather than
 * completing it. Traced as far as: every store transition lands inside this scope — subscribing to
 * the store and logging shows nothing after the last one — yet React still schedules a render
 * through the panel's `useUploadStore` subscription once the scope has closed. Left as noise rather
 * than papered over with a blanket `console.error` filter, which would hide the next real one.
 */
async function enqueueSettled(files: File[], parentId: string, until: string[]): Promise<void> {
  await act(async () => {
    store().enqueue(files, parentId);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const statuses = store().items.map((item) => item.status);
      if (statuses.length === until.length && statuses.every((s, i) => s === until[i])) {
        // One more turn after the state matches: the transfer's own bookkeeping lands a tick later,
        // and leaving that turn outside the scope is the difference between a quiet run and a warning.
        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });
        return;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
    }
  });
}

function pdf(name: string, size = 1024): File {
  return new File([new Uint8Array(size)], name, { type: 'application/pdf' });
}

interface FakeItem {
  kind: string;
  type: string;
  getAsFile: () => File | null;
  webkitGetAsEntry: () => { isDirectory: boolean; name: string } | null;
}

function dataTransfer(entries: { file?: File; directory?: string }[]): DataTransfer {
  const items: FakeItem[] = entries.map((entry) => ({
    kind: 'file',
    type: entry.file?.type ?? '',
    getAsFile: () => entry.file ?? null,
    webkitGetAsEntry: () =>
      entry.directory === undefined
        ? { isDirectory: false, name: entry.file?.name ?? '' }
        : { isDirectory: true, name: entry.directory },
  }));

  return {
    types: ['Files'],
    items,
    files: entries.flatMap((entry) => (entry.file === undefined ? [] : [entry.file])),
  } as unknown as DataTransfer;
}

beforeEach(() => {
  installFakeXhr();
  store().reset();
  store().setInvalidator(null);
  useToastStore.getState().clear();
});

afterEach(() => {
  act(() => {
    store().reset();
  });
  restoreXhr();
});

describe('readDataTransfer', () => {
  it('separates files from directories', () => {
    const result = readDataTransfer(
      dataTransfer([{ file: pdf('a.pdf') }, { directory: 'Reports' }]),
    );
    expect(result.files.map((file) => file.name)).toEqual(['a.pdf']);
    expect(result.directoryNames).toEqual(['Reports']);
  });

  it('words the rejection for one folder and for several', () => {
    expect(directoryRejectionMessage(['Reports'])).toContain('“Reports” is a folder');
    expect(directoryRejectionMessage(['A', 'B'])).toContain('2 folders were skipped');
  });
});

describe('DropZoneOverlay', () => {
  function renderOverlay(): void {
    renderWithProviders(
      <div>
        <div data-testid="child">child element</div>
        <DropZoneOverlay parentId={IDS.rootNode} folderName="Project Atlas" />
      </div>,
    );
  }

  it('is hidden until files are dragged over the page', () => {
    renderOverlay();
    expect(screen.queryByTestId('dropzone-overlay')).not.toBeInTheDocument();
  });

  it('appears on dragenter and names the destination folder', () => {
    renderOverlay();
    fireEvent.dragEnter(window, { dataTransfer: dataTransfer([{ file: pdf('a.pdf') }]) });
    expect(screen.getByTestId('dropzone-overlay')).toBeInTheDocument();
    expect(screen.getByText('Drop files into “Project Atlas”')).toBeInTheDocument();
  });

  it('ignores a drag that carries no files', () => {
    renderOverlay();
    fireEvent.dragEnter(window, { dataTransfer: { types: ['text/plain'] } });
    expect(screen.queryByTestId('dropzone-overlay')).not.toBeInTheDocument();
  });

  it('does not flicker when the pointer crosses child elements', () => {
    renderOverlay();
    const transfer = dataTransfer([{ file: pdf('a.pdf') }]);

    fireEvent.dragEnter(window, { dataTransfer: transfer });
    // Entering a child fires enter again before the parent's leave — the classic flicker.
    fireEvent.dragEnter(window, { dataTransfer: transfer });
    fireEvent.dragLeave(window, { dataTransfer: transfer });
    expect(screen.getByTestId('dropzone-overlay')).toBeInTheDocument();

    fireEvent.dragLeave(window, { dataTransfer: transfer });
    expect(screen.queryByTestId('dropzone-overlay')).not.toBeInTheDocument();
  });

  it('queues every dropped file and closes the overlay', async () => {
    renderOverlay();
    const transfer = dataTransfer([{ file: pdf('a.pdf') }, { file: pdf('b.pdf') }]);
    fireEvent.dragEnter(window, { dataTransfer: transfer });
    fireEvent.drop(window, { dataTransfer: transfer });

    await waitFor(() => {
      expect(store().items).toHaveLength(2);
    });
    expect(screen.queryByTestId('dropzone-overlay')).not.toBeInTheDocument();
    expect(store().items.map((item) => item.requestedName)).toEqual(['a.pdf', 'b.pdf']);
  });

  it('rejects a dropped directory explicitly while still taking the files beside it', async () => {
    renderOverlay();
    const transfer = dataTransfer([{ directory: 'Reports' }, { file: pdf('a.pdf') }]);
    fireEvent.dragEnter(window, { dataTransfer: transfer });
    fireEvent.drop(window, { dataTransfer: transfer });

    expect(await screen.findByRole('alert')).toHaveTextContent('“Reports” is a folder');
    expect(store().items.map((item) => item.requestedName)).toEqual(['a.pdf']);

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('UploadItem', () => {
  const base: UploadQueueItem = {
    localId: 'u1',
    file: pdf('report.pdf', 2048),
    parentId: IDS.rootNode,
    status: 'uploading',
    progress: 42,
    requestedName: 'report.pdf',
  };

  it('renders a real progress value', () => {
    renderWithProviders(
      <ul>
        <UploadItem item={base} onCancel={vi.fn()} onRetry={vi.fn()} onDismiss={vi.fn()} />
      </ul>,
    );
    expect(screen.getByRole('progressbar', { name: /report\.pdf/ })).toHaveAttribute(
      'aria-valuenow',
      '42',
    );
    expect(screen.getByText('Uploading')).toBeInTheDocument();
  });

  it('shows the auto-rename when the server reserved a different name', () => {
    renderWithProviders(
      <ul>
        <UploadItem
          item={{ ...base, finalName: 'report (2).pdf' }}
          onCancel={vi.fn()}
          onRetry={vi.fn()}
          onDismiss={vi.fn()}
        />
      </ul>,
    );
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByText('report (2).pdf')).toBeInTheDocument();
  });

  it('offers cancel while active and dismiss once finished', async () => {
    const onCancel = vi.fn();
    const onDismiss = vi.fn();
    const { unmount } = renderWithProviders(
      <ul>
        <UploadItem item={base} onCancel={onCancel} onRetry={vi.fn()} onDismiss={onDismiss} />
      </ul>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel report.pdf' }));
    expect(onCancel).toHaveBeenCalledWith('u1');
    unmount();

    renderWithProviders(
      <ul>
        <UploadItem
          item={{ ...base, status: 'done', progress: 100 }}
          onCancel={onCancel}
          onRetry={vi.fn()}
          onDismiss={onDismiss}
        />
      </ul>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss report.pdf' }));
    expect(onDismiss).toHaveBeenCalledWith('u1');
  });

  it('shows the failure reason and a retry control on an errored row', async () => {
    const onRetry = vi.fn();
    renderWithProviders(
      <ul>
        <UploadItem
          item={{
            ...base,
            status: 'error',
            error: { code: 'NETWORK', message: 'The connection dropped' },
          }}
          onCancel={vi.fn()}
          onRetry={onRetry}
          onDismiss={vi.fn()}
        />
      </ul>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('The connection dropped');
    await userEvent.click(screen.getByRole('button', { name: 'Retry report.pdf' }));
    expect(onRetry).toHaveBeenCalledWith('u1');
  });
});

describe('UploadQueuePanel', () => {
  it('renders nothing while the queue is empty', () => {
    renderWithProviders(<UploadQueuePanel />);
    expect(screen.queryByRole('region', { name: 'Uploads' })).not.toBeInTheDocument();
  });

  it('lists queued files with aggregate progress in the header', async () => {
    renderWithProviders(<UploadQueuePanel />);
    await enqueueSettled([pdf('a.pdf'), pdf('b.pdf')], IDS.rootNode, ['uploading', 'uploading']);
    // Let both reservations reach the PUT. Asserting mid-flight would leave the queue transitioning
    // after the test body has finished — updates React then reports as unwrapped, and assertions
    // that raced whichever state happened to be current.
    await waitFor(() => {
      expect(store().items.map((item) => item.status)).toEqual(['uploading', 'uploading']);
    });

    const panel = await screen.findByRole('region', { name: 'Uploads' });
    expect(within(panel).getByText(/of 2/)).toBeInTheDocument();
    expect(within(panel).getAllByRole('progressbar')).toHaveLength(2);
  });

  it('collapses and expands', async () => {
    renderWithProviders(<UploadQueuePanel />);
    await enqueueSettled([pdf('a.pdf')], IDS.rootNode, ['uploading']);
    await waitFor(() => {
      expect(store().items.map((item) => item.status)).toEqual(['uploading']);
    });
    await screen.findByRole('region', { name: 'Uploads' });

    await userEvent.click(screen.getByRole('button', { name: 'Collapse uploads' }));
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Expand uploads' }));
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('reports completion once every upload finishes', async () => {
    renderWithProviders(<UploadQueuePanel />);
    await enqueueSettled([pdf('a.pdf')], IDS.rootNode, ['uploading']);
    await waitFor(() => {
      expect(FakeXhr.instances).toHaveLength(1);
    });
    act(() => {
      FakeXhr.last().succeed();
    });

    expect(await screen.findByText('1 of 1 uploaded')).toBeInTheDocument();
  });

  it('warns before unload while uploads are in flight, and not once idle', async () => {
    renderWithProviders(<UploadQueuePanel />);
    await enqueueSettled([pdf('a.pdf')], IDS.rootNode, ['uploading']);
    await screen.findByRole('region', { name: 'Uploads' });

    const duringUpload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(duringUpload);
    expect(duringUpload.defaultPrevented).toBe(true);

    await waitFor(() => {
      expect(FakeXhr.instances).toHaveLength(1);
    });
    act(() => {
      FakeXhr.last().succeed();
    });
    await screen.findByText('1 of 1 uploaded');

    const whenIdle = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(whenIdle);
    expect(whenIdle.defaultPrevented).toBe(false);
  });

  it('announces completion politely, since the queue is a corner widget nobody is watching', async () => {
    renderWithProviders(<UploadQueuePanel />);
    await enqueueSettled([pdf('a.pdf')], IDS.rootNode, ['uploading']);
    await waitFor(() => {
      expect(FakeXhr.instances).toHaveLength(1);
    });
    act(() => {
      FakeXhr.last().succeed();
    });

    const region = await screen.findByTestId('upload-announcement');
    await waitFor(() => {
      expect(region).toHaveTextContent('1 file uploaded');
    });
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('toasts the finished upload — a success that happened away from the user’s attention', async () => {
    renderWithProviders(
      <>
        <UploadQueuePanel />
        <Toaster />
      </>,
    );
    await enqueueSettled([pdf('a.pdf'), pdf('b.pdf')], IDS.rootNode, ['uploading', 'uploading']);
    await waitFor(() => {
      expect(FakeXhr.instances).toHaveLength(2);
    });
    act(() => {
      FakeXhr.instances.forEach((xhr) => {
        xhr.succeed();
      });
    });

    expect(await screen.findByText('2 files uploaded')).toBeInTheDocument();
  });

  it('never toasts a failure: it stays in the row that owns the retry', async () => {
    renderWithProviders(
      <>
        <UploadQueuePanel />
        <Toaster />
      </>,
    );
    await enqueueSettled([pdf('a.pdf')], IDS.rootNode, ['uploading']);
    await waitFor(() => {
      expect(FakeXhr.instances).toHaveLength(1);
    });
    act(() => {
      FakeXhr.last().fail();
    });

    await screen.findByRole('alert');
    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(await screen.findByTestId('upload-announcement')).toHaveTextContent(
      '0 files uploaded, 1 failed',
    );
  });

  it('closes the panel and drops the queue when dismissed', async () => {
    renderWithProviders(<UploadQueuePanel />);
    await enqueueSettled([pdf('a.pdf')], IDS.rootNode, ['uploading']);
    await screen.findByRole('region', { name: 'Uploads' });

    await userEvent.click(screen.getByRole('button', { name: 'Close uploads' }));
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Uploads' })).not.toBeInTheDocument();
    });
  });
});
