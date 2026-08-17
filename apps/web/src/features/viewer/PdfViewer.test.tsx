import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { pdfjs } from 'react-pdf';
import { tokenStore } from '@/lib/tokenStore';
import { PdfViewer } from './PdfViewer';

interface CapturedFile {
  url: string;
  httpHeaders: Record<string, string>;
  withCredentials: boolean;
}

const captured: { file: CapturedFile | null } = { file: null };

vi.mock('react-pdf', () => ({
  pdfjs: { GlobalWorkerOptions: { workerSrc: '' } },
  Document: (props: { file: CapturedFile; children: React.ReactNode }) => {
    captured.file = props.file;
    return <div data-testid="document">{props.children}</div>;
  },
  Page: () => <div data-testid="page" />,
}));

describe('PdfViewer', () => {
  it('pins the pdf.js worker to a local asset rather than a CDN', () => {
    render(
      <PdfViewer
        fileUrl="/api/v1/nodes/n1/content"
        pageNumber={1}
        scale={1}
        onLoadSuccess={vi.fn()}
        onLoadError={vi.fn()}
      />,
    );

    const workerSrc = pdfjs.GlobalWorkerOptions.workerSrc;
    expect(workerSrc).toContain('pdf.worker');
    for (const cdn of ['unpkg.com', 'cdnjs', 'jsdelivr', 'cloudflare']) {
      expect(workerSrc).not.toContain(cdn);
    }
  });

  it('sends the in-memory access token with the document request', () => {
    tokenStore.set('viewer-token', '2026-01-15T10:15:00.000Z');
    render(
      <PdfViewer
        fileUrl="/api/v1/nodes/n1/content"
        pageNumber={1}
        scale={1}
        onLoadSuccess={vi.fn()}
        onLoadError={vi.fn()}
      />,
    );

    expect(captured.file?.httpHeaders.Authorization).toBe('Bearer viewer-token');
    expect(captured.file?.withCredentials).toBe(true);
    tokenStore.clear();
  });

  it('sends the share token when browsing a public link', () => {
    render(
      <PdfViewer
        fileUrl="/api/v1/nodes/n1/content"
        shareToken="TOKEN123"
        pageNumber={1}
        scale={1}
        onLoadSuccess={vi.fn()}
        onLoadError={vi.fn()}
      />,
    );

    expect(captured.file?.httpHeaders['x-share-token']).toBe('TOKEN123');
    expect(screen.getByTestId('page')).toBeInTheDocument();
  });
});
