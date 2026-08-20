import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import MailPreviewMobileReplySection from './MailPreviewMobileReplySection';

function renderWithTheme(node) {
  return render(
    <ThemeProvider theme={createTheme()}>
      {node}
    </ThemeProvider>,
  );
}

describe('MailPreviewMobileReplySection', () => {
  it('renders quick reply and smart reply chips below the message body', () => {
    const onSendQuickReply = vi.fn();
    renderWithTheme(
      <MailPreviewMobileReplySection
        quickReplyDraftKey="msg-1"
        onSendQuickReply={onSendQuickReply}
        smartReplySuggestions={['Sounds good', 'Will review']}
      />,
    );

    expect(screen.getByTestId('mail-preview-mobile-reply-section')).toBeVisible();
    expect(screen.getByTestId('mail-quick-reply-bar')).toBeVisible();
    expect(screen.getByTestId('mail-smart-reply-chips')).toBeVisible();

    fireEvent.change(screen.getByTestId('mail-quick-reply-input'), {
      target: { value: 'Thanks' },
    });
    fireEvent.click(screen.getByTestId('mail-quick-reply-send'));
    expect(onSendQuickReply).toHaveBeenCalledTimes(1);
    expect(onSendQuickReply).toHaveBeenCalledWith('Thanks');
  });

  it('inserts a smart reply chip into the draft without sending', () => {
    const onSendQuickReply = vi.fn();
    renderWithTheme(
      <MailPreviewMobileReplySection
        quickReplyDraftKey="msg-1"
        onSendQuickReply={onSendQuickReply}
        smartReplySuggestions={['Sounds good', 'Will review']}
      />,
    );

    fireEvent.click(screen.getByTestId('mail-smart-reply-chip-0'));
    expect(onSendQuickReply).not.toHaveBeenCalled();
    expect(screen.getByTestId('mail-quick-reply-input')).toHaveValue('Sounds good');
  });

  it('hides chips when smartReplyChipsEnabled is false', () => {
    const onSendQuickReply = vi.fn();
    renderWithTheme(
      <MailPreviewMobileReplySection
        quickReplyDraftKey="msg-1"
        onSendQuickReply={onSendQuickReply}
        smartReplySuggestions={['Sounds good']}
        smartReplyChipsEnabled={false}
      />,
    );

    expect(screen.queryByTestId('mail-smart-reply-chips')).not.toBeInTheDocument();
    expect(onSendQuickReply).not.toHaveBeenCalled();
  });

  it('does not call onSend while typing', () => {
    const onSendQuickReply = vi.fn();
    renderWithTheme(
      <MailPreviewMobileReplySection
        quickReplyDraftKey="msg-1"
        onSendQuickReply={onSendQuickReply}
      />,
    );

    fireEvent.change(screen.getByTestId('mail-quick-reply-input'), {
      target: { value: 'Hi' },
    });
    expect(onSendQuickReply).not.toHaveBeenCalled();
  });
});
