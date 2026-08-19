import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { isSafeReturnTo } from '@dataroom/contracts';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAuth } from './useAuth';

/**
 * Same-origin path only: an absolute URL, a protocol-relative `//host`, or a backslash-relative
 * `/\host` here is an open redirect.
 *
 * The predicate lives in the contract because the server validates the same value on the OAuth
 * round trip. Two implementations of one rule is how `/\evil.com` passed the client copy while the
 * server copy was never asked.
 */
export function safeReturnTo(candidate: string | null | undefined): string | null {
  return isSafeReturnTo(candidate) ? candidate : null;
}

export function RequireAuth(): JSX.Element {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div role="status" aria-live="polite" className="mx-auto w-full max-w-5xl space-y-3 p-6">
        <span className="sr-only">Loading your session</span>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    const attempted = `${location.pathname}${location.search}`;
    const returnTo = safeReturnTo(attempted) ?? '/rooms';
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  return <Outlet />;
}
