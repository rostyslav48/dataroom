import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fixtures, type DataRoomDto } from '@dataroom/contracts';
import { renderWithProviders } from '@/test/harness';
import { ApiClientError } from '@/lib/api';
import { RoomList } from './RoomList';

const owned: DataRoomDto = fixtures.dataRoom;
const shared: DataRoomDto = {
  ...fixtures.dataRoom,
  id: '00000000-0000-4000-8000-0000000000aa',
  name: 'Project Beta',
  access: 'viewer',
  ownerName: 'Someone Else',
};

describe('RoomList', () => {
  it('renders a skeleton while loading', () => {
    renderWithProviders(<RoomList data={undefined} isLoading error={null} onRetry={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading your data rooms');
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });

  it('renders the empty state when the user has no rooms at all', () => {
    renderWithProviders(
      <RoomList data={{ owned: [], sharedWithMe: [] }} isLoading={false} error={null} onRetry={vi.fn()} />,
    );
    expect(screen.getByText(/No data rooms yet/i)).toBeInTheDocument();
  });

  it('renders an error state with a working retry', async () => {
    const onRetry = vi.fn();
    renderWithProviders(
      <RoomList
        data={undefined}
        isLoading={false}
        error={new ApiClientError('INTERNAL', 'boom', { status: 500 })}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders owned and shared as separate sections', () => {
    renderWithProviders(
      <RoomList
        data={{ owned: [owned], sharedWithMe: [shared] }}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Owned' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Shared with me' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Project Atlas/ })).toHaveAttribute(
      'href',
      `/rooms/${owned.id}`,
    );
    expect(screen.getByText('Shared by Someone Else')).toBeInTheDocument();
  });

  it('omits the shared section entirely when nothing is shared with the user', () => {
    renderWithProviders(
      <RoomList data={{ owned: [owned], sharedWithMe: [] }} isLoading={false} error={null} onRetry={vi.fn()} />,
    );
    expect(screen.queryByRole('heading', { name: 'Shared with me' })).not.toBeInTheDocument();
  });

  it('shows each room’s file count and size', () => {
    renderWithProviders(
      <RoomList data={{ owned: [owned], sharedWithMe: [] }} isLoading={false} error={null} onRetry={vi.fn()} />,
    );
    expect(screen.getByText('3 files · 3.0 MB')).toBeInTheDocument();
  });
});
