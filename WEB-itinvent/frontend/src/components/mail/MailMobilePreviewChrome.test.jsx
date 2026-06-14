import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import MailMobilePreviewChrome from './MailMobilePreviewChrome';

function renderWithTheme(node) {
  return render(
    <ThemeProvider theme={createTheme()}>
      {node}
    </ThemeProvider>,
  );
}

const baseMessage = {
  id: 'msg-1',
  sender: 'boss@example.com',
  sender_email: 'boss@example.com',
  sender_display: 'Boss Name',
  to: ['user@example.com'],
  to_people: [{ name: 'User Name', email: 'user@example.com', display: 'User Name' }],
  cc: [],
  bcc: [],
  subject: 'Quarterly status update',
  received_at: '2026-03-31T10:00:00Z',
  is_read: false,
};

describe('MailMobilePreviewChrome', () => {
  it('renders subject, sender row, compact details toggle, and summarize button', () => {
    renderWithTheme(
      <MailMobilePreviewChrome
        selectedMessage={baseMessage}
        selectedConversation={null}
        viewMode="messages"
        folder="inbox"
        onBackToList={vi.fn()}
        getAvatarColor={() => '#336699'}
        getInitials={() => 'BN'}
        formatFullDate={() => '31.03.2026 10:00'}
        onSummarize={vi.fn()}
      />,
    );

    expect(screen.getByTestId('mail-mobile-preview-subject')).toHaveTextContent('Quarterly status update');
    expect(screen.getByTestId('mail-mobile-preview-sender')).toHaveTextContent('Boss Name');
    expect(screen.getByTestId('mail-mobile-preview-details-toggle')).toBeVisible();
    expect(screen.getByTestId('mail-mobile-preview-date')).toBeVisible();
    expect(screen.queryByText('From · Sent · To')).not.toBeInTheDocument();
    expect(screen.getByTestId('mail-mobile-preview-summarize')).toBeVisible();
  });

  it('opens details sheet from the compact toggle row', () => {
    renderWithTheme(
      <MailMobilePreviewChrome
        selectedMessage={baseMessage}
        selectedConversation={null}
        viewMode="messages"
        folder="inbox"
        onBackToList={vi.fn()}
        getAvatarColor={() => '#336699'}
        getInitials={() => 'BN'}
        formatFullDate={() => '31.03.2026 10:00'}
      />,
    );

    fireEvent.click(screen.getByTestId('mail-mobile-preview-details-toggle'));
    expect(screen.getByTestId('mail-mobile-preview-details-sheet')).toBeVisible();
    expect(screen.getByText('Детали письма')).toBeVisible();
  });
});
