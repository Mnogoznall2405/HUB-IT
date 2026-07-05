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

  it('renders hero attachments and opens them with message context', () => {
    const reportAttachment = {
      id: 'att-1',
      name: 'quarterly-report.pdf',
      size: 24 * 1024,
      content_type: 'application/pdf',
      downloadable: true,
    };
    const props = buildProps({
      renderState: {
        ...buildProps().renderState,
        visibleAttachments: [reportAttachment],
        attachmentTotalSize: '24 KB',
      },
    });

    renderWithTheme(<MailMessageReader {...props} />);

    expect(screen.getByTestId('mail-attachment-hero-item-0')).toBeVisible();
    fireEvent.click(screen.getByTestId('mail-attachment-hero-item-0'));
    expect(props.onOpenAttachment).toHaveBeenCalledTimes(1);
    expect(props.onOpenAttachment).toHaveBeenCalledWith(props.message, reportAttachment);
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

  it('renders hybrid attachment strip for many files on desktop and mobile', () => {
    const attachments = Array.from({ length: 5 }, (_, index) => ({
      id: `att-${index}`,
      name: `report-${index}.pdf`,
      size: 16 * 1024,
      content_type: 'application/pdf',
    }));
    const props = buildProps({
      isMobile: false,
      renderState: {
        ...buildProps().renderState,
        visibleAttachments: attachments,
        attachmentTotalSize: '80 KB',
      },
    });

    renderWithTheme(<MailMessageReader {...props} />);

    expect(screen.getByTestId('mail-attachment-summary-row')).toBeVisible();
    expect(screen.getByTestId('mail-attachment-compact-strip')).toBeVisible();
    expect(screen.getAllByTestId(/^mail-attachment-compact-card-/)).toHaveLength(5);
  });
});
