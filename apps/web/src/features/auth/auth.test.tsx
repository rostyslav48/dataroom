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

  it('accepts an ordinary same-origin path', () => {
    expect(safeReturnTo('/rooms/r1')).toBe('/rooms/r1');
    expect(safeReturnTo('/rooms/r1?sort=size#top')).toBe('/rooms/r1?sort=size#top');
    expect(safeReturnTo('/')).toBe('/');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['the empty string', ''],
    ['an absolute url', 'https://evil.example.com'],
    ['a protocol-relative url', '//evil.example.com'],
    ['a bare host', 'evil.example.com'],
    ['a scheme-only value', 'javascript:alert(1)'],
    // The bypass this guard was rewritten for. Every browser's URL parser treats `\` as `/` in
    // the authority position, so `new URL('/\\evil.com', document.baseURI)` is
    // `https://evil.com/` — and `<Navigate to="/\\evil.com">` therefore leaves the origin. The
    // old check ("starts with `/`, does not start with `//`") accepted all of these.
    ['a backslash-relative url', '/\\evil.example.com'],
    ['a mixed separator url', '/\\/evil.example.com'],
    ['a slash-then-backslash url', '/\\\\evil.example.com'],
    ['a backslash anywhere in the path', '/rooms/\\evil.example.com'],
    ['a percent-encoded backslash', '/%5Cevil.example.com'],
    // Browsers strip tab, CR and LF from a URL before parsing, turning these into `//evil…`.
    ['a tab-smuggled authority', '/\t/evil.example.com'],
    ['a newline-smuggled authority', '/\n/evil.example.com'],
    ['a carriage-return-smuggled authority', '/\r/evil.example.com'],
  ])('rejects %s', (_label, candidate) => {
    expect(safeReturnTo(candidate)).toBeNull();
  });

  it('does not resolve off-origin for anything it accepts', () => {
    // The property underneath the rule, asserted against the parser rather than restated: whatever
    // survives `safeReturnTo` must resolve to the page's own origin.
    const base = 'https://app.example.com';
    for (const candidate of ['/rooms/r1', '/', '/s/abc?x=1', '/rooms/r1#frag']) {
      expect(new URL(safeReturnTo(candidate) ?? '', base).origin).toBe(base);
    }
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

  it('keeps a shared-path bearer token out of the OAuth redirect', async () => {
    state.currentUserId = null;
    const shareToken = 'sharetoken0123456789abcdef0123456789abcdef';
    renderWithProviders(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
      { route: `/login?returnTo=${encodeURIComponent(`/s/${shareToken}/file/n1`)}` },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));

    expect(assignLocation).toHaveBeenCalledOnce();
    const redirect = vi.mocked(assignLocation).mock.calls[0]?.[0];
    expect(redirect).toBeDefined();
    expect(redirect).not.toContain(shareToken);

    const returnTo = new URL(redirect ?? 'http://localhost').searchParams.get('returnTo');
    expect(returnTo).toMatch(/^\/resume\/[0-9a-f]{32}$/);
    const key = returnTo?.slice('/resume/'.length);
    expect(window.sessionStorage.getItem(`dataroom.returnTo.${key ?? ''}`)).toBe(
      `/s/${shareToken}/file/n1`,
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
    expect(assignLocation).toHaveBeenCalledWith(expect.stringContaining('returnTo=%2Fresume%2F'));
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
