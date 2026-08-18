import { useEffect, useState } from 'react';
import { Outlet, useMatch } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import { useRooms } from '@/features/rooms/useRooms';
import { UploadQueuePanel } from '@/features/uploads/UploadQueuePanel';
import { Toaster } from '@/components/ui/Toast';
import { useUploadStore } from '@/features/uploads/uploadStore';
import { childrenKeyPrefix, qk, statsKeyPrefix } from '@/lib/queryKeys';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';

/**
 * Chrome for every signed-in page. The active room's name is derived from the route match and the
 * already-cached room list rather than from a store the pages have to remember to update.
 */
export function AppShell(): JSX.Element {
  const { user, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const queryClient = useQueryClient();
  const setInvalidator = useUploadStore((store) => store.setInvalidator);

  useEffect(() => {
    // A finished upload changes the folder it landed in and every rollup above it.
    setInvalidator((parentId) => {
      void queryClient.invalidateQueries({ queryKey: childrenKeyPrefix(parentId) });
      void queryClient.invalidateQueries({ queryKey: qk.node(parentId) });
      void queryClient.invalidateQueries({ queryKey: statsKeyPrefix() });
      void queryClient.invalidateQueries({ queryKey: qk.rooms() });
    });
    return () => {
      setInvalidator(null);
    };
  }, [queryClient, setInvalidator]);
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
      <UploadQueuePanel />
      <Toaster />
    </div>
  );
}
