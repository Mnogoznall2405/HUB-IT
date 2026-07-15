import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import MailPdfPageTile from './MailPdfPageTile';

const renderPdfPage = vi.fn();

vi.mock('../../lib/pdfPreview', () => ({
  renderPdfPage: (...args) => renderPdfPage(...args),
  isPdfRenderCancellation: (error) => (
    error?.name === 'AbortError' || error?.name === 'RenderingCancelledException'
  ),
}));

const renderWithTheme = (node) => render(
  <ThemeProvider theme={createTheme()}>{node}</ThemeProvider>,
);

describe('MailPdfPageTile', () => {
  it('aborts an obsolete render when rotation changes and hides cancellation errors', async () => {
    let rejectFirst;
    renderPdfPage
      .mockImplementationOnce(({ signal }) => new Promise((_resolve, reject) => {
        rejectFirst = () => {
          const error = new Error('cancelled');
          error.name = 'AbortError';
          reject(error);
        };
        signal.addEventListener('abort', rejectFirst, { once: true });
      }))
      .mockResolvedValueOnce({ height: 320 });

    const props = {
      pageNumber: 1,
      pdf: { numPages: 1 },
      fitScale: 1,
      rotation: 0,
    };
    const view = renderWithTheme(<MailPdfPageTile {...props} />);
    await waitFor(() => expect(renderPdfPage).toHaveBeenCalledTimes(1));
    const firstSignal = renderPdfPage.mock.calls[0][0].signal;

    view.rerender(
      <ThemeProvider theme={createTheme()}>
        <MailPdfPageTile {...props} rotation={90} />
      </ThemeProvider>,
    );

    await waitFor(() => expect(firstSignal.aborted).toBe(true));
    await waitFor(() => expect(renderPdfPage).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('cancelled')).toBeNull();
  });
});
