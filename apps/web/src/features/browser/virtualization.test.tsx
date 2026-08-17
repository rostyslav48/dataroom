import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NodeListItem } from '@dataroom/contracts';
import { renderWithProviders } from '@/test/harness';
import { NodeTable, VIRTUALIZE_THRESHOLD } from './NodeTable';

/**
 * jsdom has neither layout nor a ResizeObserver, so the virtualiser is given a viewport by hand.
 * Without this every measured height is zero and the window has no size to compute.
 */
const VIEWPORT_HEIGHT = 660;
let restoreRect: (() => void) | undefined;

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {
        /* measurements come from the stubbed rect below */
      }
      unobserve(): void {
        /* no-op */
      }
      disconnect(): void {
        /* no-op */
      }
    },
  );

  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => VIEWPORT_HEIGHT,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 900,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => VIEWPORT_HEIGHT,
  });

  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function getRect(this: HTMLElement): DOMRect {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: VIEWPORT_HEIGHT,
      right: 900,
      width: 900,
      height: VIEWPORT_HEIGHT,
      toJSON: () => ({}),
    } as DOMRect;
  };
  restoreRect = () => {
    HTMLElement.prototype.getBoundingClientRect = original;
  };
});

afterAll(() => {
  restoreRect?.();
  vi.unstubAllGlobals();
});

function makeItems(count: number): NodeListItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(500_000_000_000 + index).slice(-12)}`,
    dataRoomId: '00000000-0000-4000-8000-000000000010',
    parentId: '00000000-0000-4000-8000-000000000100',
    type: 'file' as const,
    name: `document-${String(index).padStart(4, '0')}.pdf`,
    sizeBytes: 2048,
    mimeType: 'application/pdf',
    subtreeFileCount: null,
    subtreeSizeBytes: null,
    createdAt: '2026-01-15T10:00:00.000Z',
    updatedAt: '2026-01-15T10:00:00.000Z',
  }));
}

function renderTable(items: NodeListItem[]): void {
  renderWithProviders(
    <NodeTable
      items={items}
      isLoading={false}
      error={null}
      onRetry={vi.fn()}
      sort="name"
      dir="asc"
      onSortChange={vi.fn()}
      canManage
      actions={{ onRename: vi.fn() }}
      onOpen={vi.fn()}
    />,
  );
}

describe('NodeTable virtualization', () => {
  it('renders every row without windowing below the threshold', () => {
    renderTable(makeItems(VIRTUALIZE_THRESHOLD));
    const grid = screen.getByRole('grid');
    expect(within(grid).getAllByRole('row')).toHaveLength(VIRTUALIZE_THRESHOLD + 1);
  });

  it('renders only a window of 5,000 rows, and reports the full count to assistive tech', () => {
    renderTable(makeItems(5000));

    const grid = screen.getByRole('grid');
    expect(grid).toHaveAttribute('aria-rowcount', '5000');

    const rendered = within(grid).getAllByRole('row').length - 1; // minus the header row
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(100);

    // The first rows are the ones on screen, and the last row exists only in the model.
    expect(screen.getByRole('button', { name: 'document-0000.pdf' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'document-4999.pdf' })).not.toBeInTheDocument();
  });

  it('keeps the rows interactive inside the window', async () => {
    renderTable(makeItems(5000));
    await userEvent.click(screen.getByRole('button', { name: 'document-0001.pdf' }));
    expect(screen.getByRole('button', { name: 'Actions for document-0001.pdf' })).toBeInTheDocument();
  });
});
