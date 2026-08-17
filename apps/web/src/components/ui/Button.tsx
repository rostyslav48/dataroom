import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders a busy state and blocks activation. Kept separate from `disabled` so screen readers
   *  hear "busy" rather than "unavailable". */
  busy?: boolean;
  leadingIcon?: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover disabled:bg-accent/50',
  secondary:
    'bg-surface text-ink border border-line-strong hover:bg-surface-muted disabled:text-ink-subtle',
  ghost: 'bg-transparent text-ink-muted hover:bg-surface-sunken disabled:text-ink-subtle',
  danger: 'bg-danger text-white hover:bg-danger-hover disabled:bg-danger/50',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-sm gap-1.5',
  md: 'h-9 px-3 text-sm gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', busy = false, leadingIcon, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={props.type ?? 'button'}
      aria-busy={busy || undefined}
      disabled={props.disabled === true || busy}
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium transition-colors',
        'disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {leadingIcon}
      {children}
    </button>
  );
});
