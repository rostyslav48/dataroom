import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { fixtures, type ShareDto } from '@dataroom/contracts';
import { useMockApi } from '@/test/msw';
import { renderWithProviders } from '@/test/harness';
import { makeRecipient, mockUuid, state } from '@/mocks/db';
import { AppRoutes } from '@/routes/routes';

/**
 * The permissioned recipient's whole path, from the room list to a folder they can read.
 *
 * It is driven end to end — sign in as the fixture viewer, browse the real routes — because the
 * thing under test is a *projection*, and a projection cannot be checked by a contract test: the
 * room's own values and the share root's both satisfy `DataRoomDto.strict()`. Only rendering the
 * path shows that the sidebar entry, the redirect target and the chrome all follow the grant.
 */

useMockApi();

const { IDS } = fixtures;

function grantViewer(nodeId: string, nodeName: string): void {
  const share: ShareDto = {
    id: mockUuid(),
    nodeId,
    nodeName,
    nodeType: 'folder',
    type: 'permissioned',
    role: 'viewer',
    url: null,
    expiresAt: null,
    revokedAt: null,
    recipients: [makeRecipient(fixtures.users.viewer.email)],
    createdAt: new Date().toISOString(),
  };
  state.shares.push(share);
}

function LocationProbe(): JSX.Element {
  const location = useLocation();
  return <span data-testid="pathname">{location.pathname}</span>;
}

function renderAsViewer(route: string): void {
  state.currentUserId = IDS.viewer;
  renderWithProviders(
    <>
      <LocationProbe />
      <AppRoutes />
    </>,
    { route, withAuth: true },
  );
}

describe('a room shared with the signed-in user', () => {
  it('appears under the share root name, with the share root rollups', async () => {
    renderAsViewer('/rooms');

    const entries = await screen.findAllByRole('link', { name: /Legal/ });
    expect(entries.length).toBeGreaterThan(0);
    // Legal's own rollups (1 file, 1 MB), never the room's (3 files, 3 MB).
    expect(entries[0]).toHaveTextContent('1 file · 1.0 MB');
    expect(screen.queryByText('Project Atlas')).not.toBeInTheDocument();
    expect(screen.queryByText(/3 files/)).not.toBeInTheDocument();
  });

  it('appears once even when the viewer holds several grants in it, entered at the shallowest', async () => {
    grantViewer(IDS.folderQ3, 'Q3');
    renderAsViewer('/rooms');

    // Two grants, one room: the deeper one is not a second room in the list.
    const shared = await screen.findAllByRole('link', { name: /Legal/ });
    expect(shared).toHaveLength(2); // the sidebar rail and the page repeat one entry
    expect(screen.queryByRole('link', { name: /Q3/ })).not.toBeInTheDocument();
  });

  it('enters the room at the share root rather than the room root', async () => {
    renderAsViewer('/rooms');
    const entries = await screen.findAllByRole('link', { name: /Legal/ });

    await userEvent.click(entries[0] as HTMLElement);

    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent(
        `/rooms/${IDS.room}/f/${IDS.folderLegal}`,
      );
    });
    expect(await screen.findByRole('button', { name: 'NDA.pdf' })).toBeInTheDocument();
  });

  it('names the share root, not the room, in the chrome above the folder', async () => {
    renderAsViewer(`/rooms/${IDS.room}/f/${IDS.folderLegal}`);

    await screen.findByRole('button', { name: 'NDA.pdf' });
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(trail).toHaveTextContent('Legal');
    expect(trail).not.toHaveTextContent('Project Atlas');
    expect(screen.queryByText('Project Atlas')).not.toBeInTheDocument();
  });

  it('renders read-only chrome on the /rooms URL, naming who shared it', async () => {
    renderAsViewer(`/rooms/${IDS.room}/f/${IDS.folderLegal}`);

    expect(await screen.findByTestId('shared-banner')).toHaveTextContent(
      `Shared by ${fixtures.users.owner.name} · view only`,
    );
  });

  it('renders no mutation control anywhere in the shared room', async () => {
    renderAsViewer(`/rooms/${IDS.room}/f/${IDS.folderLegal}`);
    await screen.findByRole('button', { name: 'NDA.pdf' });

    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
    for (const label of ['New folder', 'Upload', 'Share', 'Rename', 'Move', 'Delete']) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
    expect(screen.queryByLabelText('Choose files to upload')).not.toBeInTheDocument();
  });

  it('forbids the room root, which sits above the grant', async () => {
    renderAsViewer(`/rooms/${IDS.room}/f/${IDS.rootNode}`);
    expect(await screen.findByText("You don't have access to this item")).toBeInTheDocument();
  });

  it('forbids a sibling folder the viewer holds no grant in', async () => {
    renderAsViewer(`/rooms/${IDS.room}/f/${IDS.folderFin}`);
    expect(await screen.findByText("You don't have access to this item")).toBeInTheDocument();
  });

  it('drops out of the list once the owner revokes the grant', async () => {
    const share = state.shares.find((candidate) => candidate.id === IDS.sharePerm);
    if (share !== undefined) share.revokedAt = new Date().toISOString();

    renderAsViewer('/rooms');
    expect((await screen.findAllByText(/No data rooms yet/i)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /Legal/ })).not.toBeInTheDocument();
  });
});
