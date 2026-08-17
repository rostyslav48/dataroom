import { Navigate, useRoutes, type RouteObject } from 'react-router-dom';
import { LoginPage } from '@/features/auth/LoginPage';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { AppShell } from '@/components/layout/AppShell';
import { RoomsPage } from '@/features/rooms/RoomsPage';
import { RoomFileRoute, RoomFolderRoute, RoomRootRoute } from './RoomRoutes';
import { ShareEntryRoute, SharedFileRoute, SharedFolderRoute } from './SharedRoutes';
import { NotFoundPage } from './NotFoundPage';

/**
 * Exported as plain route objects rather than a built router so tests can mount the same tree
 * inside a `MemoryRouter` — the routing that ships is the routing under test.
 *
 * The `/s/:token` branch sits outside `RequireAuth`: a public link is meant to work with no
 * session at all, and sending its holder to a sign-in page would defeat the point of it.
 */
export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },

  { path: '/s/:token', element: <ShareEntryRoute /> },
  { path: '/s/:token/f/:nodeId', element: <SharedFolderRoute /> },
  { path: '/s/:token/file/:nodeId', element: <SharedFileRoute /> },

  {
    element: <RequireAuth />,
    children: [
      { path: '/', element: <Navigate to="/rooms" replace /> },
      {
        element: <AppShell />,
        children: [
          { path: '/rooms', element: <RoomsPage /> },
          { path: '/rooms/:roomId', element: <RoomRootRoute /> },
          { path: '/rooms/:roomId/f/:nodeId', element: <RoomFolderRoute /> },
          { path: '/rooms/:roomId/file/:nodeId', element: <RoomFileRoute /> },
        ],
      },
    ],
  },

  { path: '*', element: <NotFoundPage /> },
];

export function AppRoutes(): JSX.Element | null {
  return useRoutes(routes);
}
