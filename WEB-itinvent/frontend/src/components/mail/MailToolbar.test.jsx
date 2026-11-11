import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import MailToolbar from './MailToolbar';

function renderWithTheme(node) {
  return render(
    <ThemeProvider theme={createTheme()}>
      {node}
    </ThemeProvider>,
  );
}

const mailbox = {
  id: 'mb-1',
  label: 'Support mailbox with a very long display name',
  mailbox_email: 'support@example.com',
  unread_count: 4,
  is_primary: true,
};

describe('MailToolbar', () => {
  it('renders the mobile native toolbar with navigation, mailbox switcher, overflow and search', () => {
    renderWithTheme(
      <MailToolbar
        mobile
        search="report"
        activeMailbox={mailbox}
        mailboxes={[mailbox]}
        onSearchChange={vi.fn()}
        onOpenToolsMenu={vi.fn()}
        onOpenNavigation={vi.fn()}
        onSelectMailbox={vi.fn()}
        onManageMailboxes={vi.fn()}
        onCompose={vi.fn()}
        hasActiveFilters
      />,
    );

    expect(screen.getByTestId('mail-toolbar-mobile-header')).toHaveStyle({
      paddingTop: 'calc(8px + env(safe-area-inset-top, 0px))',
    });
    expect(screen.getByTestId('mail-toolbar-open-navigation')).toBeTruthy();
    expect(screen.getByTestId('mail-toolbar-mobile-mailbox-switcher')).toBeTruthy();
    expect(screen.getByTestId('mail-toolbar-open-tools')).toBeTruthy();
    expect(screen.getByTestId('mail-toolbar-mobile-search')).toBeTruthy();
    expect(screen.getByDisplayValue('report')).toBeTruthy();
    expect(screen.getByLabelText('Написать письмо')).toBeTruthy();
  });

  it('keeps desktop controls on a single compact row without repeating the module title or folder chip', () => {
    renderWithTheme(
      <MailToolbar
        search=""
        activeMailbox={mailbox}
        mailboxes={[mailbox]}
        onSearchChange={vi.fn()}
        onRefresh={vi.fn()}
        onOpenAdvancedSearch={vi.fn()}
        onOpenToolsMenu={vi.fn()}
        onSelectMailbox={vi.fn()}
        onManageMailboxes={vi.fn()}
        canOpenStorage
      />,
    );

    expect(screen.getByTestId('mail-toolbar-desktop')).toBeTruthy();
    expect(screen.getByTestId('mail-toolbar-search')).toBeTruthy();
    expect(screen.getByPlaceholderText('Поиск по теме, адресу и тексту…')).toBeTruthy();
    expect(screen.queryByText('Почта')).toBeNull();
    expect(screen.queryByTestId('mail-section-tabs')).toBeNull();
    expect(screen.queryByText('Отправленные')).toBeNull();
    expect(screen.getByTestId('mail-toolbar-mailbox-switcher')).toHaveStyle({ maxWidth: '220px' });
  });

  it('embeds into the app header as a single compact row without extra chrome', () => {
    renderWithTheme(
      <MailToolbar
        embedded
        search=""
        activeMailbox={mailbox}
        mailboxes={[mailbox]}
        onSearchChange={vi.fn()}
        onRefresh={vi.fn()}
        onOpenAdvancedSearch={vi.fn()}
        onOpenToolsMenu={vi.fn()}
        onSelectMailbox={vi.fn()}
        onManageMailboxes={vi.fn()}
      />,
    );

    expect(screen.getByTestId('mail-toolbar-desktop')).toHaveAttribute('data-embedded', 'true');
    expect(screen.getByPlaceholderText('Поиск по теме, адресу и тексту…')).toBeTruthy();
    expect(screen.queryByText('Почта')).toBeNull();
    expect(screen.queryByTestId('mail-section-tabs')).toBeNull();
  });

  it('opens storage from the mailbox menu', () => {
    const onOpenStorage = vi.fn();
    renderWithTheme(
      <MailToolbar
        activeMailbox={mailbox}
        mailboxes={[mailbox]}
        onSelectMailbox={vi.fn()}
        onManageMailboxes={vi.fn()}
        canOpenStorage
        onOpenStorage={onOpenStorage}
      />,
    );

    fireEvent.click(screen.getByTestId('mail-toolbar-mailbox-switcher'));
    fireEvent.click(screen.getByTestId('mail-toolbar-open-storage'));
    expect(onOpenStorage).toHaveBeenCalledTimes(1);
  });

  it('offers back-to-mail from the mailbox menu while storage is open', () => {
    const onBackFromStorage = vi.fn();
    renderWithTheme(
      <MailToolbar
        activeMailbox={mailbox}
        mailboxes={[mailbox]}
        onSelectMailbox={vi.fn()}
        onManageMailboxes={vi.fn()}
        canOpenStorage
        storageActive
        onBackFromStorage={onBackFromStorage}
      />,
    );

    fireEvent.click(screen.getByTestId('mail-toolbar-mailbox-switcher'));
    fireEvent.click(screen.getByTestId('mail-toolbar-menu-back-to-mail'));
    expect(onBackFromStorage).toHaveBeenCalledTimes(1);
  });
});
