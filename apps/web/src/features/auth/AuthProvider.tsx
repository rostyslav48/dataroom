import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UserDto } from '@dataroom/contracts';
import { getMe, googleSignInUrl, logout } from '@/lib/apiEndpoints';
import { setSessionExpiredHandler } from '@/lib/api';
import { tokenStore } from '@/lib/tokenStore';
import { qk } from '@/lib/queryKeys';
import { assignLocation } from '@/lib/browser';
import { stashReturnTo } from './returnToStash';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthContextValue {
  status: AuthStatus;
  user: UserDto | null;
  /** Leaves the SPA for Google while preserving the path to come back to. */
  signIn: (returnTo?: string) => void;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  children: ReactNode;
}

/**
 * Holds the session.
 *
 * There is no bootstrap dance here on purpose: `/me` is simply requested, and if the in-memory
 * access token is missing or stale the API client's single-flight refresh exchanges the httpOnly
 * cookie for a new one and replays the request. That is why a hard refresh restores a session
 * without anything readable ever being written to web storage.
 */
export function AuthProvider({ children }: AuthProviderProps): JSX.Element {
  const queryClient = useQueryClient();
  const [sessionEnded, setSessionEnded] = useState(false);

  const query = useQuery({
    queryKey: qk.me(),
    queryFn: ({ signal }) => getMe(signal),
    retry: false,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setSessionEnded(true);
      queryClient.removeQueries({ queryKey: qk.me() });
    });
    return () => {
      setSessionExpiredHandler(null);
    };
  }, [queryClient]);

  const signIn = useCallback((returnTo?: string) => {
    setSessionEnded(false);
    const destination = returnTo === undefined ? undefined : stashReturnTo(returnTo);
    assignLocation(googleSignInUrl(destination));
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } finally {
      tokenStore.clear();
      setSessionEnded(true);
      queryClient.clear();
    }
  }, [queryClient]);

  const status: AuthStatus = sessionEnded
    ? 'unauthenticated'
    : query.isPending
      ? 'loading'
      : query.data === undefined
        ? 'unauthenticated'
        : 'authenticated';

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: status === 'authenticated' ? (query.data ?? null) : null,
      signIn,
      signOut,
    }),
    [status, query.data, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
