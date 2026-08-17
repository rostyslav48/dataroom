import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { aggregateProgress, uploadIsActive, useUploadStore } from './uploadStore';
import { UploadItem } from './UploadItem';

/**
 * Fixed bottom-right, collapsible, and outliving every route change because the queue it renders
 * does. It stays until dismissed so a finished upload — and especially a failed one — is still
 * there when the user looks back.
 */
export function UploadQueuePanel(): JSX.Element | null {
  const items = useUploadStore((store) => store.items);
  const cancel = useUploadStore((store) => store.cancel);
  const retry = useUploadStore((store) => store.retry);
  const dismiss = useUploadStore((store) => store.dismiss);
  const reset = useUploadStore((store) => store.reset);
  const [collapsed, setCollapsed] = useState(false);

  const active = uploadIsActive(items);

  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent): void => {
      // Closing the tab mid-upload leaves a pending version the sweeper cleans up, and a file the
      // user thinks they uploaded. Worth one browser prompt; not worth one when the queue is idle.
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [active]);

  if (items.length === 0) return null;

  const done = items.filter((item) => item.status === 'done').length;
  const percent = aggregateProgress(items);

  return (
    <section
      aria-label="Uploads"
      className="fixed bottom-4 right-4 z-40 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-line bg-surface shadow-lg"
    >
      <header className="flex items-center gap-2 border-b border-line bg-surface-muted px-3 py-2">
        <p className="min-w-0 flex-1 text-sm font-medium text-ink" aria-live="polite">
          {active
            ? `Uploading ${String(done + 1 > items.length ? items.length : done + 1)} of ${String(items.length)} · ${String(percent)}%`
            : `${String(done)} of ${String(items.length)} uploaded`}
        </p>
        <button
          type="button"
          aria-label={collapsed ? 'Expand uploads' : 'Collapse uploads'}
          aria-expanded={!collapsed}
          className="rounded p-1 text-ink-subtle hover:bg-surface-sunken hover:text-ink"
          onClick={() => {
            setCollapsed((value) => !value);
          }}
        >
          {collapsed ? (
            <ChevronUp aria-hidden="true" className="h-4 w-4" />
          ) : (
            <ChevronDown aria-hidden="true" className="h-4 w-4" />
          )}
        </button>
        <button
          type="button"
          aria-label="Close uploads"
          className="rounded p-1 text-ink-subtle hover:bg-surface-sunken hover:text-ink"
          onClick={reset}
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </header>

      {collapsed ? null : (
        <ul className="max-h-72 overflow-y-auto">
          {items.map((item) => (
            <UploadItem
              key={item.localId}
              item={item}
              onCancel={cancel}
              onRetry={retry}
              onDismiss={dismiss}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
