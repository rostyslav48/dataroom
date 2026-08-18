import { useEffect } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { create } from 'zustand';

/**
 * Toasts — for background successes, and nothing else.
 *
 * There is deliberately no error variant and no tone parameter: a failure that belongs to a form
 * is shown inside that form, next to the control that caused it and with the user's typing intact,
 * because a message that slides away after six seconds is the worst possible place to explain what
 * someone must now do differently. What is left is the case a toast is actually good at — some
 * work that finished successfully somewhere the user is no longer looking.
 *
 * The primitive is a polite live region and a dismiss button, owned outright rather than pulled
 * from a component library: everything else a toast library brings — swipe gestures, pointer
 * capture, a focus queue — is machinery for a control that here has exactly two states.
 */

export interface ToastMessage {
  id: string;
  message: string;
}

export interface ToastStore {
  toasts: ToastMessage[];
  push: (message: string) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

let seq = 0;

export const useToastStore = create<ToastStore>()((set) => ({
  toasts: [],
  push: (message) => {
    seq += 1;
    const id = `toast-${String(seq)}`;
    set((state) => ({ toasts: [...state.toasts, { id, message }] }));
  },
  dismiss: (id) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },
  clear: () => {
    set({ toasts: [] });
  },
}));

/** Announce a background success from anywhere, with no provider to thread through the tree. */
export function toastSuccess(message: string): void {
  useToastStore.getState().push(message);
}

export const TOAST_DURATION_MS = 6000;

interface ToastRowProps {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}

function ToastRow({ toast, onDismiss }: ToastRowProps): JSX.Element {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, TOAST_DURATION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [toast.id, onDismiss]);

  return (
    <div className="pointer-events-auto flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 shadow-lg animate-slide-up">
      <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0 text-accent" />
      <p className="min-w-0 flex-1 text-sm text-ink">{toast.message}</p>
      <button
        type="button"
        aria-label="Dismiss"
        className="rounded p-1 text-ink-subtle hover:bg-surface-sunken hover:text-ink"
        onClick={() => {
          onDismiss(toast.id);
        }}
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * Bottom-left on purpose: the upload queue owns the bottom-right corner, and a toast that covered
 * the progress it is reporting on would be a strange thing to ship.
 *
 * The region stays mounted while empty. A live region that is inserted along with its first
 * message is announced unreliably — assistive technology has to be observing it beforehand.
 */
export function Toaster(): JSX.Element {
  const toasts = useToastStore((store) => store.toasts);
  const dismiss = useToastStore((store) => store.dismiss);

  return (
    <div
      aria-live="polite"
      data-testid="toast-region"
      className="pointer-events-none fixed bottom-4 left-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </div>
  );
}
