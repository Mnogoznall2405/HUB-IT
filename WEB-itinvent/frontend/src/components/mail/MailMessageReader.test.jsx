import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import MailMessageReader from './MailMessageReader';

function renderWithTheme(node) {
  return render(
    <ThemeProvider theme={createTheme()}>
      {node}
    </ThemeProvider>,
  );
}

function buildProps(overrides = {}) {
  return {
    message: {
      id: 'msg-1',
      subject: 'Status update',
    },
    renderState: {
      renderResult: {},
      visibleAttachments: [],
      attachmentTotalSize: '',
      hasQuotedHistory: false,
      quotedHtml: '',
      usesQuoteFallback: false,
      messageHtml: '<p>Current message body</p>',
      showQuotedHistory: false,
      toggleQuotedHistory: vi.fn(),
    },
    ui: {
      radiusMd: 8,
      mutedText: '#667085',
    },
    formatFileSize: (value) => `${Math.round(Number(value || 0) / 1024)} KB`,
    getRenderedContentSx: () => ({}),
    onRevealRemoteImages: vi.fn(),
    onOpenAttachment: vi.fn(),
    onDownloadAttachment: vi.fn(),
    ...overrides,
  };
}

describe('MailMessageReader', () => {
  it('shows blocked external images action and reveals them for the current message', () => {
    const props = buildProps({
      renderState: {
        ...buildProps().renderState,
        renderResult: { hasBlockedExternalImages: true },
      },
    });

    renderWithTheme(<MailMessageReader {...props} />);

    const alert = screen.getByRole('alert');
    const revealButton = within(alert).getByRole('button');
    expect(revealButton).toBeVisible();

    fireEvent.click(revealButton);

    expect(props.onRevealRemoteImages).toHaveBeenCalledTimes(1);
    expect(props.onRevealRemoteImages).toHaveBeenCalledWith('msg-1');
  });

  it('renders attachments and calls open and download actions with message context', () => {
    const reportAttachment = {
      id: 'att-1',
      name: 'quarterly-report.pdf',
      size: 24 * 1024,
      content_type: 'application/pdf',
      downloadable: true,
    };
    const imageAttachment = {
      id: 'att-2',
      name: 'diagram.png',
      size: 8 * 1024,
      content_type: 'image/png',
      downloadable: true,
    };
    const props = buildProps({
      renderState: {
        ...buildProps().renderState,
        visibleAttachments: [reportAttachment, imageAttachment],
        attachmentTotalSize: '32 KB',
      },
    });

    renderWithTheme(<MailMessageReader {...props} />);

    expect(screen.getByText('quarterly-report.pdf')).toBeVisible();
    expect(screen.getByText('diagram.png')).toBeVisible();
    expect(screen.getByText('24 KB')).toBeVisible();
    expect(screen.getByText('8 KB')).toBeVisible();

    fireEvent.click(screen.getByText('quarterly-report.pdf').closest('button'));
    expect(props.onOpenAttachment).toHaveBeenCalledTimes(1);
    expect(props.onOpenAttachment).toHaveBeenCalledWith(props.message, reportAttachment);

    fireEvent.click(screen.getByLabelText(/quarterly-report\.pdf/i));
    fireEvent.click(within(screen.getByRole('menu')).getAllByRole('menuitem')[1]);

    expect(props.onDownloadAttachment).toHaveBeenCalledTimes(1);
    expect(props.onDownloadAttachment).toHaveBeenCalledWith(props.message, reportAttachment);
  });

  it('shows quoted history toggle and calls its callback', () => {
    const toggleQuotedHistory = vi.fn();
    const props = buildProps({
      renderState: {
        ...buildProps().renderState,
        hasQuotedHistory: true,
        quotedHtml: '<blockquote><p>Previous reply</p></blockquote>',
        messageHtml: '<p>Latest reply</p>',
        showQuotedHistory: false,
        toggleQuotedHistory,
      },
    });

    renderWithTheme(<MailMessageReader {...props} />);

    expect(screen.getByText('Latest reply')).toBeVisible();
    expect(screen.queryByText('Previous reply')).toBeNull();

    const toggleButton = screen.getByRole('button');
    expect(toggleButton).toBeVisible();
    fireEvent.click(toggleButton);

    expect(toggleQuotedHistory).toHaveBeenCalledTimes(1);
  });
});
