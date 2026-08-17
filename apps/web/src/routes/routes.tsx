import { Navigate, useRoutes, type RouteObject } from 'react-router-dom';
import { LoginPage } from '@/features/auth/LoginPage';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { AppShell } from '@/components/layout/AppShell';
import { RoomsPage } from '@/features/rooms/RoomsPage';
import { NotFoundPage } from './NotFoundPage';

/**
 * Exported as plain route objects rather than a built router so tests can mount the same tree
 * inside a `MemoryRouter` — the routing that ships is the routing under test.
 */
export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/', element: <Navigate to="/rooms" replace /> },
      {
        element: <AppShell />,
        children: [{ path: '/rooms', element: <RoomsPage /> }],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];

export function AppRoutes(): JSX.Element | null {
  return useRoutes(routes);
}
