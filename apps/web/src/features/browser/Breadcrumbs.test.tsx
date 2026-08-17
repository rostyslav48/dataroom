import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BreadcrumbDto } from '@dataroom/contracts';
import { renderWithProviders } from '@/test/harness';
import { Breadcrumbs } from './Breadcrumbs';

const crumb = (id: string, name: string): BreadcrumbDto => ({ id, name, type: 'folder' });

const deep = [
  crumb('root', 'Project Atlas'),
  crumb('a', 'Financials'),
  crumb('b', 'FY26'),
  crumb('c', 'Q3'),
  crumb('d', 'Working papers'),
  crumb('e', 'Drafts'),
];

const roomContext = { kind: 'room', roomId: 'r1' } as const;

describe('Breadcrumbs', () => {
  it('renders a shallow trail in full, with the last crumb marked current', () => {
    renderWithProviders(
      <Breadcrumbs crumbs={deep.slice(0, 3)} context={roomContext} shareRootId="root" />,
      { route: '/rooms/r1/f/b' },
    );
    expect(screen.getByRole('link', { name: 'Project Atlas' })).toHaveAttribute(
      'href',
      '/rooms/r1/f/root',
    );
    expect(screen.getByText('FY26')).toHaveAttribute('aria-current', 'page');
  });

  it('collapses the middle when the trail is more than four deep, and expands on demand', async () => {
    renderWithProviders(<Breadcrumbs crumbs={deep} context={roomContext} shareRootId="root" />, {
      route: '/rooms/r1/f/e',
    });
    expect(screen.queryByText('FY26')).not.toBeInTheDocument();
    expect(screen.getByText('Project Atlas')).toBeInTheDocument();
    expect(screen.getByText('Working papers')).toBeInTheDocument();
    expect(screen.getByText('Drafts')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Show 3 hidden folders' }));
    expect(screen.getByText('FY26')).toBeInTheDocument();
    expect(screen.getByText('Q3')).toBeInTheDocument();
  });

  it('never renders above the share root', () => {
    renderWithProviders(<Breadcrumbs crumbs={deep} context={roomContext} shareRootId="c" />, {
      route: '/rooms/r1/f/e',
    });
    expect(screen.queryByText('Project Atlas')).not.toBeInTheDocument();
    expect(screen.queryByText('Financials')).not.toBeInTheDocument();
    expect(screen.getByText('Q3')).toBeInTheDocument();
  });

  it('links through the share route prefix when browsing a public link', () => {
    renderWithProviders(
      <Breadcrumbs
        crumbs={deep.slice(3)}
        context={{ kind: 'share', token: 'TOKEN123' }}
        shareRootId="c"
      />,
      { route: '/s/TOKEN123/f/e' },
    );
    expect(screen.getByRole('link', { name: 'Q3' })).toHaveAttribute('href', '/s/TOKEN123/f/c');
  });

  it('renders a single crumb without a separator', () => {
    renderWithProviders(
      <Breadcrumbs crumbs={[crumb('root', 'Project Atlas')]} context={roomContext} shareRootId="root" />,
    );
    expect(screen.getByText('Project Atlas')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
