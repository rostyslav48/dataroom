import { useState } from 'react';
import { Outlet, useMatch } from 'react-router-dom';
import { useAuth } from '@/features/auth/useAuth';
import { useRooms } from '@/features/rooms/useRooms';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';

/**
 * Chrome for every signed-in page. The active room's name is derived from the route match and the
 * already-cached room list rather than from a store the pages have to remember to update.
 */
export function AppShell(): JSX.Element {
  const { user, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const match = useMatch('/rooms/:roomId/*');
  const exactMatch = useMatch('/rooms/:roomId');
  const roomId = match?.params.roomId ?? exactMatch?.params.roomId;
  const rooms = useRooms();
  const roomName =
    roomId === undefined
      ? undefined
      : [...(rooms.data?.owned ?? []), ...(rooms.data?.sharedWithMe ?? [])].find(
          (room) => room.id === roomId,
        )?.name;

  return (
    <div className="flex h-full flex-col">
      <TopBar
        user={user}
        roomName={roomName}
        onSignOut={() => {
          void signOut();
        }}
        onToggleSidebar={() => {
          setSidebarOpen((value) => !value);
        }}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          open={sidebarOpen}
          onNavigate={() => {
            setSidebarOpen(false);
          }}
        />
        <main className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
