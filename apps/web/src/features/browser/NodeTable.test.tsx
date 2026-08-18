import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fixtures, type NodeListItem } from '@dataroom/contracts';
import { renderWithProviders } from '@/test/harness';
import { ApiClientError } from '@/lib/api';
import { NodeTable, type NodeTableProps } from './NodeTable';
import type { RenameController } from './NodeRow';

const folder: NodeListItem = fixtures.nodes.financials;
const file: NodeListItem = fixtures.nodes.overview;
const unknownSizeFolder: NodeListItem = { ...fixtures.nodes.legal, subtreeSizeBytes: null };

function setup(overrides: Partial<NodeTableProps> = {}): NodeTableProps {
  const props: NodeTableProps = {
    items: [folder, file],
    isLoading: false,
    error: null,
    onRetry: vi.fn(),
    sort: 'name',
    dir: 'asc',
    onSortChange: vi.fn(),
    canManage: true,
    actions: {
      onRename: vi.fn(),
      onMove: vi.fn(),
      onShare: vi.fn(),
      onDownload: vi.fn(),
      onDelete: vi.fn(),
    },
    onOpen: vi.fn(),
    ...overrides,
  };
  renderWithProviders(<NodeTable {...props} />);
  return props;
}

describe('NodeTable', () => {
  it('renders a skeleton while loading', () => {
    setup({ isLoading: true, items: [] });
    expect(screen.getByRole('status')).toHaveTextContent('Loading folder contents');
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });

  it('renders the empty state when the folder has no children', () => {
    setup({ items: [] });
    expect(screen.getByText('This folder is empty')).toBeInTheDocument();
    expect(screen.getByText(/Drop files here to upload them/)).toBeInTheDocument();
  });

  it('renders a read-only empty state for a viewer, with no create action', () => {
    setup({ items: [], canManage: false, actions: undefined, onNewFolder: undefined });
    expect(screen.getByText('There is nothing shared with you in here.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New folder' })).not.toBeInTheDocument();
  });

  it('renders an error state with retry', async () => {
    const props = setup({
      items: [],
      error: new ApiClientError('INTERNAL', 'boom', { status: 500 }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders one row per item with name, size and modified date', () => {
    setup();
    const rows = screen.getAllByRole('row');
    // header + two data rows
    expect(rows).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Financials' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'overview.pdf' })).toBeInTheDocument();
    expect(screen.getAllByText('15 Jan 2026')).toHaveLength(2);
  });

  it('shows subtree size for folders and own size for files', () => {
    setup();
    const folderRow = screen.getByTestId(`node-row-${folder.id}`);
    const fileRow = screen.getByTestId(`node-row-${file.id}`);
    expect(within(folderRow).getByText('1.5 MB')).toBeInTheDocument();
    expect(within(fileRow).getByText('512 KB')).toBeInTheDocument();
  });

  it('renders an em dash, not 0 B, for an unknown folder rollup', () => {
    setup({ items: [unknownSizeFolder] });
    const row = screen.getByTestId(`node-row-${unknownSizeFolder.id}`);
    expect(within(row).getByText('—')).toBeInTheDocument();
    expect(within(row).queryByText('0 B')).not.toBeInTheDocument();
  });

  it('opens a node when its name is activated', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Financials' }));
    expect(props.onOpen).toHaveBeenCalledWith(folder);
  });

  it('offers rename, move, share and delete on a folder, and download only on files', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Financials' }));
    const folderItems = (await screen.findAllByRole('menuitem')).map((item) => item.textContent);
    expect(folderItems).toEqual(['Rename', 'Move', 'Share', 'Delete']);

    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for overview.pdf' }));
    const fileItems = (await screen.findAllByRole('menuitem')).map((item) => item.textContent);
    expect(fileItems).toEqual(['Rename', 'Move', 'Share', 'Download', 'Delete']);
  });

  it('renders no action menu at all when the caller may not manage the folder', () => {
    setup({ canManage: false, actions: undefined });
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
  });

  it('marks the sorted column and flips direction on a second click', async () => {
    const props = setup();
    const nameHeader = screen.getAllByRole('columnheader')[0] as HTMLElement;
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');

    await userEvent.click(within(nameHeader).getByRole('button', { name: 'Name' }));
    expect(props.onSortChange).toHaveBeenCalledWith('name', 'desc');

    await userEvent.click(screen.getByRole('button', { name: 'Size' }));
    expect(props.onSortChange).toHaveBeenCalledWith('size', 'asc');
  });

  it('selects a row on click', async () => {
    setup();
    const row = screen.getByTestId(`node-row-${folder.id}`);
    expect(row).toHaveAttribute('aria-selected', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Financials' }));
    expect(row).toHaveAttribute('aria-selected', 'true');
  });

  it('renders a footer slot for the load-more sentinel', () => {
    setup({ footer: <span>sentinel</span> });
    expect(screen.getByText('sentinel')).toBeInTheDocument();
  });
});

describe('NodeTable at tablet width and below', () => {
  /**
   * The table collapses to a list rather than dropping columns: size and modified move onto a
   * second line under the name and become columns again from `md` up. Asserted on the layout
   * classes because jsdom has no viewport — but the point being defended is that no value is
   * thrown away when the viewport narrows, which the DOM assertions below do check directly.
   */
  it('moves size and modified under the name instead of hiding them', () => {
    setup();
    const row = screen.getByTestId(`node-row-${file.id}`);
    const [, size, updated] = within(row).getAllByRole('gridcell');

    expect(size?.className).toContain('row-start-2');
    expect(size?.className).toContain('md:row-start-1');
    expect(updated?.className).toContain('row-start-2');
    expect(updated?.className).toContain('md:row-start-1');

    // Still rendered, still one of each: the collapse is a layout change, not a data loss.
    expect(within(row).getByText('512 KB')).toBeInTheDocument();
    expect(within(row).getByText('15 Jan 2026')).toBeInTheDocument();
  });

  it('keeps the name column heading, and with it sorting, when the numeric headings go', () => {
    setup();
    const [name, size, updated] = screen.getAllByRole('columnheader');

    expect(name?.className).not.toContain('hidden');
    expect(size?.className).toContain('hidden md:block');
    expect(updated?.className).toContain('hidden md:block');
  });
});

function renameProps(overrides: Partial<RenameController> = {}): { rename: RenameController } {
  return {
    rename: {
      activeId: folder.id,
      error: null,
      onCommit: vi.fn(),
      onCancel: vi.fn(),
      ...overrides,
    },
  };
}

describe('NodeTable inline rename', () => {
  it('swaps the name for an input, commits on Enter', async () => {
    const props = setup(renameProps());
    const input = screen.getByLabelText('Rename Financials');
    await userEvent.clear(input);
    await userEvent.type(input, 'Finance{Enter}');
    expect(props.rename?.onCommit).toHaveBeenCalledWith(folder, 'Finance');
  });

  it('cancels on Escape without committing', async () => {
    const props = setup(renameProps());
    const input = screen.getByLabelText('Rename Financials');
    await userEvent.type(input, 'anything{Escape}');
    expect(props.rename?.onCancel).toHaveBeenCalledTimes(1);
    expect(props.rename?.onCommit).not.toHaveBeenCalled();
  });

  it('commits on blur', async () => {
    const props = setup(renameProps());
    const input = screen.getByLabelText('Rename Financials');
    await userEvent.clear(input);
    await userEvent.type(input, 'Blurred');
    await userEvent.tab();
    expect(props.rename?.onCommit).toHaveBeenCalledWith(folder, 'Blurred');
  });

  it('keeps the input open with the typed text and an inline error on conflict', () => {
    setup(renameProps({ error: 'That name is already taken' }));
    expect(screen.getByLabelText('Rename Financials')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('That name is already taken');
  });

  it('commits only once even if blur follows Enter', async () => {
    const props = setup(renameProps());
    const input = screen.getByLabelText('Rename Financials');
    await userEvent.type(input, '{Enter}');
    await userEvent.tab();
    expect(props.rename?.onCommit).toHaveBeenCalledTimes(1);
  });

  it('offers no inline edit mode when no rename controller is supplied', () => {
    setup();
    expect(screen.queryByLabelText('Rename Financials')).not.toBeInTheDocument();
  });
});
