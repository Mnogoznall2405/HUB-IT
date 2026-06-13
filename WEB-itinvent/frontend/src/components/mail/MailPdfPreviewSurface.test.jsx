import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import MailPdfPreviewSurface, { clampPage, normalizePreviewSheets } from './MailPdfPreviewSurface';

const loadPdfDocumentFromUrl = vi.fn();
const renderPdfPage = vi.fn();

vi.mock('../../lib/pdfPreview', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadPdfDocumentFromUrl: (...args) => loadPdfDocumentFromUrl(...args),
    renderPdfPage: (...args) => renderPdfPage(...args),
  };
});

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
    loadPdfDocumentFromUrl.mockResolvedValue({
      numPages: 4,
      destroy: vi.fn(),
    });
    renderPdfPage.mockResolvedValue({ width: 120, height: 160 });
  });

  it('renders one PDF page on canvas and loads document from blob url', async () => {
    const { container } = renderWithTheme(
      <MailPdfPreviewSurface
        objectUrl="blob:preview"
        filename="report.docx"
        sourceKind="word"
        pageCount={4}
      />,
    );

    await waitFor(() => expect(loadPdfDocumentFromUrl).toHaveBeenCalledWith('blob:preview'));
    await waitFor(() => expect(renderPdfPage).toHaveBeenCalled());
    expect(container.querySelector('canvas')).toBeTruthy();
    expect(screen.getByText('1 / 4')).toBeTruthy();
  });

  it('switches excel sheet tab to the first page of the selected sheet', async () => {
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

    await waitFor(() => expect(renderPdfPage).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('tab', { name: 'Лист2' }));

    await waitFor(() => {
      expect(renderPdfPage).toHaveBeenCalledWith(expect.objectContaining({
        pageNumber: 3,
      }));
    });
    expect(screen.getByText('1 / 2')).toBeTruthy();
  });
});
