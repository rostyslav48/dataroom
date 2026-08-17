import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { API_BASE, fixtures } from '@dataroom/contracts';
import { server } from '@/mocks/server';
import { useMockApi } from '@/test/msw';
import { renderWithProviders } from '@/test/harness';
import { childrenOf } from '@/mocks/db';
import { forceError } from '@/mocks/errorMode';
import { FolderPage } from './FolderPage';

useMockApi();

const { IDS } = fixtures;
const roomContext = { kind: 'room', roomId: IDS.room } as const;

function renderFolder(nodeId: string = IDS.rootNode): void {
  renderWithProviders(<FolderPage nodeId={nodeId} context={roomContext} />, {
    route: `/rooms/${IDS.room}/f/${nodeId}`,
  });
}

async function openNewFolderDialog(): Promise<void> {
  await screen.findByRole('button', { name: 'Financials' });
  await userEvent.click(screen.getByRole('button', { name: 'New folder' }));
}

describe('NewFolderDialog', () => {
  it('is not offered to a viewer', async () => {
    renderWithProviders(<FolderPage nodeId={IDS.folderFin} context={{ kind: 'share', token: fixtures.PUBLIC_LINK_TOKEN }} />, {
      route: `/s/${fixtures.PUBLIC_LINK_TOKEN}/f/${IDS.folderFin}`,
    });
    await screen.findByRole('button', { name: 'Q3' });
    expect(screen.queryByRole('button', { name: 'New folder' })).not.toBeInTheDocument();
  });

  it('creates a folder and shows it in the listing', async () => {
    renderFolder();
    await openNewFolderDialog();

    await userEvent.type(screen.getByLabelText('Folder name'), 'Diligence');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('button', { name: 'Diligence' })).toBeInTheDocument();
    expect(childrenOf(IDS.rootNode).map((node) => node.name)).toContain('Diligence');
  });

  it('rejects an empty name inline, without a request', async () => {
    renderFolder();
    await openNewFolderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Name cannot be empty');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('keeps the dialog open with the typed name and an inline conflict message', async () => {
    renderFolder();
    await openNewFolderDialog();

    await userEvent.type(screen.getByLabelText('Folder name'), 'Legal');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Another item in this folder already uses that name',
    );
    expect(screen.getByLabelText('Folder name')).toHaveValue('Legal');
  });

  it('reports a server failure inline and keeps the dialog open', async () => {
    renderFolder();
    await openNewFolderDialog();

    forceError('INTERNAL', { endpointKey: 'nodes.createFolder', times: 1 });
    await userEvent.type(screen.getByLabelText('Folder name'), 'Diligence');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByLabelText('Folder name')).toHaveValue('Diligence');
  });

  it('can be opened from the empty state of an empty folder', async () => {
    renderFolder(IDS.folderQ3);
    await screen.findByRole('button', { name: 'balance-sheet.pdf' });
    expect(screen.getByRole('button', { name: 'New folder' })).toBeInTheDocument();
  });
});

describe('inline rename', () => {
  async function startRename(name: string): Promise<void> {
    await screen.findByRole('button', { name });
    await userEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
  }

  it('renames optimistically and persists', async () => {
    renderFolder();
    await startRename('Legal');

    const input = screen.getByLabelText('Rename Legal');
    await userEvent.clear(input);
    await userEvent.type(input, 'Contracts{Enter}');

    expect(await screen.findByRole('button', { name: 'Contracts' })).toBeInTheDocument();
    await waitFor(() => {
      expect(childrenOf(IDS.rootNode).map((node) => node.name)).toContain('Contracts');
    });
  });

  it('keeps the input open with an inline error on NAME_CONFLICT', async () => {
    renderFolder();
    await startRename('Legal');

    const input = screen.getByLabelText('Rename Legal');
    await userEvent.clear(input);
    await userEvent.type(input, 'Financials{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Another item in this folder already uses that name',
    );
    expect(screen.getByDisplayValue('Financials')).toBeInTheDocument();
  });

  it('rolls the optimistic name back when the server rejects it', async () => {
    renderFolder();
    await startRename('Legal');

    forceError('INTERNAL', { endpointKey: 'nodes.rename', times: 1 });
    const input = screen.getByLabelText('Rename Legal');
    await userEvent.clear(input);
    await userEvent.type(input, 'Rolled back{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    // The optimistic name is gone from the cache — the field's label still names the original row.
    expect(screen.getByLabelText('Rename Legal')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Legal' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Rolled back' })).not.toBeInTheDocument();
  });

  it('rejects an invalid name locally without a request', async () => {
    renderFolder();
    await startRename('Legal');

    const input = screen.getByLabelText('Rename Legal');
    await userEvent.clear(input);
    await userEvent.type(input, 'a/b{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('Name cannot contain / or \\');
    expect(childrenOf(IDS.rootNode).map((node) => node.name)).toContain('Legal');
  });

  it('treats an unchanged name as a cancel', async () => {
    renderFolder();
    await startRename('Legal');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.queryByLabelText('Rename Legal')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Legal' })).toBeInTheDocument();
  });

  it('shows the new name before the server answers, and rolls it back on failure', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.patch(`*${API_BASE}/nodes/:id`, async () => {
        await gate;
        return HttpResponse.json(
          { code: 'INTERNAL', message: 'nope', requestId: 'req-1' },
          { status: 500 },
        );
      }),
    );

    renderFolder();
    await startRename('Legal');
    const input = screen.getByLabelText('Rename Legal');
    await userEvent.clear(input);
    await userEvent.type(input, 'Instant{Enter}');

    // Optimistic: the row shows the new name while the request is still in flight.
    await waitFor(() => {
      expect(screen.getByLabelText('Rename Instant')).toBeInTheDocument();
    });

    release?.();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    await waitFor(() => {
      expect(screen.getByLabelText('Rename Legal')).toBeInTheDocument();
    });
  });

  it('restores the original name on Escape', async () => {
    renderFolder();
    await startRename('Legal');

    const input = screen.getByLabelText('Rename Legal');
    await userEvent.clear(input);
    await userEvent.type(input, 'Abandoned{Escape}');

    expect(screen.getByRole('button', { name: 'Legal' })).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Abandoned')).not.toBeInTheDocument();
  });
});
