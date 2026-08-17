import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './Button';

export interface StateBlockProps {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
  tone?: 'neutral' | 'danger';
  className?: string;
}

/**
 * The one rendering used by every empty and error state in the app. Having a single block means a
 * new failure mode inherits a designed screen instead of falling back to bare text.
 */
export function StateBlock({
  icon,
  title,
  body,
  action,
  secondaryAction,
  tone = 'neutral',
  className,
}: StateBlockProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-10 text-center',
        tone === 'danger' ? 'border-danger/40 bg-danger-subtle' : 'border-line bg-surface',
        className,
      )}
    >
      {icon === undefined ? null : (
        <div className={tone === 'danger' ? 'text-danger' : 'text-ink-subtle'}>{icon}</div>
      )}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {body === undefined ? null : <p className="max-w-md text-sm text-ink-muted">{body}</p>}
      {action === undefined && secondaryAction === undefined ? null : (
        <div className="mt-2 flex gap-2">
          {action === undefined ? null : (
            <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={action.onClick}>
              {action.label}
            </Button>
          )}
          {secondaryAction === undefined ? null : (
            <Button variant="secondary" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
