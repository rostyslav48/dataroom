import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fixtures } from '@dataroom/contracts';
import { useMockApi } from '@/test/msw';
import { renderWithProviders } from '@/test/harness';
import { childrenOf, getNode } from '@/mocks/db';
import { forceError } from '@/mocks/errorMode';
import { Toaster, useToastStore } from '@/components/ui/Toast';
import { FolderPage } from './FolderPage';
import { disabledReasonFor } from './FolderTreePicker';

useMockApi();

beforeEach(() => {
  useToastStore.getState().clear();
});

const { IDS } = fixtures;
const roomContext = { kind: 'room', roomId: IDS.room } as const;

function renderFolder(nodeId: string = IDS.rootNode): void {
  renderWithProviders(<FolderPage nodeId={nodeId} context={roomContext} />, {
    route: `/rooms/${IDS.room}/f/${nodeId}`,
  });
}

async function openMoveFor(name: string): Promise<void> {
  await screen.findByRole('button', { name });
  await userEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Move' }));
  await screen.findByRole('tree', { name: 'Choose a destination folder' });
}

describe('disabledReasonFor', () => {
  const moving = fixtures.nodes.financials;

  it('rejects the node itself', () => {
    expect(disabledReasonFor({ node: { id: moving.id }, insideMovingSubtree: false }, moving, IDS.rootNode))
      .toContain("can't be moved inside itself");
  });

  it('rejects a descendant of the node', () => {
    expect(disabledReasonFor({ node: { id: IDS.folderQ3 }, insideMovingSubtree: true }, moving, IDS.rootNode))
      .toContain('inside “Financials”');
  });

  it('rejects the current parent as a no-op', () => {
    expect(disabledReasonFor({ node: { id: IDS.rootNode }, insideMovingSubtree: false }, moving, IDS.rootNode))
      .toContain('already here');
  });

  it('accepts an unrelated folder', () => {
    expect(disabledReasonFor({ node: { id: IDS.folderLegal }, insideMovingSubtree: false }, moving, IDS.rootNode))
      .toBeNull();
  });
});

describe('MoveDialog', () => {
  it('shows the tree from the root, with the current parent disabled and explained', async () => {
    renderFolder();
    await openMoveFor('Financials');

    const tree = screen.getByRole('tree', { name: 'Choose a destination folder' });
    const root = within(tree).getByRole('button', { name: 'Project Atlas' });
    expect(root).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('“Financials” is already here.')).toBeInTheDocument();
  });

  it('disables the moving folder itself and everything inside it, rather than hiding them', async () => {
    renderFolder();
    await openMoveFor('Financials');

    const tree = screen.getByRole('tree', { name: 'Choose a destination folder' });
    const self = await within(tree).findByRole('button', { name: 'Financials' });
    expect(self).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText("“Financials” can't be moved inside itself.")).toBeInTheDocument();

    await userEvent.click(within(tree).getByRole('button', { name: 'Expand Financials' }));
    const descendant = await within(tree).findByRole('button', { name: 'Q3' });
    expect(descendant).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByText('This folder is inside “Financials”, which is the folder being moved.'),
    ).toBeInTheDocument();
  });

  it('keeps Move disabled until a valid destination is chosen', async () => {
    renderFolder();
    await openMoveFor('Financials');
    expect(screen.getByRole('button', { name: 'Move here' })).toBeDisabled();

    const tree = screen.getByRole('tree', { name: 'Choose a destination folder' });
    await userEvent.click(within(tree).getByRole('button', { name: 'Project Atlas' }));
    expect(screen.getByRole('button', { name: 'Move here' })).toBeDisabled();

    await userEvent.click(await within(tree).findByRole('button', { name: 'Legal' }));
    expect(screen.getByRole('button', { name: 'Move here' })).toBeEnabled();
  });

  it('moves the node and removes it from the current listing', async () => {
    renderFolder();
    await openMoveFor('Financials');

    const tree = screen.getByRole('tree', { name: 'Choose a destination folder' });
    await userEvent.click(await within(tree).findByRole('button', { name: 'Legal' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move here' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(getNode(IDS.folderFin)?.parentId).toBe(IDS.folderLegal);
    });
    expect(screen.queryByRole('button', { name: 'Financials' })).not.toBeInTheDocument();
  });

  it('toasts the move, because the item lands somewhere the user cannot see', async () => {
    renderWithProviders(
      <>
        <FolderPage nodeId={IDS.rootNode} context={roomContext} />
        <Toaster />
      </>,
      { route: `/rooms/${IDS.room}/f/${IDS.rootNode}` },
    );
    await openMoveFor('Financials');

    const tree = screen.getByRole('tree', { name: 'Choose a destination folder' });
    await userEvent.click(await within(tree).findByRole('button', { name: 'Legal' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move here' }));

    expect(await screen.findByText('Moved “Financials”')).toBeInTheDocument();
  });

  it('never toasts a rejected move: the reason belongs beside the picker', async () => {
    renderWithProviders(
      <>
        <FolderPage nodeId={IDS.rootNode} context={roomContext} />
        <Toaster />
      </>,
      { route: `/rooms/${IDS.room}/f/${IDS.rootNode}` },
    );
    await openMoveFor('Financials');

    const tree = screen.getByRole('tree', { name: 'Choose a destination folder' });
    await userEvent.click(await within(tree).findByRole('button', { name: 'Legal' }));
    forceError('INTERNAL', { endpointKey: 'nodes.move', times: 2 });
    await userEvent.click(screen.getByRole('button', { name: 'Move here' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(screen.getByTestId('toast-region').textContent).toBe('');
  });

  it('explains a name clash at the destination and leaves the tree untouched', async () => {
    renderFolder();
    await openMoveFor('Financials');

    forceError('NAME_CONFLICT', { endpointKey: 'nodes.move', times: 1 });
    const tree = screen.getByRole('tree', { name: 'Choose a destination folder' });
    await userEvent.click(await within(tree).findByRole('button', { name: 'Legal' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move here' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Another item in this folder already uses that name',
    );
    expect(getNode(IDS.folderFin)?.parentId).toBe(IDS.rootNode);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Financials' })).toBeInTheDocument();
    });
    expect(childrenOf(IDS.rootNode).map((node) => node.name)).toContain('Financials');
  });

  it('explains a rejected cycle', async () => {
    renderFolder();
    await openMoveFor('Financials');

    forceError('CYCLE_NOT_ALLOWED', { endpointKey: 'nodes.move', times: 1 });
    const tree = screen.getByRole('tree', { name: 'Choose a destination folder' });
    await userEvent.click(await within(tree).findByRole('button', { name: 'Legal' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move here' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Pick a destination outside the folder you are moving',
    );
  });

  it('reports a failure to load a branch of the tree', async () => {
    renderFolder();
    await openMoveFor('Financials');

    forceError('INTERNAL', { endpointKey: 'nodes.children' });
    const tree = screen.getByRole('tree', { name: 'Choose a destination folder' });
    await userEvent.click(within(tree).getByRole('button', { name: 'Expand Financials' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
  });

  it('says so when a folder has no folders inside it', async () => {
    renderFolder();
    await openMoveFor('Financials');

    const tree = screen.getByRole('tree', { name: 'Choose a destination folder' });
    await userEvent.click(await within(tree).findByRole('button', { name: 'Expand Legal' }));
    expect(await within(tree).findByText('No folders inside')).toBeInTheDocument();
  });
});
