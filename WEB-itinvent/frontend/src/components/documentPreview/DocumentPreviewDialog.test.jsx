import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DocumentPreviewDialog from './DocumentPreviewDialog';

const desktopMocks = vi.hoisted(() => ({
  native: false,
  capabilities: new Set(),
  requestOpen: vi.fn(),
  requestPrint: vi.fn(),
}));

vi.mock('../../lib/platform', () => ({
  isNativeShellRuntime: () => desktopMocks.native,
}));

vi.mock('../../lib/desktopBridge', () => ({
  requestDesktopDownloadedFileAction: desktopMocks.requestOpen,
  requestDesktopOpenDownloadedFile: desktopMocks.requestOpen,
  requestDesktopPrintDocument: desktopMocks.requestPrint,
  isDesktopCapabilityAvailable: (name) => desktopMocks.capabilities.has(name),
}));

vi.mock('../mail/MailPdfPreviewSurface', () => ({
  default: ({ rotation = 0 }) => <div data-testid="pdf-surface" data-rotation={rotation} />,
}));

vi.mock('../mail/MailExcelPreviewGrid', () => ({
  default: () => <div data-testid="excel-grid" />,
}));

const theme = createTheme();

const setMobileMedia = (matches) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

const renderDialog = () => render(
  <ThemeProvider theme={theme}>
    <DocumentPreviewDialog
      open
      title="report.pdf"
      kind="pdf"
      loading
      onClose={vi.fn()}
    />
  </ThemeProvider>,
);

describe('DocumentPreviewDialog', () => {
  afterEach(() => {
    desktopMocks.native = false;
    desktopMocks.capabilities.clear();
    desktopMocks.requestOpen.mockReset();
    desktopMocks.requestPrint.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Print iframes live outside React's render tree — drop leftovers.
    document.querySelectorAll('iframe[aria-hidden="true"]').forEach((frame) => frame.remove());
  });

  it('uses fullscreen dialog on mobile media queries', () => {
    setMobileMedia(true);
    renderDialog();

    expect(screen.getByRole('dialog')).toHaveClass('MuiDialog-paperFullScreen');
  });

  it('uses fullscreen dialog on desktop media queries', () => {
    setMobileMedia(false);
    renderDialog();

    expect(screen.getByRole('dialog')).toHaveClass('MuiDialog-paperFullScreen');
  });

  it('keeps the fullscreen preview above every application modal', () => {
    setMobileMedia(false);
    renderDialog();

    const dialogRoot = screen.getByRole('dialog').closest('.MuiDialog-root');
    expect(dialogRoot).not.toBeNull();
    expect(window.getComputedStyle(dialogRoot).zIndex).toBe(String(theme.zIndex.tooltip - 1));
  });

  it('renders an image preview inline instead of the unavailable fallback', () => {
    setMobileMedia(false);
    render(
      <ThemeProvider theme={theme}>
        <DocumentPreviewDialog
          open
          title="photo.webp"
          kind="image"
          objectUrl="blob:preview-image"
          onClose={vi.fn()}
        />
      </ThemeProvider>,
    );

    const image = screen.getByRole('img', { name: 'photo.webp' });
    expect(image).toHaveAttribute('src', 'blob:preview-image');
    expect(screen.queryByText('Предпросмотр готовится или временно недоступен. Оригинал можно скачать.')).toBeNull();
  });

  it('rotates a PDF preview left and right without changing the source file', async () => {
    setMobileMedia(false);
    render(
      <ThemeProvider theme={theme}>
        <DocumentPreviewDialog
          open
          title="report.pdf"
          kind="pdf"
          objectUrl="blob:report"
          onClose={vi.fn()}
        />
      </ThemeProvider>,
    );

    expect(await screen.findByTestId('pdf-surface')).toHaveAttribute('data-rotation', '0');
    fireEvent.click(screen.getByRole('button', { name: 'Повернуть вправо' }));
    expect(screen.getByTestId('pdf-surface')).toHaveAttribute('data-rotation', '90');
    fireEvent.click(screen.getByRole('button', { name: 'Повернуть влево' }));
    expect(screen.getByTestId('pdf-surface')).toHaveAttribute('data-rotation', '0');
    fireEvent.click(screen.getByRole('button', { name: 'Повернуть влево' }));
    expect(screen.getByTestId('pdf-surface')).toHaveAttribute('data-rotation', '270');
  });

  it('downloads the original only after Desktop accepts the open intent', async () => {
    setMobileMedia(false);
    desktopMocks.native = true;
    desktopMocks.requestOpen.mockResolvedValue({ accepted: true, status: 'accepted' });
    const onDownloadOriginal = vi.fn();
    render(
      <ThemeProvider theme={theme}>
        <DocumentPreviewDialog
          open
          title="report.pdf"
          kind="pdf"
          onClose={vi.fn()}
          onDownloadOriginal={onDownloadOriginal}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Открыть в приложении' }));
    await waitFor(() => expect(onDownloadOriginal).toHaveBeenCalledTimes(1));
    expect(desktopMocks.requestOpen).toHaveBeenCalledWith('open');
  });

  it('labels the Desktop action as Word or Excel for Office files', () => {
    setMobileMedia(false);
    desktopMocks.native = true;
    render(
      <ThemeProvider theme={theme}>
        <DocumentPreviewDialog
          open
          title="report.xlsx"
          kind="office_excel"
          sourceKind="excel"
          onClose={vi.fn()}
          onDownloadOriginal={vi.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByRole('button', { name: 'Открыть в Excel' })).toBeTruthy();
  });

  it('shows a controlled message and does not download while another open intent is busy', async () => {
    setMobileMedia(false);
    desktopMocks.native = true;
    desktopMocks.requestOpen.mockResolvedValue({ accepted: false, status: 'busy' });
    const onDownloadOriginal = vi.fn();
    render(
      <ThemeProvider theme={theme}>
        <DocumentPreviewDialog
          open
          title="report.pdf"
          kind="pdf"
          onClose={vi.fn()}
          onDownloadOriginal={onDownloadOriginal}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Открыть в приложении' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Другая загрузка уже ожидает открытия');
    expect(onDownloadOriginal).not.toHaveBeenCalled();
  });

  it('uses the Desktop document-print command when the host supports it', async () => {
    setMobileMedia(false);
    desktopMocks.native = true;
    desktopMocks.capabilities.add('print-document');
    desktopMocks.requestPrint.mockResolvedValue({ accepted: true, status: 'dialog-opened' });
    const browserPrint = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(
      <ThemeProvider theme={theme}>
        <DocumentPreviewDialog
          open
          title="report.pdf"
          kind="pdf"
          objectUrl="blob:report"
          onClose={vi.fn()}
        />
      </ThemeProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Печать' }));
    await waitFor(() => expect(desktopMocks.requestPrint).toHaveBeenCalledWith({
      kind: 'pdf',
      url: 'blob:report',
      title: 'report.pdf',
    }));
    expect(browserPrint).not.toHaveBeenCalled();
    expect(document.querySelector('iframe[aria-hidden="true"]')).toBeNull();
  });

  it('shows an error with a download action when Desktop document printing fails', async () => {
    setMobileMedia(false);
    desktopMocks.native = true;
    desktopMocks.capabilities.add('print-document');
    desktopMocks.requestPrint.mockResolvedValue({ accepted: false, status: 'failed' });
    const onDownloadOriginal = vi.fn();
    const browserPrint = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(
      <ThemeProvider theme={theme}>
        <DocumentPreviewDialog
          open
          title="report.pdf"
          kind="pdf"
          objectUrl="blob:report"
          onClose={vi.fn()}
          onDownloadOriginal={onDownloadOriginal}
        />
      </ThemeProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Печать' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось распечатать документ');
    fireEvent.click(screen.getByRole('button', { name: 'Скачать оригинал' }));
    expect(onDownloadOriginal).toHaveBeenCalledTimes(1);
    expect(browserPrint).not.toHaveBeenCalled();
  });

  it('shows an error instead of printing the portal DOM in a Desktop host without the capability', async () => {
    setMobileMedia(false);
    desktopMocks.native = true;
    const browserPrint = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(
      <ThemeProvider theme={theme}>
        <DocumentPreviewDialog
          open
          title="report.pdf"
          kind="pdf"
          objectUrl="blob:report"
          onClose={vi.fn()}
        />
      </ThemeProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Печать' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось распечатать документ');
    expect(desktopMocks.requestPrint).not.toHaveBeenCalled();
    expect(browserPrint).not.toHaveBeenCalled();
  });

  it('prints the PDF bytes through a hidden iframe outside a capable Desktop host', async () => {
    setMobileMedia(false);
    const browserPrint = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(
      <ThemeProvider theme={theme}>
        <DocumentPreviewDialog
          open
          title="report.pdf"
          kind="pdf"
          objectUrl="blob:report"
          onClose={vi.fn()}
        />
      </ThemeProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Печать' }));
    // The browser must print the original PDF document, not the preview
    // canvas raster: a hidden iframe points at the same blob URL so the
    // browser PDF viewer drives the print pipeline.
    await waitFor(() => {
      const frame = document.querySelector('iframe[aria-hidden="true"]');
      expect(frame).not.toBeNull();
      expect(frame.src).toBe('blob:report');
    });
    expect(browserPrint).not.toHaveBeenCalled();
  });

  it('never falls back to window.print when no printable document source exists', async () => {
    setMobileMedia(false);
    const browserPrint = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(
      <ThemeProvider theme={theme}>
        <DocumentPreviewDialog
          open
          title="report.pdf"
          kind="pdf"
          onClose={vi.fn()}
        />
      </ThemeProvider>,
    );

    // No preview surface and no object URL: the dialog shows the
    // "preparing" fallback and the print button is not rendered at all.
    expect(screen.queryByRole('button', { name: 'Печать' })).toBeNull();
    expect(browserPrint).not.toHaveBeenCalled();
  });

  it('warns before printing a truncated sheets preview and only prints after confirmation', async () => {
    setMobileMedia(false);
    const browserPrint = vi.spyOn(window, 'print').mockImplementation(() => {});
    const rows = Array.from({ length: 600 }, (_, index) => [`r${index}`, index]);
    render(
      <ThemeProvider theme={theme}>
        <DocumentPreviewDialog
          open
          title="big.csv"
          kind="csv"
          sourceKind="csv"
          objectUrl="blob:csv"
          excelWorkbook={{ sheets: [{ name: 'Лист1', rows, totalRows: 4200 }] }}
          onClose={vi.fn()}
        />
      </ThemeProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Печать' }));
    const warning = await screen.findByRole('alert');
    expect(warning).toHaveTextContent('Предпросмотр ограничен');
    expect(document.querySelector('iframe[aria-hidden="true"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Печатать показанное' }));
    await waitFor(() => {
      const frame = document.querySelector('iframe[aria-hidden="true"]');
      expect(frame).not.toBeNull();
      expect(frame.srcdoc).toContain('<table>');
      expect(frame.srcdoc).toContain('Показаны первые 500 строк из 4200');
    });
    expect(browserPrint).not.toHaveBeenCalled();
  });
});
