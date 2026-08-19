import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useLocation } from 'react-router-dom';
import { API_BASE, fixtures, type ListDataRoomsResponse, type NodeDto } from '@dataroom/contracts';
import { useMockApi } from '@/test/msw';
import { renderWithProviders } from '@/test/harness';
import { server } from '@/mocks/server';
import { insertNode, state } from '@/mocks/db';
import { forceError } from '@/mocks/errorMode';
import { qk } from '@/lib/queryKeys';
import { FolderPage } from './FolderPage';

useMockApi();

const { IDS, PUBLIC_LINK_TOKEN } = fixtures;
const roomContext = { kind: 'room', roomId: IDS.room } as const;
const shareContext = { kind: 'share', token: PUBLIC_LINK_TOKEN } as const;

function LocationProbe(): JSX.Element {
  const location = useLocation();
  return <span data-testid="pathname">{location.pathname}</span>;
}

function renderFolder(nodeId: string = IDS.rootNode): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(<FolderPage nodeId={nodeId} context={roomContext} />, {
    route: `/rooms/${IDS.room}/f/${nodeId}`,
  });
}

function seedManyChildren(count: number): void {
  for (let index = 0; index < count; index += 1) {
    const node: NodeDto = {
      id: `00000000-0000-4000-8000-${String(700_000_000_000 + index).slice(-12)}`,
      dataRoomId: IDS.room,
      parentId: IDS.rootNode,
      type: 'file',
      name: `doc-${String(index).padStart(3, '0')}.pdf`,
      sizeBytes: 1024,
      mimeType: 'application/pdf',
      subtreeFileCount: null,
      subtreeSizeBytes: null,
      createdAt: '2026-01-15T10:00:00.000Z',
      updatedAt: '2026-01-15T10:00:00.000Z',
    };
    insertNode(node);
  }
}

describe('FolderPage', () => {
  it('renders a loading state and then the folder contents', async () => {
    renderFolder();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Financials' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Legal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'overview.pdf' })).toBeInTheDocument();
  });

  it('renders the folder name, file count and size in the toolbar', async () => {
    renderFolder();
    expect(await screen.findByRole('heading', { name: 'Project Atlas' })).toBeInTheDocument();
    expect(screen.getByText('3 files · 3.0 MB')).toBeInTheDocument();
  });

  it('renames an owned data room from its root folder', async () => {
    const { queryClient } = renderFolder();
    queryClient.setQueryData<ListDataRoomsResponse>(qk.rooms(), {
      owned: [fixtures.dataRoom],
      sharedWithMe: [],
    });
    await screen.findByRole('heading', { name: 'Project Atlas' });

    await userEvent.click(screen.getByRole('button', { name: 'Rename data room' }));
    const input = screen.getByLabelText('Name');
    expect(input).toHaveValue('Project Atlas');
    await userEvent.clear(input);
    await userEvent.type(input, 'Project Aurora');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('heading', { name: 'Project Aurora' })).toBeInTheDocument();
    expect(state.rooms[0]?.name).toBe('Project Aurora');
    expect(state.nodes.get(IDS.rootNode)?.name).toBe('Project Aurora');
    expect(queryClient.getQueryData<ListDataRoomsResponse>(qk.rooms())?.owned[0]?.name).toBe(
      'Project Aurora',
    );
  });

  it('keeps an invalid room name in the dialog and does not call the API', async () => {
    renderFolder();
    await screen.findByRole('heading', { name: 'Project Atlas' });

    await userEvent.click(screen.getByRole('button', { name: 'Rename data room' }));
    const input = screen.getByLabelText('Name');
    await userEvent.clear(input);
    await userEvent.type(input, 'Project/Atlas');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Name cannot contain / or \\');
    expect(input).toHaveValue('Project/Atlas');
    expect(state.rooms[0]?.name).toBe('Project Atlas');
  });

  it('keeps the typed room name in the dialog when the update fails', async () => {
    renderFolder();
    await screen.findByRole('heading', { name: 'Project Atlas' });

    await userEvent.click(screen.getByRole('button', { name: 'Rename data room' }));
    const input = screen.getByLabelText('Name');
    await userEvent.clear(input);
    await userEvent.type(input, 'Project Aurora');
    forceError('INTERNAL', { endpointKey: 'dataRooms.update', times: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(input).toHaveValue('Project Aurora');
    expect(state.rooms[0]?.name).toBe('Project Atlas');
  });

  it('does not offer room rename from a nested folder or to a viewer', async () => {
    renderFolder(IDS.folderQ3);
    await screen.findByRole('heading', { name: 'Q3' });
    expect(screen.queryByRole('button', { name: 'Rename data room' })).not.toBeInTheDocument();

    state.forcedAccess = 'viewer';
    renderFolder();
    await screen.findByRole('heading', { name: 'Project Atlas' });
    expect(screen.queryByRole('button', { name: 'Rename data room' })).not.toBeInTheDocument();
  });

  it('renders breadcrumbs for a nested folder', async () => {
    renderFolder(IDS.folderQ3);
    expect(await screen.findByRole('link', { name: 'Project Atlas' })).toBeInTheDocument();
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByRole('link', { name: 'Financials' })).toBeInTheDocument();
    expect(within(trail).getByText('Q3')).toHaveAttribute('aria-current', 'page');
  });

  it('renders the empty state for a folder with no children', async () => {
    state.nodes.delete(IDS.fileNda);
    renderFolder(IDS.folderLegal);
    expect(await screen.findByText('This folder is empty')).toBeInTheDocument();
    expect(screen.getByText(/Drop files here to upload them/)).toBeInTheDocument();
  });

  it('renders the error state when the folder itself fails to load', async () => {
    forceError('INTERNAL', { endpointKey: 'nodes.get' });
    renderFolder();
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders the gone state when the folder was deleted while being viewed', async () => {
    forceError('ITEM_GONE', { endpointKey: 'nodes.get' });
    renderFolder();
    expect(await screen.findByText('This item was deleted by the owner')).toBeInTheDocument();
  });

  it('returns through the share entry when a gone descendant has an unresolved root', async () => {
    forceError('ITEM_GONE', { endpointKey: 'nodes.get' });
    forceError('RATE_LIMITED', { endpointKey: 'shares.resolve' });
    renderWithProviders(
      <>
        <LocationProbe />
        <FolderPage nodeId={IDS.folderQ3} context={shareContext} />
      </>,
      { route: `/s/${PUBLIC_LINK_TOKEN}/f/${IDS.folderQ3}` },
    );

    expect(await screen.findByText('This item was deleted by the owner')).toBeInTheDocument();
    expect(screen.queryByText(/nothing else in this share/)).not.toBeInTheDocument();
    expect(screen.queryByText(/rest of the shared folder is still here/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to the shared item' }));
    expect(screen.getByTestId('pathname')).toHaveTextContent(`/s/${PUBLIC_LINK_TOKEN}`);
  });

  it('renders a terminal gone state when the resolver proves the shared root is gone', async () => {
    forceError('ITEM_GONE', { endpointKey: 'nodes.get' });
    forceError('ITEM_GONE', { endpointKey: 'shares.resolve' });
    renderWithProviders(<FolderPage nodeId={IDS.folderQ3} context={shareContext} />, {
      route: `/s/${PUBLIC_LINK_TOKEN}/f/${IDS.folderQ3}`,
    });

    expect(await screen.findByText(/nothing else in this share to go back to/)).toBeInTheDocument();
    expect(screen.getByText('This item was deleted by the owner')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Back to the shared item' }),
    ).not.toBeInTheDocument();
  });

  it('renders the forbidden state for a node outside the caller’s grant', async () => {
    forceError('FORBIDDEN', { endpointKey: 'nodes.get' });
    renderFolder();
    expect(await screen.findByText("You don't have access to this item")).toBeInTheDocument();
  });

  it('renders the list error state when the children fail but the folder loads', async () => {
    forceError('INTERNAL', { endpointKey: 'nodes.children' });
    renderFolder();
    await screen.findByRole('heading', { name: 'Project Atlas' });
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
  });

  it('offers no management controls when the server answers access: viewer', async () => {
    state.forcedAccess = 'viewer';
    state.forcedShareRootId = IDS.rootNode;
    renderFolder();
    await screen.findByRole('button', { name: 'Financials' });
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
  });

  it('navigates into a folder and into a file viewer route', async () => {
    renderWithProviders(<FolderPage nodeId={IDS.rootNode} context={roomContext} />, {
      route: `/rooms/${IDS.room}/f/${IDS.rootNode}`,
      path: '/rooms/:roomId/f/:nodeId',
    });
    expect(await screen.findByRole('button', { name: 'Financials' })).toBeInTheDocument();
  });
});

describe('FolderPage pagination', () => {
  it('fetches page two and stops when nextCursor is null', async () => {
    seedManyChildren(60);
    renderFolder();
    await screen.findByRole('button', { name: 'doc-000.pdf' });

    const grid = screen.getByRole('grid');
    expect(within(grid).getAllByRole('row')).toHaveLength(51); // header + 50 items
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      expect(within(screen.getByRole('grid')).getAllByRole('row')).toHaveLength(64);
    });
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('keeps fetching after a short page that still carries a cursor', async () => {
    let call = 0;
    server.use(
      http.get(`*${API_BASE}/nodes/:id/children`, () => {
        call += 1;
        if (call === 1) {
          return HttpResponse.json({
            items: [fixtures.nodes.legal],
            nextCursor: 'cursor-even-though-the-page-was-short',
          });
        }
        return HttpResponse.json({ items: [fixtures.nodes.overview], nextCursor: null });
      }),
    );

    renderFolder();
    await screen.findByRole('button', { name: 'Legal' });
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('button', { name: 'overview.pdf' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('shows a retryable error when loading the next page fails', async () => {
    seedManyChildren(60);
    renderFolder();
    await screen.findByRole('button', { name: 'doc-000.pdf' });

    forceError('INTERNAL', { endpointKey: 'nodes.children', times: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    // The rows already loaded stay on screen: a failed page is not a failed folder.
    expect(screen.getByRole('button', { name: 'doc-000.pdf' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(within(screen.getByRole('grid')).getAllByRole('row')).toHaveLength(64);
    });
  });

  it('resets to the first page when the sort changes', async () => {
    seedManyChildren(60);
    renderFolder();
    await screen.findByRole('button', { name: 'doc-000.pdf' });
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      expect(within(screen.getByRole('grid')).getAllByRole('row')).toHaveLength(64);
    });

    await userEvent.click(screen.getByRole('button', { name: 'Name' }));
    await waitFor(() => {
      expect(within(screen.getByRole('grid')).getAllByRole('row')).toHaveLength(51);
    });
    expect(screen.getAllByRole('columnheader')[0]).toHaveAttribute('aria-sort', 'descending');
  });
});
