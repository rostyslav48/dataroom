import { create } from 'zustand';
import {
  UPLOAD_CONCURRENCY,
  type UploadQueueItem,
  type UploadStatus,
} from '@dataroom/contracts';
import { abortUpload, completeUpload, initUpload, retryUpload } from '@/lib/apiEndpoints';
import { isApiClientError } from '@/lib/api';
import { presentError } from '@/lib/errorMap';
import { rejectionFor } from './limits';
import { putWithProgress, UploadTransportError } from './xhrUpload';

/**
 * The upload queue.
 *
 * This is the only client state in the application — everything else is server state in TanStack
 * Query. It lives in a store because the queue has to outlive route changes: someone who drops
 * twenty files and then goes on browsing must not lose them by navigating.
 */

/**
 * A partial update to one queue row. `error: null` clears the error; `undefined` leaves a field
 * alone. Spelled out rather than derived from `Partial<UploadQueueItem>` because under
 * `exactOptionalPropertyTypes` a partial spread would widen every required field to `| undefined`.
 */
interface ItemPatch {
  status?: UploadStatus;
  progress?: number;
  finalName?: string;
  nodeId?: string;
  versionId?: string;
  error?: { code: string; message: string } | null;
}

function applyPatch(item: UploadQueueItem, changes: ItemPatch): UploadQueueItem {
  const next: UploadQueueItem = { ...item };
  if (changes.status !== undefined) next.status = changes.status;
  if (changes.progress !== undefined) next.progress = changes.progress;
  if (changes.finalName !== undefined) next.finalName = changes.finalName;
  if (changes.nodeId !== undefined) next.nodeId = changes.nodeId;
  if (changes.versionId !== undefined) next.versionId = changes.versionId;
  if (changes.error === null) delete next.error;
  else if (changes.error !== undefined) next.error = changes.error;
  return next;
}

const ACTIVE_STATUSES: UploadStatus[] = ['initializing', 'uploading', 'finalizing'];

/** Requests live outside the store: they are not state, and they must not be cloned or persisted. */
const inFlight = new Map<string, XMLHttpRequest>();

let localIdSeq = 0;
function nextLocalId(): string {
  localIdSeq += 1;
  return `upload-${String(localIdSeq)}-${String(Date.now())}`;
}

export type InvalidateFolder = (parentId: string) => void;

export interface UploadStore {
  items: UploadQueueItem[];
  /** Set once by the app so a finished upload refreshes the folder it landed in. */
  setInvalidator: (invalidate: InvalidateFolder | null) => void;
  enqueue: (files: File[], parentId: string) => void;
  cancel: (localId: string) => void;
  retry: (localId: string) => void;
  dismiss: (localId: string) => void;
  clearFinished: () => void;
  reset: () => void;
}

let invalidator: InvalidateFolder | null = null;

export const useUploadStore = create<UploadStore>()((set, get) => {
  const patch = (localId: string, changes: ItemPatch): void => {
    set((state) => ({
      items: state.items.map((item) =>
        item.localId === localId ? applyPatch(item, changes) : item,
      ),
    }));
  };

  const failure = (error: unknown): { code: string; message: string } => {
    if (error instanceof UploadTransportError) {
      return { code: error.kind === 'network' ? 'NETWORK' : 'UPLOAD_INCOMPLETE', message: error.message };
    }
    if (isApiClientError(error)) return { code: error.code, message: presentError(error).title };
    return { code: 'INTERNAL', message: presentError(error).title };
  };

  /**
   * Sends the bytes for an item that already has a reserved node and a signed URL. Shared by the
   * first attempt and by retry, because after `init` the two are the same operation.
   */
  const transfer = async (localId: string, uploadUrl: string): Promise<void> => {
    const current = get().items.find((item) => item.localId === localId);
    if (current === undefined) return;

    patch(localId, { status: 'uploading', progress: 0 });
    try {
      await putWithProgress({
        url: uploadUrl,
        file: current.file,
        onProgress: (percent) => {
          patch(localId, { progress: percent });
        },
        onStart: (xhr) => {
          inFlight.set(localId, xhr);
        },
      });
    } finally {
      inFlight.delete(localId);
    }

    patch(localId, { status: 'finalizing', progress: 100 });
    const versionId = get().items.find((item) => item.localId === localId)?.versionId;
    if (versionId === undefined) throw new Error('Upload has no version to complete');
    const completed = await completeUpload(versionId);

    patch(localId, { status: 'done', progress: 100, nodeId: completed.node.id });
    invalidator?.(current.parentId);
  };

  const start = (localId: string): void => {
    const item = get().items.find((candidate) => candidate.localId === localId);
    if (item === undefined || item.status !== 'queued') return;

    patch(localId, { status: 'initializing', error: null, progress: 0 });

    void (async () => {
      try {
        const init = await initUpload({
          parentId: item.parentId,
          name: item.requestedName,
          sizeBytes: item.file.size,
          mimeType: item.file.type,
        });
        patch(localId, {
          nodeId: init.nodeId,
          versionId: init.versionId,
          // Surfaced in the row when it differs, so an auto-suffix is seen rather than discovered.
          finalName: init.finalName,
        });
        await transfer(localId, init.uploadUrl);
      } catch (error) {
        if (get().items.find((candidate) => candidate.localId === localId)?.status === 'canceled') {
          return;
        }
        patch(localId, { status: 'error', error: failure(error) });
      } finally {
        pump();
      }
    })();
  };

  /** Starts queued items up to the concurrency cap. Beyond ~3 the browser queues anyway. */
  const pump = (): void => {
    const items = get().items;
    const active = items.filter((item) => ACTIVE_STATUSES.includes(item.status)).length;
    const capacity = UPLOAD_CONCURRENCY - active;
    if (capacity <= 0) return;
    for (const item of items.filter((candidate) => candidate.status === 'queued').slice(0, capacity)) {
      start(item.localId);
    }
  };

  return {
    items: [],

    setInvalidator: (invalidate) => {
      invalidator = invalidate;
    },

    enqueue: (files, parentId) => {
      const created: UploadQueueItem[] = files.map((file) => {
        const rejection = rejectionFor(file);
        const base: UploadQueueItem = {
          localId: nextLocalId(),
          file,
          parentId,
          // A file that fails the local check fails in its own row, with a reason. A blocking
          // dialog here would stop the files that were perfectly fine.
          status: rejection === null ? 'queued' : 'error',
          progress: 0,
          requestedName: file.name,
        };
        return rejection === null ? base : { ...base, error: rejection };
      });

      set((state) => ({ items: [...state.items, ...created] }));
      pump();
    },

    cancel: (localId) => {
      const item = get().items.find((candidate) => candidate.localId === localId);
      if (item === undefined) return;

      patch(localId, { status: 'canceled' });
      inFlight.get(localId)?.abort();
      inFlight.delete(localId);
      if (item.versionId !== undefined) {
        void abortUpload(item.versionId).catch(() => {
          // The sweeper removes an abandoned version anyway; a failed abort is not the user's problem.
        });
      }
      pump();
    },

    retry: (localId) => {
      const item = get().items.find((candidate) => candidate.localId === localId);
      if (item === undefined) return;

      // Retry NEVER re-runs `init`. `init` reserves a second node and auto-suffixes its name, so a
      // flaky connection would litter the folder with `report (2).pdf`, `report (3).pdf`.
      const versionId = item.versionId;
      if (versionId === undefined) {
        // Nothing was reserved yet — the failure was at `init` itself — so queueing it again is
        // the retry, and it cannot duplicate a node that does not exist.
        patch(localId, { status: 'queued', error: null, progress: 0 });
        pump();
        return;
      }

      patch(localId, { status: 'uploading', error: null, progress: 0 });
      void (async () => {
        try {
          const fresh = await retryUpload(versionId);
          await transfer(localId, fresh.uploadUrl);
        } catch (error) {
          if (get().items.find((candidate) => candidate.localId === localId)?.status === 'canceled') {
            return;
          }
          patch(localId, { status: 'error', error: failure(error) });
        } finally {
          pump();
        }
      })();
    },

    dismiss: (localId) => {
      inFlight.delete(localId);
      set((state) => ({ items: state.items.filter((item) => item.localId !== localId) }));
    },

    clearFinished: () => {
      set((state) => ({
        items: state.items.filter(
          (item) => item.status !== 'done' && item.status !== 'canceled',
        ),
      }));
    },

    reset: () => {
      for (const xhr of inFlight.values()) xhr.abort();
      inFlight.clear();
      set({ items: [] });
    },
  };
});

export function uploadIsActive(items: UploadQueueItem[]): boolean {
  return items.some(
    (item) => item.status === 'queued' || ACTIVE_STATUSES.includes(item.status),
  );
}

export function aggregateProgress(items: UploadQueueItem[]): number {
  const relevant = items.filter((item) => item.status !== 'canceled');
  if (relevant.length === 0) return 0;
  const total = relevant.reduce(
    (sum, item) => sum + (item.status === 'done' ? 100 : item.progress),
    0,
  );
  return Math.round(total / relevant.length);
}
