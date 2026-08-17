import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { presentError } from '@/lib/errorMap';

export interface LoadMoreSentinelProps {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  error: unknown;
  onLoadMore: () => void;
}

/**
 * Intersection observer for the mouse, and a real button for everyone else.
 *
 * Pure scroll-triggered loading is unreachable by keyboard and invisible to screen readers, and it
 * gives a failed page no way back. The button is the control; the observer is the convenience.
 */
export function LoadMoreSentinel({
  hasNextPage,
  isFetchingNextPage,
  error,
  onLoadMore,
}: LoadMoreSentinelProps): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  const hasError = error !== null && error !== undefined;

  useEffect(() => {
    const element = ref.current;
    if (element === null || !hasNextPage || isFetchingNextPage || hasError) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [hasNextPage, isFetchingNextPage, hasError, onLoadMore]);

  if (!hasNextPage && !isFetchingNextPage && !hasError) return null;

  return (
    <div ref={ref} className="flex flex-col items-center gap-2 p-3">
      {isFetchingNextPage ? (
        <div role="status" className="w-full space-y-2">
          <span className="sr-only">Loading more items</span>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : null}

      {hasError ? (
        <div role="alert" className="text-center text-sm text-danger">
          {presentError(error).title}
        </div>
      ) : null}

      {!isFetchingNextPage ? (
        <Button onClick={onLoadMore}>{hasError ? 'Try again' : 'Load more'}</Button>
      ) : null}
    </div>
  );
}
