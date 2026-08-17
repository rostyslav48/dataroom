import { useCallback, useEffect, useRef, useState } from 'react';
import { UploadCloud, X } from 'lucide-react';
import { useUploadStore } from './uploadStore';
import { dragCarriesFiles, directoryRejectionMessage, readDataTransfer } from './dropUtils';

export interface DropZoneOverlayProps {
  /** The folder a drop lands in. */
  parentId: string;
  folderName: string;
}

/**
 * Full-page drop target.
 *
 * Enter and leave are counted, not toggled: `dragenter` fires for every child element the pointer
 * crosses and `dragleave` fires as it leaves each one, so a boolean flag makes the overlay strobe
 * on any page with content. The counter only reaches zero when the pointer really has left.
 */
export function DropZoneOverlay({ parentId, folderName }: DropZoneOverlayProps): JSX.Element | null {
  const [dragging, setDragging] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  const depth = useRef(0);
  const enqueue = useUploadStore((store) => store.enqueue);

  const reset = useCallback(() => {
    depth.current = 0;
    setDragging(false);
  }, []);

  useEffect(() => {
    const onDragEnter = (event: DragEvent): void => {
      if (!dragCarriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      depth.current += 1;
      setDragging(true);
    };

    const onDragOver = (event: DragEvent): void => {
      if (!dragCarriesFiles(event.dataTransfer)) return;
      // Without this the browser navigates to the dropped file instead of handing it over.
      event.preventDefault();
    };

    const onDragLeave = (event: DragEvent): void => {
      if (!dragCarriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };

    const onDrop = (event: DragEvent): void => {
      if (!dragCarriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      reset();
      if (event.dataTransfer === null) return;

      const { files, directoryNames } = readDataTransfer(event.dataTransfer);
      if (files.length > 0) enqueue(files, parentId);
      setRejection(directoryNames.length > 0 ? directoryRejectionMessage(directoryNames) : null);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [enqueue, parentId, reset]);

  if (!dragging && rejection === null) return null;

  return (
    <>
      {dragging ? (
        <div
          data-testid="dropzone-overlay"
          className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-accent-subtle/90 p-8"
        >
          <div className="rounded-lg border-2 border-dashed border-accent bg-surface px-8 py-6 text-center">
            <UploadCloud aria-hidden="true" className="mx-auto mb-2 h-8 w-8 text-accent" />
            <p className="text-sm font-semibold text-ink">{`Drop files into “${folderName}”`}</p>
            <p className="text-sm text-ink-muted">Up to 100 MB per file. Folders can’t be uploaded.</p>
          </div>
        </div>
      ) : null}

      {rejection === null ? null : (
        <div
          role="alert"
          className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-start gap-3 rounded-md border border-danger/40 bg-danger-subtle px-4 py-3 text-sm text-ink shadow-lg"
        >
          <span className="max-w-sm">{rejection}</span>
          <button
            type="button"
            aria-label="Dismiss"
            className="rounded p-0.5 text-ink-subtle hover:text-ink"
            onClick={() => {
              setRejection(null);
            }}
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      )}
    </>
  );
}
