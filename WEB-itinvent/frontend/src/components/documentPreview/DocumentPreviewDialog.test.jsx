import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DocumentPreviewDialog from './DocumentPreviewDialog';

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
});
