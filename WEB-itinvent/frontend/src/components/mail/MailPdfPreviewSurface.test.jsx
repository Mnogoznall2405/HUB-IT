import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import React, { forwardRef, useEffect } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import MailPdfPreviewSurface, { clampPage, normalizePreviewSheets } from './MailPdfPreviewSurface';

const loadPdfDocumentFromUrl = vi.fn();
const resetTransformMock = vi.fn();

vi.mock('./MailPdfPageTile', () => ({
  default: forwardRef(({ pageNumber, onVisibilityChange }, ref) => {
    useEffect(() => {
      onVisibilityChange?.(pageNumber, 1);
    }, [pageNumber]);
    return <div ref={ref} data-testid={`mail-pdf-page-tile-${pageNumber}`} />;
  }),
}));

vi.mock('../../lib/pdfPreview', () => ({
  loadPdfDocumentFromUrl: (...args) => loadPdfDocumentFromUrl(...args),
  renderPdfPage: vi.fn(),
  resolveInitialPdfFitZoom: () => 1,
}));

vi.mock('../../lib/useDocumentPinchPan', () => ({
  default: () => ({
    viewportRef: { current: null },
    contentRef: { current: null },
    isZoomed: false,
    resetTransform: resetTransformMock,
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    viewportProps: {},
    viewportSx: { overflow: 'auto' },
    contentSx: {},
  }),
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
