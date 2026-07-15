import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import React, { forwardRef, useEffect } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import MailPdfPreviewSurface, { clampPage, normalizePreviewSheets } from './MailPdfPreviewSurface';

const loadPdfDocumentFromUrl = vi.fn();
const renderPdfPage = vi.fn();
const resetTransformMock = vi.fn();

vi.mock('./MailPdfPageTile', () => ({
  default: forwardRef(({ pageNumber, onVisibilityChange }, ref) => {
    useEffect(() => {
      onVisibilityChange?.(pageNumber, 1);
    }, [onVisibilityChange, pageNumber]);
    return <div ref={ref} data-testid={`mail-pdf-page-tile-${pageNumber}`} />;
  }),
}));

vi.mock('../../lib/useDocumentPinchPan', () => ({
  default: () => ({
    viewportRef: { current: null },
    contentRef: { current: null },
    transform: { scale: 1, x: 0, y: 0 },
    isZoomed: false,
    resetTransform: resetTransformMock,
    viewportSx: { overflowY: 'auto', overflowX: 'hidden' },
    contentSx: {},
  }),
}));

vi.mock('../../lib/pdfPreview', () => ({
  loadPdfDocumentFromUrl: (...args) => loadPdfDocumentFromUrl(...args),
  renderPdfPage: (...args) => renderPdfPage(...args),
  isPdfRenderCancellation: (error) => (
    error?.name === 'AbortError' || error?.name === 'RenderingCancelledException'
  ),
  resolveInitialPdfFitZoom: () => 1,
  clampPdfDisplayScale: (value) => Number(value || 1),
  normalizePdfRotation: (value = 0) => ((Number(value || 0) % 360) + 360) % 360,
}));

const renderWithTheme = (node) => render(
  <ThemeProvider theme={createTheme()}>
    {node}
  </ThemeProvider>,
);

describe('MailPdfPreviewSurface helpers', () => {
  it('clamps page numbers inside document bounds', () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(9, 5)).toBe(5);
    expect(clampPage(3, 5)).toBe(3);
  });

  it('normalizes sheet metadata with page ranges', () => {
    expect(normalizePreviewSheets([
      { index: 0, name: 'Лист1', page: 1, page_end: 2, page_count: 2 },
      { index: 1, name: 'Лист2', page: 3, page_count: 1 },
    ])).toEqual([
      expect.objectContaining({ index: 0, name: 'Лист1', page: 1, pageEnd: 2, pageCount: 2 }),
      expect.objectContaining({ index: 1, name: 'Лист2', page: 3, pageEnd: 3, pageCount: 1 }),
    ]);
  });
});

describe('MailPdfPreviewSurface', () => {
  beforeEach(() => {
    loadPdfDocumentFromUrl.mockReset();
    renderPdfPage.mockReset();
    renderPdfPage.mockResolvedValue({ width: 600, height: 800 });
    loadPdfDocumentFromUrl.mockResolvedValue({
      numPages: 4,
      getPage: vi.fn().mockResolvedValue({
        getViewport: () => ({ width: 600, height: 800 }),
      }),
      destroy: vi.fn(),
    });
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders vertical page tiles and loads document from blob url', async () => {
    renderWithTheme(
      <MailPdfPreviewSurface
        objectUrl="blob:preview"
        filename="report.docx"
        sourceKind="word"
        pageCount={4}
        fillContainer
      />,
    );

    await waitFor(() => expect(loadPdfDocumentFromUrl).toHaveBeenCalledWith('blob:preview'));
    await waitFor(() => expect(screen.getByTestId('mail-pdf-page-tile-1')).toBeTruthy());
    expect(screen.getByTestId('mail-pdf-page-tile-2')).toBeTruthy();
    expect(screen.getByTestId('mail-pdf-page-tile-3')).toBeTruthy();
    expect(screen.getByTestId('mail-pdf-page-tile-4')).toBeTruthy();
    expect(screen.getByText('1 / 4')).toBeTruthy();
    expect(screen.getByTestId('mail-pdf-preview-viewport')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Увеличить/i })).toBeNull();
  });

  it('aborts an obsolete compact canvas render when rotation changes', async () => {
    renderPdfPage
      .mockImplementationOnce(({ signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('cancelled');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      }))
      .mockResolvedValueOnce({ width: 800, height: 600 });

    const view = renderWithTheme(
      <MailPdfPreviewSurface objectUrl="blob:compact" compact rotation={0} />,
    );
    await waitFor(() => expect(renderPdfPage).toHaveBeenCalledTimes(1));
    const firstSignal = renderPdfPage.mock.calls[0][0].signal;

    view.rerender(
      <ThemeProvider theme={createTheme()}>
        <MailPdfPreviewSurface objectUrl="blob:compact" compact rotation={90} />
      </ThemeProvider>,
    );

    await waitFor(() => expect(firstSignal.aborted).toBe(true));
    await waitFor(() => expect(renderPdfPage).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('cancelled')).toBeNull();
  });

  it('scrolls to the selected excel sheet page when tab is clicked', async () => {
    renderWithTheme(
      <MailPdfPreviewSurface
        objectUrl="blob:excel-preview"
        filename="table.xlsx"
        sourceKind="excel"
        pageCount={4}
        sheets={[
          { index: 0, name: 'Лист1', page: 1, page_end: 2, page_count: 2 },
          { index: 1, name: 'Лист2', page: 3, page_end: 4, page_count: 2 },
        ]}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('mail-pdf-page-tile-3')).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: 'Лист2' }));

    await waitFor(() => {
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });
  });
});
