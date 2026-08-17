import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { fixtures } from '@dataroom/contracts';
import { useMockApi } from '@/test/msw';
import { renderWithProviders } from '@/test/harness';
import { state } from '@/mocks/db';
import { forceError } from '@/mocks/errorMode';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { AppShell } from './AppShell';
import { TopBar } from './TopBar';

vi.mock('@/lib/browser', () => ({
  assignLocation: vi.fn(),
  reloadPage: vi.fn(),
  saveBlob: vi.fn(),
}));

useMockApi();

function renderShell(route: string): void {
  renderWithProviders(
    <AuthProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/rooms" element={<span>rooms page</span>} />
          <Route path="/rooms/:roomId" element={<span>room page</span>} />
        </Route>
      </Routes>
    </AuthProvider>,
    { route },
  );
}

describe('TopBar', () => {
  it('renders nothing user-specific while signed out', () => {
    renderWithProviders(
      <TopBar user={null} onSignOut={vi.fn()} onToggleSidebar={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: /Account menu/ })).not.toBeInTheDocument();
  });

  it('renders the user menu and signs out', async () => {
    const onSignOut = vi.fn();
    renderWithProviders(
      <TopBar user={fixtures.users.owner} onSignOut={onSignOut} onToggleSidebar={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Account menu/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('shows the active room name when there is one', () => {
    renderWithProviders(
      <TopBar user={fixtures.users.owner} roomName="Project Atlas" onSignOut={vi.fn()} onToggleSidebar={vi.fn()} />,
    );
    expect(screen.getByText('Project Atlas')).toBeInTheDocument();
  });
});

describe('AppShell', () => {
  it('renders the sidebar room list and the routed page', async () => {
    renderShell('/rooms');
    expect(await screen.findByRole('navigation', { name: 'Data rooms' })).toBeInTheDocument();
    expect(screen.getByText('rooms page')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Project Atlas/ })).toBeInTheDocument();
  });

  it('shows the room name in the top bar when a room is open', async () => {
    renderShell(`/rooms/${fixtures.IDS.room}`);
    await waitFor(() => {
      expect(screen.getAllByText('Project Atlas').length).toBeGreaterThan(1);
    });
  });

  it('renders the sidebar error state when the room list fails', async () => {
    forceError('INTERNAL', { endpointKey: 'dataRooms.list' });
    renderShell('/rooms');
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders the sidebar empty state for an account with no rooms', async () => {
    state.rooms = [];
    renderShell('/rooms');
    expect(await screen.findByText(/No data rooms yet/i)).toBeInTheDocument();
  });

  it('toggles the sidebar on narrow screens', async () => {
    renderShell('/rooms');
    const nav = await screen.findByRole('navigation', { name: 'Data rooms' });
    expect(nav.className).toContain('hidden');
    await userEvent.click(screen.getByRole('button', { name: 'Toggle data room list' }));
    expect(nav.className).not.toContain('hidden');
  });
});
