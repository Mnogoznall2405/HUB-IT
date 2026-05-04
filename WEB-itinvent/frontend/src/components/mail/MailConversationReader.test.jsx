import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import MailConversationReader from './MailConversationReader';

function renderWithTheme(node) {
  return render(
    <ThemeProvider theme={createTheme()}>
      {node}
    </ThemeProvider>,
  );
}

function buildMessage(overrides = {}) {
  return {
    id: 'msg-1',
    sender: 'support@example.com',
    sender_display: 'Support Team',
    received_at: '2026-04-08T09:15:00Z',
    body_html: '<p>Conversation body text</p>',
    attachments: [],
    ...overrides,
  };
}

function buildProps(overrides = {}) {
  const message = buildMessage();

  return {
    conversation: {
      id: 'conversation-1',
      items: [message],
    },
    selectedMessage: message,
    scrollRef: React.createRef(),
    ui: {
      actionBg: '#f3f4f6',
      borderSoft: '#e5e7eb',
      chipRadius: 12,
      fontSizeFine: '0.75rem',
      inputRadius: 8,
      isDark: false,
      mutedText: '#667085',
      panelBg: '#ffffff',
      panelSolid: '#ffffff',
      radiusLg: '12px',
      radiusXs: '4px',
      selectedBorder: '#1976d2',
    },
    quickReplyBody: '',
    quickReplySending: false,
    onQuickReplyBodyChange: vi.fn(),
    onSendQuickReply: vi.fn(),
    onOpenComposeFromMessage: vi.fn(),
    onSelectMessage: vi.fn(),
    isOwnMessage: () => false,
    getSenderDisplay: (item) => item.sender_display || item.sender,
    getAvatarColor: () => '#1976d2',
    getInitials: () => 'ST',
    formatTime: () => '09:15',
    formatFileSize: (value) => `${Math.round(Number(value || 0) / 1024)} KB`,
    revealedRemoteImagesByMessageId: {},
    mailRenderColorScheme: 'light',
    getRenderedContentSx: () => ({}),
    onRevealRemoteImages: vi.fn(),
    onOpenAttachment: vi.fn(),
    onDownloadAttachment: vi.fn(),
    ...overrides,
  };
}

describe('MailConversationReader', () => {
  it('renders the conversation body', () => {
    renderWithTheme(<MailConversationReader {...buildProps()} />);

    expect(screen.getByText('Conversation body text')).toBeVisible();
    expect(screen.getByText('Support Team')).toBeVisible();
  });

  it('selects a message when the message bubble is clicked', () => {
    const selectedMessage = buildMessage({
      id: 'msg-select',
      body_html: '<p>Selectable message body</p>',
    });
    const props = buildProps({
      conversation: { id: 'conversation-1', items: [selectedMessage] },
      selectedMessage,
    });

    renderWithTheme(<MailConversationReader {...props} />);

    fireEvent.click(screen.getByText('Selectable message body'));

    expect(props.onSelectMessage).toHaveBeenCalledTimes(1);
    expect(props.onSelectMessage).toHaveBeenCalledWith(selectedMessage);
  });

  it('reveals blocked remote images without selecting the message', () => {
    const message = buildMessage({
      id: 'msg-remote',
      body_html: '<p>Remote image message</p><img src="https://cdn.example.com/logo.png" alt="Logo" />',
    });
    const props = buildProps({
      conversation: { id: 'conversation-1', items: [message] },
      selectedMessage: message,
      isMobile: true,
    });

    renderWithTheme(<MailConversationReader {...props} />);

    fireEvent.click(screen.getByRole('button'));

    expect(props.onRevealRemoteImages).toHaveBeenCalledTimes(1);
    expect(props.onRevealRemoteImages).toHaveBeenCalledWith('msg-remote');
    expect(props.onSelectMessage).not.toHaveBeenCalled();
  });

  it('calls quick reply body and send callbacks', () => {
    const props = buildProps({ quickReplyBody: 'Ready to send' });

    renderWithTheme(<MailConversationReader {...props} />);

    fireEvent.change(screen.getByTestId('mail-quick-reply-body'), {
      target: { value: 'Updated quick reply' },
    });
    fireEvent.click(screen.getByTestId('mail-quick-reply-send'));

    expect(props.onQuickReplyBodyChange).toHaveBeenCalledTimes(1);
    expect(props.onQuickReplyBodyChange).toHaveBeenCalledWith('Updated quick reply');
    expect(props.onSendQuickReply).toHaveBeenCalledTimes(1);
  });

  it('opens and downloads attachments with message and attachment context', () => {
    const attachment = {
      id: 'att-1',
      name: 'diagnostic-log.txt',
      size: 4 * 1024,
      content_type: 'text/plain',
      downloadable: true,
    };
    const message = buildMessage({
      id: 'msg-attachment',
      body_html: '<p>Attachment message body</p>',
      attachments: [attachment],
    });
    const props = buildProps({
      conversation: { id: 'conversation-1', items: [message] },
      selectedMessage: message,
      isMobile: true,
    });

    renderWithTheme(<MailConversationReader {...props} />);

    fireEvent.click(screen.getByText('diagnostic-log.txt').closest('button'));

    expect(props.onOpenAttachment).toHaveBeenCalledTimes(1);
    expect(props.onOpenAttachment).toHaveBeenCalledWith(message, attachment);

    fireEvent.click(screen.getByLabelText(/diagnostic-log\.txt/i));
    fireEvent.click(within(screen.getByRole('menu')).getAllByRole('menuitem')[1]);

    expect(props.onDownloadAttachment).toHaveBeenCalledTimes(1);
    expect(props.onDownloadAttachment).toHaveBeenCalledWith(message, attachment);
  });
});
