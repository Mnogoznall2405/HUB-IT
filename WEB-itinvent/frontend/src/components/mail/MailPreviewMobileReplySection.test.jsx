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
        quickReplyBody="Thanks"
        onSendQuickReply={onSendQuickReply}
        smartReplySuggestions={['Sounds good', 'Will review']}
      />,
    );

    expect(screen.getByTestId('mail-preview-mobile-reply-section')).toBeVisible();
    expect(screen.getByTestId('mail-quick-reply-bar')).toBeVisible();
    expect(screen.getByTestId('mail-smart-reply-chips')).toBeVisible();

    fireEvent.click(screen.getByTestId('mail-quick-reply-send'));
    expect(onSendQuickReply).toHaveBeenCalledTimes(1);
  });
});
