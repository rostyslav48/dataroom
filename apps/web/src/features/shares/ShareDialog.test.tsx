import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fixtures, type NodeListItem } from '@dataroom/contracts';
import { useMockApi } from '@/test/msw';
import { renderWithProviders } from '@/test/harness';
import { state } from '@/mocks/db';
import { forceError } from '@/mocks/errorMode';
import { ShareDialog } from './ShareDialog';
import { statusOf } from './RecipientRow';

vi.mock('@/lib/browser', async () => {
  const actual = await vi.importActual<typeof import('@/lib/browser')>('@/lib/browser');
  return { ...actual, copyText: vi.fn(async () => Promise.resolve(true)) };
});

const { copyText } = await import('@/lib/browser');

useMockApi();

const { IDS } = fixtures;
const financials: NodeListItem = fixtures.nodes.financials;
const legal: NodeListItem = fixtures.nodes.legal;
const overview: NodeListItem = fixtures.nodes.overview;

function renderDialog(node: NodeListItem = financials): void {
  renderWithProviders(<ShareDialog open onOpenChange={vi.fn()} node={node} />);
}

beforeEach(() => {
  vi.mocked(copyText).mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ShareDialog', () => {
  it('names what is being shared and its type', async () => {
    renderDialog();
    expect(await screen.findByText(/Sharing: Financials/)).toBeInTheDocument();
    expect(screen.getByText('(folder)')).toBeInTheDocument();
  });

  it('opens on the people tab and does not mint a link', async () => {
    renderDialog(legal);
    await screen.findByText(/Nobody else can open it/);

    const before = state.shares.filter((share) => share.type === 'public_link').length;
    expect(state.shares.filter((share) => share.type === 'public_link')).toHaveLength(before);
    expect(screen.queryByLabelText('Public link URL')).not.toBeInTheDocument();
  });

  it('mints a link the first time the Link tab is opened', async () => {
    renderDialog(legal);
    await screen.findByText(/Nobody else can open it/);
    const before = state.shares.length;

    await userEvent.click(screen.getByRole('tab', { name: 'Public link' }));

    await waitFor(() => {
      expect(state.shares).toHaveLength(before + 1);
    });
    const created = state.shares[state.shares.length - 1];
    expect(created?.type).toBe('public_link');
    expect(await screen.findByLabelText('Public link URL')).toHaveValue(created?.url ?? '');
  });

  it('reuses an existing live link instead of minting a second one', async () => {
    renderDialog(financials);
    await screen.findByText(/Sharing: Financials/);
    const before = state.shares.length;

    await userEvent.click(screen.getByRole('tab', { name: 'Public link' }));

    expect(await screen.findByLabelText('Public link URL')).toHaveValue(fixtures.shares.publicLink.url);
    expect(state.shares).toHaveLength(before);
  });

  it('confirms the copy inline on the button rather than in a toast', async () => {
    renderDialog(financials);
    await userEvent.click(await screen.findByRole('tab', { name: 'Public link' }));
    await screen.findByLabelText('Public link URL');

    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(copyText).toHaveBeenCalledWith(fixtures.shares.publicLink.url);
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('states plainly what a public link means', async () => {
    renderDialog(financials);
    await userEvent.click(await screen.findByRole('tab', { name: 'Public link' }));
    expect(await screen.findByText(/Anyone with this link can view/)).toBeInTheDocument();
    expect(screen.getByText(/they can forward the link/)).toBeInTheDocument();
  });

  it('revokes the link only after confirmation, and not optimistically', async () => {
    renderDialog(financials);
    await userEvent.click(await screen.findByRole('tab', { name: 'Public link' }));
    await screen.findByLabelText('Public link URL');

    await userEvent.click(screen.getByRole('button', { name: 'Revoke link' }));
    expect(screen.getByText(/Revoking stops this link working for everyone/)).toBeInTheDocument();
    // Still live until confirmed.
    expect(state.shares.find((share) => share.id === IDS.shareLink)?.revokedAt).toBeNull();

    await userEvent.click(
      within(screen.getByText(/Revoking stops this link working/).parentElement as HTMLElement).getByRole(
        'button',
        { name: 'Revoke link' },
      ),
    );

    await waitFor(() => {
      expect(state.shares.find((share) => share.id === IDS.shareLink)?.revokedAt).not.toBeNull();
    });
    expect(await screen.findByText(/There is no active link for this item/)).toBeInTheDocument();
  });

  it('reports a failed revoke and keeps the link visible', async () => {
    renderDialog(financials);
    await userEvent.click(await screen.findByRole('tab', { name: 'Public link' }));
    await screen.findByLabelText('Public link URL');

    forceError('INTERNAL', { endpointKey: 'shares.revoke', times: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Revoke link' }));
    await userEvent.click(
      within(screen.getByText(/Revoking stops this link working/).parentElement as HTMLElement).getByRole(
        'button',
        { name: 'Revoke link' },
      ),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByLabelText('Public link URL')).toBeInTheDocument();
  });

  it('offers a new link with an expiry after the old one is revoked', async () => {
    renderDialog(legal);
    await userEvent.click(await screen.findByRole('tab', { name: 'Public link' }));
    await screen.findByLabelText('Public link URL');

    await userEvent.click(screen.getByRole('button', { name: 'Revoke link' }));
    await userEvent.click(
      within(screen.getByText(/Revoking stops this link working/).parentElement as HTMLElement).getByRole(
        'button',
        { name: 'Revoke link' },
      ),
    );
    await screen.findByText(/There is no active link for this item/);

    await userEvent.selectOptions(screen.getByLabelText('Expiry'), '7d');
    await userEvent.click(screen.getByRole('button', { name: 'Create link' }));

    expect(await screen.findByLabelText('Public link URL')).toBeInTheDocument();
    expect(screen.getByText(/Expires on/)).toBeInTheDocument();
  });

  it('shows a loading state while the shares are being read', () => {
    renderDialog();
    expect(screen.getByRole('status')).toHaveTextContent('Loading who has access');
  });

  it('reports a failure to load the shares', async () => {
    forceError('INTERNAL', { endpointKey: 'shares.listForNode' });
    renderDialog();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
  });
});

describe('ShareDialog — people', () => {
  it('lists existing recipients with their status', async () => {
    renderDialog(legal);
    expect(await screen.findByText('viewer@example.com')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('says when nobody has been invited yet', async () => {
    renderDialog(overview);
    expect(await screen.findByText('Nobody has been invited to this item yet.')).toBeInTheDocument();
  });

  it('rejects an invalid email inline and keeps the field usable', async () => {
    renderDialog(overview);
    await screen.findByText('Nobody has been invited to this item yet.');

    await userEvent.type(screen.getByLabelText('Invite by email'), 'not-an-email{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('is not a valid email address');
    expect(screen.getByRole('button', { name: 'Invite' })).toBeDisabled();
  });

  it('rejects a duplicate of an already-invited address', async () => {
    renderDialog(legal);
    await screen.findByText('viewer@example.com');

    await userEvent.type(screen.getByLabelText('Invite by email'), 'viewer@example.com{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('has already been added');
  });

  it('rejects a duplicate among the chips being typed', async () => {
    renderDialog(overview);
    await screen.findByText('Nobody has been invited to this item yet.');

    const input = screen.getByLabelText('Invite by email');
    await userEvent.type(input, 'a@example.com{Enter}');
    await userEvent.type(input, 'A@example.com{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('has already been added');
  });

  it('creates a permissioned share for the first invitee', async () => {
    renderDialog(overview);
    await screen.findByText('Nobody has been invited to this item yet.');

    await userEvent.type(screen.getByLabelText('Invite by email'), 'newcomer@example.com{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));

    expect(await screen.findByText('newcomer@example.com')).toBeInTheDocument();
    expect(screen.getByText('Invited')).toBeInTheDocument();
  });

  it('adds a recipient to the existing permissioned share', async () => {
    renderDialog(legal);
    await screen.findByText('viewer@example.com');
    const before = state.shares.length;

    await userEvent.type(screen.getByLabelText('Invite by email'), 'second@example.com{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));

    expect(await screen.findByText('second@example.com')).toBeInTheDocument();
    expect(state.shares).toHaveLength(before);
  });

  it('revokes a recipient after confirming, and only then shows Revoked', async () => {
    renderDialog(legal);
    await screen.findByText('viewer@example.com');

    await userEvent.click(screen.getByRole('button', { name: 'Remove access for viewer@example.com' }));
    expect(screen.getByText('Remove viewer@example.com?')).toBeInTheDocument();
    expect(screen.queryByText('Revoked')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Revoked')).toBeInTheDocument();
  });

  it('can back out of revoking a recipient', async () => {
    renderDialog(legal);
    await screen.findByText('viewer@example.com');

    await userEvent.click(screen.getByRole('button', { name: 'Remove access for viewer@example.com' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('reports a failed invite without losing the list', async () => {
    renderDialog(legal);
    await screen.findByText('viewer@example.com');

    forceError('INTERNAL', { endpointKey: 'shares.addRecipients', times: 1 });
    await userEvent.type(screen.getByLabelText('Invite by email'), 'third@example.com{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByText('viewer@example.com')).toBeInTheDocument();
  });
});

describe('recipient status', () => {
  it('maps the timestamps to Invited, Active and Revoked', () => {
    const base = {
      id: 'r1',
      email: 'a@example.com',
      userId: null,
      invitedAt: '2026-01-15T10:00:00.000Z',
      acceptedAt: null,
      revokedAt: null,
    };
    expect(statusOf(base)).toBe('Invited');
    expect(statusOf({ ...base, acceptedAt: '2026-01-16T10:00:00.000Z' })).toBe('Active');
    expect(statusOf({ ...base, revokedAt: '2026-01-17T10:00:00.000Z' })).toBe('Revoked');
  });
});
