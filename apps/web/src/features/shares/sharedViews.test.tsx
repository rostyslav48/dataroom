import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { fixtures } from '@dataroom/contracts';
import { useMockApi } from '@/test/msw';
import { renderWithProviders } from '@/test/harness';
import { state } from '@/mocks/db';
import { forceError } from '@/mocks/errorMode';
import { ApiClientError } from '@/lib/api';
import { AppRoutes } from '@/routes/routes';
import { FolderPage } from '@/features/browser/FolderPage';
import { AccessErrorScreen } from './accessStates';

vi.mock('@/lib/browser', () => ({
  assignLocation: vi.fn(),
  reloadPage: vi.fn(),
  copyText: vi.fn(async () => Promise.resolve(true)),
  saveBlob: vi.fn(),
}));

const { assignLocation } = await import('@/lib/browser');

useMockApi();

const { IDS, PUBLIC_LINK_TOKEN } = fixtures;
const shareContext = { kind: 'share', token: PUBLIC_LINK_TOKEN } as const;
const roomContext = { kind: 'room', roomId: IDS.room } as const;

function LocationProbe(): JSX.Element {
  const location = useLocation();
  return <span data-testid="pathname">{location.pathname}</span>;
}

function renderApp(route: string): void {
  renderWithProviders(
    <>
      <LocationProbe />
      <AppRoutes />
    </>,
    { route, withAuth: true },
  );
}

describe('the /s/:token tree', () => {
  it('resolves a link to the shared folder and browses it', async () => {
    renderApp(`/s/${PUBLIC_LINK_TOKEN}`);

    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent(`/s/${PUBLIC_LINK_TOKEN}/f/${IDS.folderFin}`);
    });
    expect(await screen.findByRole('button', { name: 'Q3' })).toBeInTheDocument();
  });

  it('works with no session at all', async () => {
    state.currentUserId = null;
    renderApp(`/s/${PUBLIC_LINK_TOKEN}`);
    expect(await screen.findByRole('button', { name: 'Q3' })).toBeInTheDocument();
  });

  it('renders the read-only banner naming the owner', async () => {
    renderApp(`/s/${PUBLIC_LINK_TOKEN}/f/${IDS.folderFin}`);
    expect(await screen.findByTestId('shared-banner')).toHaveTextContent(
      `Shared by ${fixtures.users.owner.name} · view only`,
    );
  });

  it('renders no mutation control anywhere in the shared tree', async () => {
    renderApp(`/s/${PUBLIC_LINK_TOKEN}/f/${IDS.folderFin}`);
    await screen.findByRole('button', { name: 'Q3' });

    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
    for (const label of ['New folder', 'Upload', 'Share', 'Rename', 'Move', 'Delete']) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
    expect(screen.queryByLabelText('Choose files to upload')).not.toBeInTheDocument();
  });

  it('starts breadcrumbs at the share root and never above it', async () => {
    renderApp(`/s/${PUBLIC_LINK_TOKEN}/f/${IDS.folderQ3}`);
    const trail = await screen.findByRole('navigation', { name: 'Breadcrumb' });

    expect(trail).toHaveTextContent('Financials');
    expect(trail).not.toHaveTextContent('Project Atlas');
  });

  it('forbids a node outside the shared subtree', async () => {
    renderApp(`/s/${PUBLIC_LINK_TOKEN}/f/${IDS.fileOrphan}`);
    expect(await screen.findByText("You don't have access to this item")).toBeInTheDocument();
  });

  it('renders the invalid-link screen for a token that was never minted', async () => {
    renderApp('/s/NOTAREALTOKEN000000');
    expect(await screen.findByText("This link isn't valid")).toBeInTheDocument();
  });

  it('renders the revoked screen once the owner revokes the link', async () => {
    const share = state.shares.find((candidate) => candidate.id === IDS.shareLink);
    if (share !== undefined) share.revokedAt = new Date().toISOString();

    renderApp(`/s/${PUBLIC_LINK_TOKEN}`);
    expect(await screen.findByText('Your access was removed by the owner')).toBeInTheDocument();
  });

  it('renders the expired screen for a link past its expiry', async () => {
    const share = state.shares.find((candidate) => candidate.id === IDS.shareLink);
    if (share !== undefined) share.expiresAt = new Date(Date.now() - 60_000).toISOString();

    renderApp(`/s/${PUBLIC_LINK_TOKEN}`);
    expect(await screen.findByText('This link has expired')).toBeInTheDocument();
  });
});

describe('layout comes from the response, not the route', () => {
  it('renders read-only chrome for a viewer on a /rooms URL', async () => {
    state.forcedAccess = 'viewer';
    state.forcedShareRootId = IDS.folderFin;
    renderWithProviders(<FolderPage nodeId={IDS.folderFin} context={roomContext} />, {
      route: `/rooms/${IDS.room}/f/${IDS.folderFin}`,
      withAuth: true,
    });

    expect(await screen.findByTestId('shared-banner')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New folder' })).not.toBeInTheDocument();
  });

  it('renders owner chrome when the response says owner', async () => {
    renderWithProviders(<FolderPage nodeId={IDS.folderFin} context={roomContext} />, {
      route: `/rooms/${IDS.room}/f/${IDS.folderFin}`,
      withAuth: true,
    });

    expect(await screen.findByRole('button', { name: 'New folder' })).toBeInTheDocument();
    expect(screen.queryByTestId('shared-banner')).not.toBeInTheDocument();
  });
});

describe('access failure screens', () => {
  const codes = [
    ['ACCESS_REVOKED', 'Your access was removed by the owner'],
    ['SHARE_EXPIRED', 'This link has expired'],
    ['FORBIDDEN', "You don't have access to this item"],
    ['NOT_FOUND', "This link isn't valid"],
  ] as const;

  it.each(codes)('renders the designed screen for %s', async (code, heading) => {
    renderWithProviders(
      <AccessErrorScreen
        error={new ApiClientError(code, 'nope', { status: 403 })}
        context={shareContext}
      />,
      { withAuth: true },
    );
    expect(await screen.findByText(heading)).toBeInTheDocument();
  });

  it('names the expiry date when the server supplies it', () => {
    renderWithProviders(
      <AccessErrorScreen
        error={new ApiClientError('SHARE_EXPIRED', 'gone', {
          status: 403,
          details: { expiresAt: ['2026-02-01T00:00:00.000Z'] },
        })}
        context={shareContext}
      />,
      { withAuth: true },
    );
    expect(screen.getByText('This link expired on 1 Feb 2026')).toBeInTheDocument();
  });

  it('offers a way back to the share root when a descendant is gone', async () => {
    renderWithProviders(
      <>
        <LocationProbe />
        <AccessErrorScreen
          error={new ApiClientError('ITEM_GONE', 'gone', { status: 410 })}
          context={shareContext}
          shareRootId={IDS.folderFin}
          nodeId={IDS.folderQ3}
        />
      </>,
      { route: `/s/${PUBLIC_LINK_TOKEN}/f/${IDS.folderQ3}`, withAuth: true },
    );

    expect(screen.getByText('This item was deleted by the owner')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to the shared folder' }));
    expect(screen.getByTestId('pathname')).toHaveTextContent(
      `/s/${PUBLIC_LINK_TOKEN}/f/${IDS.folderFin}`,
    );
  });

  it('is terminal when the share root itself is gone', () => {
    renderWithProviders(
      <AccessErrorScreen
        error={new ApiClientError('ITEM_GONE', 'gone', { status: 410 })}
        context={shareContext}
        shareRootId={IDS.folderFin}
        nodeId={IDS.folderFin}
      />,
      { withAuth: true },
    );
    expect(screen.getByText(/there is nothing else in this share to go back to/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to the shared folder' })).not.toBeInTheDocument();
  });

  it('shows both addresses and a working switch-account action for WRONG_ACCOUNT', async () => {
    renderWithProviders(
      <AccessErrorScreen
        error={new ApiClientError('WRONG_ACCOUNT', 'nope', {
          status: 403,
          details: { sharedWith: ['viewer@example.com'] },
        })}
        context={roomContext}
      />,
      { route: `/rooms/${IDS.room}/f/${IDS.folderFin}`, withAuth: true },
    );

    expect(
      await screen.findByText(
        `This was shared with viewer@example.com. You're signed in as ${fixtures.users.owner.email}.`,
      ),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Switch account' }));
    await waitFor(() => {
      expect(assignLocation).toHaveBeenCalledWith(expect.stringContaining('/auth/google?returnTo='));
    });
  });

  it('names only the signed-in address when the server withholds the invited one', async () => {
    // The production path: the API deliberately does not disclose who a share was sent to, so the
    // screen has to be useful — and still offer the switch — knowing only one of the two addresses.
    renderWithProviders(
      <AccessErrorScreen
        error={new ApiClientError('WRONG_ACCOUNT', 'nope', { status: 403 })}
        context={roomContext}
      />,
      { route: `/rooms/${IDS.room}/f/${IDS.folderFin}`, withAuth: true },
    );

    expect(
      await screen.findByText(
        `This was shared with another email address. You're signed in as ${fixtures.users.owner.email}.`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch account' })).toBeInTheDocument();
  });

  it('falls back to a generic state for an unexpected failure', () => {
    renderWithProviders(
      <AccessErrorScreen
        error={new ApiClientError('INTERNAL', 'boom', { status: 500 })}
        context={roomContext}
        onRetry={vi.fn()}
      />,
      { withAuth: true },
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('the gone case in a room', () => {
  it('renders the gone screen with a way back to the data room', async () => {
    forceError('ITEM_GONE', { endpointKey: 'nodes.get' });
    renderWithProviders(<FolderPage nodeId={IDS.folderQ3} context={roomContext} />, {
      route: `/rooms/${IDS.room}/f/${IDS.folderQ3}`,
      withAuth: true,
    });

    expect(await screen.findByText('This item was deleted by the owner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to the data room' })).toBeInTheDocument();
  });
});
