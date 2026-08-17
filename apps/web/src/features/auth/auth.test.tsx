import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { fixtures } from '@dataroom/contracts';
import { useMockApi } from '@/test/msw';
import { renderWithProviders } from '@/test/harness';
import { state } from '@/mocks/db';
import { forceError } from '@/mocks/errorMode';
import { tokenStore } from '@/lib/tokenStore';
import { AuthProvider } from './AuthProvider';
import { RequireAuth, safeReturnTo } from './RequireAuth';
import { LoginPage } from './LoginPage';
import { useAuth } from './useAuth';

vi.mock('@/lib/browser', () => ({
  assignLocation: vi.fn(),
  reloadPage: vi.fn(),
  saveBlob: vi.fn(),
}));

const { assignLocation } = await import('@/lib/browser');

useMockApi();

function SessionProbe(): JSX.Element {
  const { status, user, signOut } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="email">{user?.email ?? 'none'}</span>
      <button
        type="button"
        onClick={() => {
          void signOut();
        }}
      >
        Sign out
      </button>
    </div>
  );
}

function LocationProbe(): JSX.Element {
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
}

describe('AuthProvider', () => {
  it('starts in loading and resolves to the signed-in user', async () => {
    renderWithProviders(<SessionProbe />, { withAuth: true });
    expect(screen.getByTestId('status')).toHaveTextContent(/^loading$/);
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent(/^authenticated$/);
    });
    expect(screen.getByTestId('email')).toHaveTextContent(fixtures.users.owner.email);
  });

  it('resolves to unauthenticated when there is no session to refresh', async () => {
    state.currentUserId = null;
    renderWithProviders(<SessionProbe />, { withAuth: true });
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent(/^unauthenticated$/);
    });
  });

  it('reports unauthenticated after the server rejects the session mid-flight', async () => {
    renderWithProviders(<SessionProbe />, { withAuth: true });
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent(/^authenticated$/);
    });

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent(/^unauthenticated$/);
    });
    expect(tokenStore.get()).toBeNull();
  });

  it('surfaces an errored /me as unauthenticated rather than an infinite spinner', async () => {
    forceError('INTERNAL', { endpointKey: 'auth.me' });
    renderWithProviders(<SessionProbe />, { withAuth: true });
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent(/^unauthenticated$/);
    });
  });

  it('never puts the access token in web storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    renderWithProviders(<SessionProbe />, { withAuth: true });
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent(/^authenticated$/);
    });
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    setItem.mockRestore();
  });
});

describe('RequireAuth', () => {
  const guarded = (
    <Routes>
      <Route element={<RequireAuth />}>
        <Route path="/rooms/:roomId" element={<span>protected content</span>} />
      </Route>
      <Route path="/login" element={<LocationProbe />} />
    </Routes>
  );

  it('renders a loading state before the session is known', () => {
    renderWithProviders(<AuthProvider>{guarded}</AuthProvider>, { route: '/rooms/r1' });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders the protected route once authenticated', async () => {
    renderWithProviders(<AuthProvider>{guarded}</AuthProvider>, { route: '/rooms/r1' });
    expect(await screen.findByText('protected content')).toBeInTheDocument();
  });

  it('redirects to login preserving the attempted path as returnTo', async () => {
    state.currentUserId = null;
    renderWithProviders(<AuthProvider>{guarded}</AuthProvider>, { route: '/rooms/r1?sort=size' });
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/login?returnTo=%2Frooms%2Fr1%3Fsort%3Dsize',
      );
    });
  });

  it('rejects an off-origin returnTo', () => {
    expect(safeReturnTo('/rooms/r1')).toBe('/rooms/r1');
    expect(safeReturnTo('//evil.example.com')).toBeNull();
    expect(safeReturnTo('https://evil.example.com')).toBeNull();
    expect(safeReturnTo(null)).toBeNull();
  });
});

describe('LoginPage', () => {
  it('explains the product rather than showing a bare button', async () => {
    state.currentUserId = null;
    renderWithProviders(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
      { route: '/login' },
    );
    expect(await screen.findByRole('heading', { name: 'Data Room' })).toBeInTheDocument();
    expect(screen.getByText(/private workspace for sharing due-diligence documents/i)).toBeInTheDocument();
  });

  it('starts the OAuth redirect carrying the returnTo it was given', async () => {
    state.currentUserId = null;
    renderWithProviders(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
      { route: '/login?returnTo=%2Frooms%2Fr1' },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
    expect(assignLocation).toHaveBeenCalledWith(
      expect.stringContaining('/auth/google?returnTo=%2Frooms%2Fr1'),
    );
  });

  it('ignores an off-origin returnTo and falls back to /rooms', async () => {
    state.currentUserId = null;
    renderWithProviders(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
      { route: '/login?returnTo=https%3A%2F%2Fevil.example.com' },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
    expect(assignLocation).toHaveBeenCalledWith(expect.stringContaining('returnTo=%2Frooms'));
    expect(assignLocation).not.toHaveBeenCalledWith(expect.stringContaining('evil.example.com'));
  });

  it('sends an already-authenticated visitor straight to their returnTo', async () => {
    renderWithProviders(
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/rooms/r1" element={<span>already in</span>} />
        </Routes>
      </AuthProvider>,
      { route: '/login?returnTo=%2Frooms%2Fr1' },
    );
    expect(await screen.findByText('already in')).toBeInTheDocument();
  });
});
