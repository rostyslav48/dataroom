import { Navigate, useRoutes, type RouteObject } from 'react-router-dom';
import { NotFoundPage } from './NotFoundPage';

/**
 * Exported as plain route objects rather than a built router so tests can mount the same tree
 * inside a `MemoryRouter` — the routing that ships is the routing under test.
 */
export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/rooms" replace /> },
  { path: '*', element: <NotFoundPage /> },
];

export function AppRoutes(): JSX.Element | null {
  return useRoutes(routes);
}
