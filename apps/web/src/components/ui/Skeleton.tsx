import { cn } from '@/lib/cn';

export interface SkeletonProps {
  className?: string;
}

/**
 * A shaped placeholder, never a full-page spinner: the layout does not jump when data lands.
 * `aria-hidden` because the surrounding region announces the loading state once, rather than
 * every bar announcing itself.
 */
export function Skeleton({ className }: SkeletonProps): JSX.Element {
  return (
    <div
      aria-hidden="true"
      data-testid="skeleton"
      className={cn('animate-pulse rounded bg-surface-sunken', className)}
    />
  );
}
