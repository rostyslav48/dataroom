import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { fixtures, type NodeListItem } from '@dataroom/contracts';
import { useMockApi } from '@/test/msw';
import { renderWithProviders } from '@/test/harness';
import { NodeTable, type NodeTableProps } from './NodeTable';
import { FolderPage } from './FolderPage';

/**
 * SPEC-07 §Accessibility: arrows move selection, Enter opens, F2 renames, Delete deletes, Escape
 * closes — and the acceptance criterion is that the whole flow is completable without a mouse.
 * The last test here does exactly that against the mock API, touching only the keyboard.
 */

const folder: NodeListItem = fixtures.nodes.financials;
const file: NodeListItem = fixtures.nodes.overview;

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

const rowOf = (node: NodeListItem): HTMLElement => screen.getByTestId(`node-row-${node.id}`);

/** Focus is where keyboard behaviour starts, and moving it re-renders — hence the `act`. */
function focusElement(element: HTMLElement): HTMLElement {
  act(() => {
    element.focus();
  });
  return element;
}

const focusFirstRow = (): HTMLElement => focusElement(rowOf(folder));

describe('NodeTable keyboard navigation', () => {
  it('keeps exactly one row in the tab order and moves it with the selection', async () => {
    setup();
    expect(rowOf(folder)).toHaveAttribute('tabindex', '0');
    expect(rowOf(file)).toHaveAttribute('tabindex', '-1');

    focusFirstRow();
    await userEvent.keyboard('{ArrowDown}');

    expect(rowOf(folder)).toHaveAttribute('tabindex', '-1');
    expect(rowOf(file)).toHaveAttribute('tabindex', '0');
  });

  it('moves the selection and the focus with the arrow keys', async () => {
    setup();
    focusFirstRow();

    await userEvent.keyboard('{ArrowDown}');
    expect(rowOf(file)).toHaveAttribute('aria-selected', 'true');
    expect(rowOf(file)).toHaveFocus();

    await userEvent.keyboard('{ArrowUp}');
    expect(rowOf(folder)).toHaveAttribute('aria-selected', 'true');
    expect(rowOf(folder)).toHaveFocus();
  });

  it('stops at the ends rather than wrapping, and Home and End jump', async () => {
    setup();
    focusFirstRow();

    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(rowOf(folder)).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{End}');
    expect(rowOf(file)).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowDown}');
    expect(rowOf(file)).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{Home}');
    expect(rowOf(folder)).toHaveAttribute('aria-selected', 'true');
  });

  it('opens the selected row on Enter', async () => {
    const props = setup();
    focusFirstRow();

    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(props.onOpen).toHaveBeenCalledWith(file);
  });

  it('starts a rename on F2 and asks to delete on Delete', async () => {
    const props = setup();
    focusFirstRow();

    await userEvent.keyboard('{ArrowDown}{F2}');
    expect(props.actions?.onRename).toHaveBeenCalledWith(file);

    await userEvent.keyboard('{Delete}');
    expect(props.actions?.onDelete).toHaveBeenCalledWith(file);
  });

  it('accepts Backspace for Delete, since most laptops have no forward-delete key', async () => {
    const props = setup();
    focusFirstRow();

    await userEvent.keyboard('{ArrowDown}{Backspace}');
    expect(props.actions?.onDelete).toHaveBeenCalledWith(file);
  });

  it('clears the selection on Escape', async () => {
    setup();
    focusFirstRow();

    await userEvent.keyboard('{ArrowDown}');
    expect(rowOf(file)).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Escape}');
    expect(rowOf(file)).toHaveAttribute('aria-selected', 'false');
  });

  it('offers no rename or delete shortcut to a viewer', async () => {
    const props = setup({ canManage: false, actions: undefined });
    focusFirstRow();

    await userEvent.keyboard('{ArrowDown}{F2}{Delete}');
    expect(rowOf(file)).toHaveAttribute('aria-selected', 'true');
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it('leaves every key to the rename input while it is open', async () => {
    const props = setup({
      rename: { activeId: folder.id, error: null, onCommit: vi.fn(), onCancel: vi.fn() },
    });

    const input = focusElement(screen.getByLabelText('Rename Financials'));
    await userEvent.keyboard('{ArrowDown}');

    // The grid neither moved the selection nor stole the keystroke from the field.
    expect(rowOf(file)).toHaveAttribute('aria-selected', 'false');
    expect(props.actions?.onRename).not.toHaveBeenCalled();
    expect(input).toHaveFocus();
  });

  it('leaves Enter to the name button when that is what holds focus', async () => {
    const props = setup();
    focusElement(within(rowOf(folder)).getByRole('button', { name: 'Financials' }));

    await userEvent.keyboard('{Enter}');
    // Once, from the button's own click — not a second time from the grid handler.
    expect(props.onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('NodeTable row-count announcements', () => {
  /** Stands in for the page: a mutation lands and the list it renders gets shorter. */
  function MutatingTable(): JSX.Element {
    const [items, setItems] = useState<NodeListItem[]>([folder, file]);
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setItems((current) => current.slice(0, -1));
          }}
        >
          drop one
        </button>
        <NodeTable
          items={items}
          isLoading={false}
          error={null}
          onRetry={vi.fn()}
          sort="name"
          dir="asc"
          onSortChange={vi.fn()}
          canManage
          onOpen={vi.fn()}
        />
      </>
    );
  }

  it('says nothing on first render and announces the count once a mutation changes it', async () => {
    renderWithProviders(<MutatingTable />);
    const region = screen.getByTestId('row-count-announcement');

    expect(region).toHaveAttribute('aria-live', 'polite');
    // Silent on arrival: a live region that speaks the moment a page loads is noise.
    expect(region.textContent).toBe('');

    await userEvent.click(screen.getByRole('button', { name: 'drop one' }));
    expect(region).toHaveTextContent('1 item in this folder');

    await userEvent.click(screen.getByRole('button', { name: 'drop one' }));
    expect(region).toHaveTextContent('0 items in this folder');
  });
});

describe('the whole flow, keyboard only', () => {
  useMockApi();

  const { IDS } = fixtures;

  function LocationProbe(): JSX.Element {
    const location = useLocation();
    return <span data-testid="pathname">{location.pathname}</span>;
  }

  it('selects, renames, cancels, asks to delete and opens a folder without a mouse', async () => {
    renderWithProviders(
      <>
        <LocationProbe />
        <FolderPage nodeId={IDS.rootNode} context={{ kind: 'room', roomId: IDS.room }} />
      </>,
      { route: `/rooms/${IDS.room}/f/${IDS.rootNode}`, withAuth: true },
    );

    await screen.findByRole('button', { name: 'Financials' });
    focusElement(screen.getByTestId(`node-row-${IDS.folderFin}`));

    // F2 renames in place, Escape restores.
    await userEvent.keyboard('{F2}');
    const input = await screen.findByLabelText('Rename Financials');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(input).not.toBeInTheDocument();
    });

    // Delete opens the confirmation, which Escape closes — Radix owns the trap and the key.
    focusElement(screen.getByTestId(`node-row-${IDS.folderFin}`));
    await userEvent.keyboard('{Delete}');
    expect(await screen.findByRole('dialog')).toHaveTextContent('Delete “Financials”');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // And Enter navigates into it.
    focusElement(screen.getByTestId(`node-row-${IDS.folderFin}`));
    await userEvent.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent(
        `/rooms/${IDS.room}/f/${IDS.folderFin}`,
      );
    });
  });
});
