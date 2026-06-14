import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import MailPreviewMobileActionBar from './MailPreviewMobileActionBar';

function renderWithTheme(node) {
  return render(
    <ThemeProvider theme={createTheme()}>
      {node}
    </ThemeProvider>,
  );
}

function buildProps(overrides = {}) {
  return {
    selectedMessage: {
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
    },
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
    moveTargets: [
      { value: 'archive', label: 'Архив' },
      { value: 'sent', label: 'Отправленные' },
    ],
    onOpenHeaders: vi.fn(),
    onDownloadSource: vi.fn(),
    onPrintSelectedMessage: vi.fn(),
    ...overrides,
  };
}

describe('MailPreviewMobileActionBar', () => {
  it('renders inline mobile actions and opens the secondary sheet', () => {
    const props = buildProps();
    renderWithTheme(<MailPreviewMobileActionBar {...props} />);

    const bottomBar = screen.getByTestId('mail-preview-mobile-bottom-bar');
    expect(bottomBar).toBeVisible();
    expect(bottomBar).toHaveAttribute('data-layout', 'inline');

    fireEvent.click(screen.getByRole('button', { name: /^Ответить$/i }));
    expect(props.onOpenComposeFromMessage).toHaveBeenCalledWith('reply');

    fireEvent.click(screen.getByRole('button', { name: /^Переслать$/i }));
    expect(props.onOpenComposeFromMessage).toHaveBeenCalledWith('forward');

    fireEvent.click(screen.getByRole('button', { name: /^Прочитано$/i }));
    expect(props.onToggleReadState).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^Удалить$/i }));
    expect(props.onDeleteSelectedMessage).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole('button', { name: /^Ещё$/i }));
    expect(screen.getByTestId('mail-preview-mobile-actions-sheet')).toBeVisible();
    expect(screen.getByText('Ответить всем')).toBeTruthy();
    expect(screen.getAllByText('Архив').length).toBeGreaterThan(0);
  });

  it('opens a scrollable mobile move sheet from the message action sheet', () => {
    const moveTargets = Array.from({ length: 14 }, (_, index) => ({
      value: `folder-${index + 1}`,
      label: `Folder ${index + 1}`,
    }));
    const props = buildProps({ moveTargets });

    renderWithTheme(<MailPreviewMobileActionBar {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /^Ещё$/i }));
    fireEvent.click(screen.getByTestId('mail-preview-mobile-open-move-sheet'));

    const moveSheet = screen.getByTestId('mail-preview-mobile-move-sheet');
    expect(moveSheet).toBeVisible();
    expect(screen.getByTestId('mail-preview-mobile-move-option-folder-14')).toBeTruthy();

    fireEvent.click(screen.getByTestId('mail-preview-mobile-move-option-folder-14'));

    expect(props.onMoveTargetChange).toHaveBeenCalledWith('folder-14');
    expect(props.onMoveSelectedMessage).toHaveBeenCalledWith('folder-14');
  });
});
