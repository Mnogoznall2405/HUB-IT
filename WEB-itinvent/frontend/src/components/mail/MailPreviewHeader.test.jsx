import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
    mailboxEmails: ['user@example.com'],
    ...overrides,
  };
}

describe('MailPreviewHeader', () => {
  it('shows the first recipient immediately and expands the full list on demand', () => {
    renderWithTheme(<MailPreviewHeader {...buildProps()} />);

    expect(screen.getByLabelText('Назад к списку')).toBeTruthy();
    expect(screen.getByTestId('mail-preview-sender-label').textContent).toContain('От: Boss Name');
    expect(screen.getByTestId('mail-preview-recipients-label').textContent).toContain('Кому: Вы');
    expect(screen.queryByText(/User Name <user@example\.com>/i)).toBeNull();
    expect(screen.queryByTestId('mail-preview-mobile-bottom-bar')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /1 получатель/i }));
    expect(screen.getByText(/User Name <user@example\.com>/i)).toBeTruthy();
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

  it('renders summarize button as Сводка after reply and forward', () => {
    renderWithTheme(
      <MailPreviewHeader
        {...buildProps({
          compactMobile: false,
          showBackButton: false,
          onSummarize: vi.fn(),
        })}
      />,
    );

    expect(screen.getByTestId('mail-preview-summarize')).toHaveTextContent('Сводка');
    expect(screen.getByRole('button', { name: 'Ответить' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Переслать' })).toBeTruthy();
  });

  it('opens consent instead of summarizing when AI is disabled', () => {
    const onSummarize = vi.fn();
    const onRequestAiEnable = vi.fn();
    renderWithTheme(
      <MailPreviewHeader
        {...buildProps({
          compactMobile: false,
          showBackButton: false,
          onSummarize,
          aiEnabled: false,
          onRequestAiEnable,
        })}
      />,
    );

    fireEvent.click(screen.getByTestId('mail-preview-summarize'));
    expect(onRequestAiEnable).toHaveBeenCalledTimes(1);
    expect(onSummarize).not.toHaveBeenCalled();
  });

  it('shows real recipients on a sent message as From you / To recipient', () => {
    renderWithTheme(
      <MailPreviewHeader
        {...buildProps({
          compactMobile: false,
          showBackButton: false,
          folder: 'sent',
          mailboxEmails: ['me@company.ru'],
          selectedMessage: {
            ...buildProps().selectedMessage,
            sender_email: 'me@company.ru',
            sender_display: 'Current User',
            sender_person: { display: 'Current User', email: 'me@company.ru' },
            to_people: [
              { display: 'Иванов Сергей', email: 'ivanov@company.ru' },
              { display: 'Петрова Анна', email: 'petrova@company.ru' },
            ],
          },
        })}
      />,
    );

    expect(screen.getByTestId('mail-preview-sender-label').textContent).toContain('От: Вы');
    expect(screen.getByTestId('mail-preview-recipients-label').textContent).toContain('Кому: Иванов Сергей, Петрова Анна');
  });

  it('expands To/Cc/Bcc when the recipient line or +N is clicked', () => {
    renderWithTheme(
      <MailPreviewHeader
        {...buildProps({
          compactMobile: false,
          showBackButton: false,
          selectedMessage: {
            ...buildProps().selectedMessage,
            to_people: [
              { display: 'Вы', email: 'user@example.com' },
              { display: 'Иванов Сергей', email: 'ivanov@company.ru' },
              { display: 'Петрова Анна', email: 'petrova@company.ru' },
            ],
            cc_people: [{ display: 'Copy Person', email: 'cc@example.com' }],
          },
        })}
      />,
    );

    expect(screen.getByTestId('mail-preview-recipients-more')).toHaveTextContent('+1');
    expect(screen.queryByText(/Copy Person <cc@example\.com>/i)).toBeNull();

    fireEvent.click(screen.getByTestId('mail-preview-recipients-more'));
    expect(screen.getByText(/Copy Person <cc@example\.com>/i)).toBeTruthy();
  });

  it('shows Без получателя for a draft without recipients', () => {
    renderWithTheme(
      <MailPreviewHeader
        {...buildProps({
          compactMobile: false,
          showBackButton: false,
          folder: 'drafts',
          mailboxEmails: ['me@company.ru'],
          selectedMessage: {
            ...buildProps().selectedMessage,
            sender_email: 'me@company.ru',
            sender_display: 'Current User',
            sender_person: { display: 'Current User', email: 'me@company.ru' },
            to: [],
            to_people: [],
          },
        })}
      />,
    );

    expect(screen.getByTestId('mail-preview-sender-label').textContent).toContain('От: Вы');
    expect(screen.getByTestId('mail-preview-recipients-label').textContent).toContain('Кому: Без получателя');
  });

  it('keeps a long desktop subject on one line and lifts tiny metadata typography', () => {
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
    expect(getComputedStyle(screen.getByTestId('mail-preview-title')).webkitLineClamp).not.toBe('2');
    expect(getComputedStyle(screen.getByTestId('mail-preview-date')).fontSize).toBe('0.8125rem');
    expect(getComputedStyle(screen.getByTestId('mail-preview-sender-label')).fontSize).toBe('0.8125rem');
  });

  it('keeps reply and forward on the toolbar and lists folders under one heading', () => {
    const props = buildProps({
      compactMobile: false,
      showBackButton: false,
      moveTargets: [
        { value: 'junk', label: 'Нежелательные' },
        { value: 'sent', label: 'Отправленные' },
        { value: 'trash', label: 'Удаленные' },
      ],
    });
    renderWithTheme(<MailPreviewHeader {...props} />);

    expect(screen.getByRole('button', { name: 'Ответить' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Переслать' })).toBeTruthy();

    fireEvent.click(screen.getByTestId('mail-preview-desktop-more'));
    const menu = screen.getByTestId('mail-preview-desktop-more-menu');

    expect(within(menu).queryByRole('menuitem', { name: /^Ответить$/ })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: /^Переслать$/ })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Ответить всем' })).toBeNull();
    expect(within(menu).getByTestId('mail-move-to-heading')).toHaveTextContent('Переместить в');
    expect(within(menu).queryByText('Переместить в Отправленные')).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Отправленные' })).toBeTruthy();
    expect(within(menu).queryByTestId('mail-move-to-search')).toBeNull();

    fireEvent.click(screen.getByTestId('mail-move-to-option-sent'));
    expect(props.onMoveTargetChange).toHaveBeenCalledWith('sent');
    expect(props.onMoveSelectedMessage).toHaveBeenCalledWith('sent');
  });

  it('uses a reply-all split button when the message has other recipients', () => {
    const props = buildProps({
      compactMobile: false,
      showBackButton: false,
      selectedMessage: {
        ...buildProps().selectedMessage,
        to_people: [
          { display: 'User Name', email: 'user@example.com' },
          { display: 'Иванов Сергей', email: 'ivanov@company.ru' },
          { display: 'Петрова Анна', email: 'petrova@company.ru' },
        ],
      },
    });
    renderWithTheme(<MailPreviewHeader {...props} />);

    expect(screen.getByRole('button', { name: 'Ответить всем' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('mail-preview-reply-split-menu-button'));
    fireEvent.click(within(screen.getByTestId('mail-preview-reply-split-menu')).getByRole('menuitem', { name: 'Ответить' }));
    expect(props.onOpenComposeFromMessage).toHaveBeenCalledWith('reply');
  });

  it('opens a new compose when a recipient name is clicked', () => {
    const onComposeToPerson = vi.fn();
    renderWithTheme(
      <MailPreviewHeader
        {...buildProps({
          compactMobile: false,
          showBackButton: false,
          onComposeToPerson,
          selectedMessage: {
            ...buildProps().selectedMessage,
            to_people: [{ display: 'Иванов Сергей', email: 'ivanov@company.ru' }],
          },
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Иванов Сергей' }));
    expect(onComposeToPerson).toHaveBeenCalledWith(expect.objectContaining({
      email: 'ivanov@company.ru',
    }));
  });
});
