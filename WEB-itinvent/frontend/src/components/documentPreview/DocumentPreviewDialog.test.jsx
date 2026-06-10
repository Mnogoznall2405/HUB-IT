import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DocumentPreviewDialog from './DocumentPreviewDialog';

vi.mock('../mail/MailPdfPreviewSurface', () => ({
  default: () => <div data-testid="pdf-surface" />,
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
});
