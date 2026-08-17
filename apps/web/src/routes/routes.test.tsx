import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AppRoutes } from './routes';

function LocationProbe(): JSX.Element {
  const location = useLocation();
  return <span data-testid="pathname">{location.pathname}</span>;
}

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('route tree', () => {
  it('redirects / to /rooms', () => {
    renderAt('/');
    expect(screen.getByTestId('pathname')).toHaveTextContent('/rooms');
  });

  it('renders the not-found page for an unknown path', () => {
    renderAt('/this-does-not-exist');
    expect(screen.getByText('Page not found')).toBeInTheDocument();
  });
});
