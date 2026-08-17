import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { API_BASE, fixtures } from '@dataroom/contracts';
import { useMockApi } from '@/test/msw';
import { renderWithProviders } from '@/test/harness';
import { server } from '@/mocks/server';
import { childrenOf, state } from '@/mocks/db';
import { forceError } from '@/mocks/errorMode';
import { FolderPage } from './FolderPage';
import { DeletePreviewSummary } from './DeletePreviewSummary';
import { ApiClientError } from '@/lib/api';

useMockApi();

const { IDS } = fixtures;
const roomContext = { kind: 'room', roomId: IDS.room } as const;

function renderFolder(nodeId: string = IDS.rootNode): void {
  renderWithProviders(<FolderPage nodeId={nodeId} context={roomContext} />, {
    route: `/rooms/${IDS.room}/f/${nodeId}`,
  });
}

async function openDeleteFor(name: string): Promise<void> {
  await screen.findByRole('button', { name });
  await userEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
}

function bigPreview(count: number): void {
  server.use(
    http.get(`*${API_BASE}/nodes/:id/delete-preview`, () =>
      HttpResponse.json({
        sizeBytes: 12_345_678,
        fileCount: count,
        folderCount: 4,
        affectedShareCount: 2,
      }),
    ),
  );
}

describe('DeletePreviewSummary', () => {
  it('renders a skeleton while the count is being computed', () => {
    renderWithProviders(
      <DeletePreviewSummary
        preview={undefined}
        isLoading
        error={null}
        nodeName="Financials"
        nodeType="folder"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Working out what will be deleted');
  });

  it('renders an error when the preview fails, saying deletion is blocked', () => {
    renderWithProviders(
      <DeletePreviewSummary
        preview={undefined}
        isLoading={false}
        error={new ApiClientError('INTERNAL', 'boom', { status: 500 })}
        nodeName="Financials"
        nodeType="folder"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Deleting is blocked');
  });

  it('spells out the counts, the size, the shares and the permanence', () => {
    renderWithProviders(
      <DeletePreviewSummary
        preview={{ sizeBytes: 1_572_864, fileCount: 12, folderCount: 3, affectedShareCount: 1 }}
        isLoading={false}
        error={null}
        nodeName="Financials"
        nodeType="folder"
      />,
    );
    expect(screen.getByText(/3 folders and 12 files, 1\.5 MB/)).toBeInTheDocument();
    expect(screen.getByText(/1 share will stop working/)).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
  });

  it('words an empty folder and a single file differently', () => {
    const { unmount } = renderWithProviders(
      <DeletePreviewSummary
        preview={{ sizeBytes: 0, fileCount: 0, folderCount: 0, affectedShareCount: 0 }}
        isLoading={false}
        error={null}
        nodeName="Empty"
        nodeType="folder"
      />,
    );
    expect(screen.getByText(/“Empty” is empty and will be deleted permanently/)).toBeInTheDocument();
    unmount();

    renderWithProviders(
      <DeletePreviewSummary
        preview={{ sizeBytes: 10, fileCount: 0, folderCount: 0, affectedShareCount: 0 }}
        isLoading={false}
        error={null}
        nodeName="NDA.pdf"
        nodeType="file"
      />,
    );
    expect(screen.getByText(/“NDA.pdf” will be deleted permanently/)).toBeInTheDocument();
  });
});

describe('DeleteConfirmDialog', () => {
  it('keeps Confirm disabled until the preview arrives', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`*${API_BASE}/nodes/:id/delete-preview`, async () => {
        await gate;
        return HttpResponse.json({
          sizeBytes: 1_572_864,
          fileCount: 1,
          folderCount: 1,
          affectedShareCount: 1,
        });
      }),
    );

    renderFolder();
    await openDeleteFor('Financials');

    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    release?.();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
    });
  });

  it('deletes after confirmation and removes the row', async () => {
    renderFolder();
    await openDeleteFor('Financials');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Financials' })).not.toBeInTheDocument();
    expect(childrenOf(IDS.rootNode).map((node) => node.name)).not.toContain('Financials');
  });

  it('requires typing the folder name once the subtree passes 50 items', async () => {
    bigPreview(60);
    renderFolder();
    await openDeleteFor('Financials');

    const confirm = await screen.findByRole('button', { name: 'Delete' });
    expect(confirm).toBeDisabled();
    expect(screen.getByText(/This removes 64 items/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Type the folder name to confirm/), 'Financial');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Type the folder name to confirm/), 's');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
    });
  });

  it('does not ask for a typed name for a small subtree', async () => {
    renderFolder();
    await openDeleteFor('Financials');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
    });
    expect(screen.queryByLabelText(/Type the folder name to confirm/)).not.toBeInTheDocument();
  });

  it('blocks deletion and explains when the preview itself fails', async () => {
    forceError('INTERNAL', { endpointKey: 'nodes.deletePreview' });
    renderFolder();
    await openDeleteFor('Financials');

    expect(await screen.findByRole('alert')).toHaveTextContent('Deleting is blocked');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  it('restores the row when the delete fails', async () => {
    renderFolder();
    await openDeleteFor('Financials');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
    });

    forceError('INTERNAL', { endpointKey: 'nodes.remove', times: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();

    // The dialog stays open on failure; closing it reveals the row the rollback restored.
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Financials' })).toBeInTheDocument();
    });
    expect(childrenOf(IDS.rootNode).map((node) => node.name)).toContain('Financials');
  });

  it('warns about shares that deletion will revoke', async () => {
    renderFolder();
    await openDeleteFor('Financials');
    expect(await screen.findByText(/1 share will stop working/)).toBeInTheDocument();
  });

  it('is not offered to a viewer', async () => {
    state.forcedAccess = 'viewer';
    state.forcedShareRootId = IDS.rootNode;
    renderFolder();
    await screen.findByRole('button', { name: 'Financials' });
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
  });
});
