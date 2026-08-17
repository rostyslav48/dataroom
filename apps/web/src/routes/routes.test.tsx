import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { useMockApi } from '@/test/msw';
import { renderWithProviders } from '@/test/harness';
import { state } from '@/mocks/db';
import { AppRoutes } from './routes';

useMockApi();

function LocationProbe(): JSX.Element {
  const location = useLocation();
  return <span data-testid="pathname">{location.pathname}</span>;
}

function renderAt(route: string): void {
  renderWithProviders(
    <>
      <LocationProbe />
      <AppRoutes />
    </>,
    { route, withAuth: true },
  );
}

describe('route tree', () => {
  it('redirects / to /rooms for a signed-in user', async () => {
    renderAt('/');
    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent('/rooms');
    });
  });

  it('sends a signed-out user to /login instead', async () => {
    state.currentUserId = null;
    renderAt('/');
    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent('/login');
    });
  });

  it('renders the not-found page for an unknown path', async () => {
    renderAt('/this-does-not-exist');
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
  });

  it('renders the login page without requiring a session', async () => {
    state.currentUserId = null;
    renderAt('/login');
    expect(await screen.findByRole('heading', { name: 'Data Room' })).toBeInTheDocument();
  });
});
