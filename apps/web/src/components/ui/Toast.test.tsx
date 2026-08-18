import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/harness';
import { Toaster, toastSuccess, useToastStore } from './Toast';

beforeEach(() => {
  useToastStore.getState().clear();
});

describe('Toaster', () => {
  it('keeps an empty polite region mounted, so the first message is actually announced', () => {
    renderWithProviders(<Toaster />);
    const region = screen.getByTestId('toast-region');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region.textContent).toBe('');
  });

  it('shows a queued message, and several in order', async () => {
    renderWithProviders(<Toaster />);

    toastSuccess('Moved “NDA.pdf”');
    expect(await screen.findByText('Moved “NDA.pdf”')).toBeInTheDocument();

    toastSuccess('2 files uploaded');
    expect(await screen.findByText('2 files uploaded')).toBeInTheDocument();
    expect(screen.getByText('Moved “NDA.pdf”')).toBeInTheDocument();
  });

  it('dismisses one without disturbing the rest', async () => {
    renderWithProviders(<Toaster />);
    toastSuccess('First');
    toastSuccess('Second');
    await screen.findByText('Second');

    const [dismiss] = screen.getAllByRole('button', { name: 'Dismiss' });
    await userEvent.click(dismiss as HTMLElement);

    await waitFor(() => {
      expect(screen.queryByText('First')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Second')).toBeInTheDocument();
  });
});
