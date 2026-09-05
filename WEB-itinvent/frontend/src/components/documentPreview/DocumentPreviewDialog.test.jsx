import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DocumentPreviewDialog from './DocumentPreviewDialog';

const desktopMocks = vi.hoisted(() => ({
  native: false,
  requestOpen: vi.fn(),
  requestPrint: vi.fn(),
}));

vi.mock('../../lib/platform', () => ({
  isNativeShellRuntime: () => desktopMocks.native,
}));

vi.mock('../../lib/desktopBridge', () => ({
  requestDesktopDownloadedFileAction: desktopMocks.requestOpen,
  requestDesktopOpenDownloadedFile: desktopMocks.requestOpen,
  requestDesktopPrintCurrent: desktopMocks.requestPrint,
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
    desktopMocks.requestOpen.mockReset();
    desktopMocks.requestPrint.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it('uses the semantic Desktop print command for a ready preview', async () => {
    setMobileMedia(false);
    desktopMocks.requestPrint.mockReturnValue(true);
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
    expect(desktopMocks.requestPrint).toHaveBeenCalledTimes(1);
    expect(browserPrint).not.toHaveBeenCalled();
  });

  it('falls back to browser print outside a capable Desktop host', async () => {
    setMobileMedia(false);
    desktopMocks.requestPrint.mockReturnValue(false);
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
    expect(browserPrint).toHaveBeenCalledTimes(1);
  });
});
