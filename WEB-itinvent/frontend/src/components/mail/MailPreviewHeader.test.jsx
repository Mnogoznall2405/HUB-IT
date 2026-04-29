import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import MailPreviewHeader from './MailPreviewHeader';

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
    getAvatarColor: () => '#1976d2',
    getInitials: () => 'BE',
    formatFullDate: () => '31 марта 2026 г. в 10:00',
    showBackButton: true,
    onBackToList: vi.fn(),
    compactMobile: true,
    ...overrides,
  };
}

describe('MailPreviewHeader', () => {
  it('keeps recipients collapsed by default and opens secondary actions in the mobile bottom sheet', () => {
    const props = buildProps();
    renderWithTheme(<MailPreviewHeader {...props} />);

    expect(screen.getByLabelText('Назад к списку')).toBeTruthy();
    expect(screen.getByText('Boss Name')).toBeTruthy();
    expect(screen.queryByText(/user@example.com/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Кому: 1 получателей/i }));
    expect(screen.getByText(/User Name <user@example\.com>/i)).toBeTruthy();

    fireEvent.click(screen.getByTestId('mail-preview-mobile-more'));
    expect(screen.getByTestId('mail-preview-mobile-actions-sheet')).toBeVisible();
    expect(screen.getByText('Удалить')).toBeTruthy();

    fireEvent.click(screen.getByText('Ответить'));
    expect(props.onOpenComposeFromMessage).toHaveBeenCalledWith('reply');
  });

  it('does not render a permanent desktop action row and exposes secondary actions through the menu', () => {
    renderWithTheme(<MailPreviewHeader {...buildProps({ compactMobile: false, showBackButton: false })} />);

    expect(screen.queryByRole('button', { name: /^Удалить$/i })).toBeNull();
    fireEvent.click(screen.getByTestId('mail-preview-desktop-more'));

    expect(screen.getAllByText('Удалить').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Заголовки').length).toBeGreaterThan(0);
  });
  it('opens forward compose from the dedicated preview header button', () => {
    const props = buildProps({ compactMobile: false, showBackButton: false });
    renderWithTheme(<MailPreviewHeader {...props} />);

    fireEvent.click(screen.getByTestId('mail-preview-forward'));

    expect(props.onOpenComposeFromMessage).toHaveBeenCalledWith('forward');
  });

  it('opens a scrollable mobile move sheet from the message action sheet', () => {
    const moveTargets = Array.from({ length: 14 }, (_, index) => ({
      value: `folder-${index + 1}`,
      label: `Folder ${index + 1}`,
    }));
    const props = buildProps({ moveTargets });

    renderWithTheme(<MailPreviewHeader {...props} />);

    fireEvent.click(screen.getByTestId('mail-preview-mobile-more'));
    fireEvent.click(screen.getByTestId('mail-preview-mobile-open-move-sheet'));

    const moveSheet = screen.getByTestId('mail-preview-mobile-move-sheet');
    expect(moveSheet).toBeVisible();
    expect(screen.getByTestId('mail-preview-mobile-move-option-folder-14')).toBeTruthy();

    fireEvent.click(screen.getByTestId('mail-preview-mobile-move-option-folder-14'));

    expect(props.onMoveTargetChange).toHaveBeenCalledWith('folder-14');
    expect(props.onMoveSelectedMessage).toHaveBeenCalledWith('folder-14');
  });

  it('keeps a long desktop subject clamped and lifts tiny metadata typography', () => {
    const longSubject = 'Very long customer support thread subject that should stay readable without forcing the preview header onto a single line';

    renderWithTheme(
      <MailPreviewHeader
        {...buildProps({
          compactMobile: false,
          showBackButton: false,
          selectedMessage: {
            ...buildProps().selectedMessage,
            subject: longSubject,
          },
        })}
      />
    );

    expect(screen.getByTestId('mail-preview-title').textContent).toBe(longSubject);
    expect(getComputedStyle(screen.getByTestId('mail-preview-title')).webkitLineClamp).toBe('2');
    expect(getComputedStyle(screen.getByTestId('mail-preview-date')).fontSize).toBe('0.8rem');
    expect(getComputedStyle(screen.getByTestId('mail-preview-sender-label')).fontSize).toBe('0.78rem');
  });
});
