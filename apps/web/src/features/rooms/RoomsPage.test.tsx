import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useParams } from 'react-router-dom';
import { fixtures } from '@dataroom/contracts';
import { useMockApi } from '@/test/msw';
import { renderWithProviders } from '@/test/harness';
import { state } from '@/mocks/db';
import { forceError } from '@/mocks/errorMode';
import { RoomsPage } from './RoomsPage';

useMockApi();

function RoomProbe(): JSX.Element {
  const { roomId } = useParams();
  return <span data-testid="room-id">{roomId}</span>;
}

function renderPage(): void {
  renderWithProviders(
    <Routes>
      <Route path="/rooms" element={<RoomsPage />} />
      <Route path="/rooms/:roomId" element={<RoomProbe />} />
    </Routes>,
    { route: '/rooms' },
  );
}

describe('RoomsPage', () => {
  it('shows a loading state, then the fixture room', async () => {
    renderPage();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Project Atlas/ })).toBeInTheDocument();
  });

  it('shows the empty state when the account has no rooms', async () => {
    state.rooms = [];
    renderPage();
    expect(await screen.findByText(/No data rooms yet/i)).toBeInTheDocument();
    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument();
  });

  it('shows an error state when the list fails', async () => {
    forceError('INTERNAL', { endpointKey: 'dataRooms.list' });
    renderPage();
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
  });

  it('creates a room and navigates into it', async () => {
    renderPage();
    await screen.findByRole('link', { name: /Project Atlas/ });

    await userEvent.click(screen.getAllByRole('button', { name: 'New data room' })[0] as HTMLElement);
    await userEvent.type(screen.getByLabelText('Name'), 'Project Gamma');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(screen.getByTestId('room-id')).toBeInTheDocument();
    });
    expect(state.rooms.map((room) => room.name)).toContain('Project Gamma');
  });

  it('rejects an empty name inline without calling the API', async () => {
    renderPage();
    await screen.findByRole('link', { name: /Project Atlas/ });
    const before = state.rooms.length;

    await userEvent.click(screen.getAllByRole('button', { name: 'New data room' })[0] as HTMLElement);
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/name/i);
    expect(state.rooms).toHaveLength(before);
  });

  it('rejects a name containing a slash, matching the contract’s rule', async () => {
    renderPage();
    await screen.findByRole('link', { name: /Project Atlas/ });

    await userEvent.click(screen.getAllByRole('button', { name: 'New data room' })[0] as HTMLElement);
    await userEvent.type(screen.getByLabelText('Name'), 'a/b');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Name cannot contain / or \\');
  });

  it('keeps the dialog open with the typed name when the server rejects the create', async () => {
    renderPage();
    await screen.findByRole('link', { name: /Project Atlas/ });

    await userEvent.click(screen.getAllByRole('button', { name: 'New data room' })[0] as HTMLElement);
    await userEvent.type(screen.getByLabelText('Name'), 'Project Delta');
    forceError('INTERNAL', { endpointKey: 'dataRooms.create', times: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByLabelText('Name')).toHaveValue('Project Delta');
  });

  it('lists a room shared with the user in its own section, named for the share root', async () => {
    // The permissioned recipient of the fixture share on `Legal`, not a hand-built room row: the
    // list they see is whatever the mock's projection produces, so this test moves when it does.
    state.currentUserId = fixtures.IDS.viewer;
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Shared with me' })).toBeInTheDocument();
    const entry = screen.getByRole('link', { name: /Legal/ });
    expect(entry).toHaveTextContent('1 file · 1.0 MB');
    expect(entry).toHaveTextContent(`Shared by ${fixtures.users.owner.name}`);
    expect(screen.queryByRole('heading', { name: 'Owned' })).not.toBeInTheDocument();
    expect(screen.queryByText('Project Atlas')).not.toBeInTheDocument();
  });
});
