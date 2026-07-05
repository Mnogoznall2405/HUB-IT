import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import MailPreviewMobileFooter from './MailPreviewMobileFooter';

function renderWithTheme(node) {
  return render(
    <ThemeProvider theme={createTheme()}>
      {node}
    </ThemeProvider>,
  );
}

describe('MailPreviewMobileFooter', () => {
  it('renders only the fixed inline action bar', () => {
    renderWithTheme(
      <MailPreviewMobileFooter
        actionBarProps={{
          selectedMessage: { id: 'msg-1', subject: 'Hello', is_read: false },
          selectedConversation: null,
          viewMode: 'messages',
          folder: 'inbox',
          messageActionLoading: false,
          onOpenComposeFromDraft: vi.fn(),
          onOpenComposeFromMessage: vi.fn(),
          onToggleReadState: vi.fn(),
          onRestoreSelectedMessage: vi.fn(),
          onDeleteSelectedMessage: vi.fn(),
          onArchiveSelectedMessage: vi.fn(),
          moveTarget: '',
          onMoveTargetChange: vi.fn(),
          onMoveSelectedMessage: vi.fn(),
          moveTargets: [],
          onOpenHeaders: vi.fn(),
          onDownloadSource: vi.fn(),
          onPrintSelectedMessage: vi.fn(),
        }}
      />,
    );

    expect(screen.getByTestId('mail-preview-mobile-footer')).toBeVisible();
    expect(screen.queryByTestId('mail-quick-reply-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mail-smart-reply-chips')).not.toBeInTheDocument();
    expect(screen.getByTestId('mail-preview-mobile-bottom-bar')).toHaveAttribute('data-layout', 'inline');
  });
});
