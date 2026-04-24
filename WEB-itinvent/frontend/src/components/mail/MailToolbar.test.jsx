import React from 'react';
import { render, screen } from '@testing-library/react';
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

describe('MailToolbar', () => {
  it('renders the mobile native toolbar with navigation, mailbox switcher, overflow and search', () => {
    renderWithTheme(
      <MailToolbar
        mobile
        search="report"
        activeMailbox={{
          id: 'mb-1',
          label: 'Support',
          mailbox_email: 'support@example.com',
          unread_count: 4,
          is_primary: true,
        }}
        mailboxes={[
          {
            id: 'mb-1',
            label: 'Support',
            mailbox_email: 'support@example.com',
            unread_count: 4,
            is_primary: true,
          },
        ]}
        onSearchChange={vi.fn()}
        onOpenToolsMenu={vi.fn()}
        onOpenNavigation={vi.fn()}
        onSelectMailbox={vi.fn()}
        onManageMailboxes={vi.fn()}
        currentFolderLabel="Входящие"
        hasActiveFilters
      />,
    );

    expect(screen.getByTestId('mail-toolbar-open-navigation')).toBeTruthy();
    expect(screen.getByTestId('mail-toolbar-mobile-mailbox-switcher')).toBeTruthy();
    expect(screen.getByTestId('mail-toolbar-open-tools')).toBeTruthy();
    expect(screen.getByTestId('mail-toolbar-mobile-search')).toBeTruthy();
    expect(screen.getByDisplayValue('report')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Написать письмо' })).toBeNull();
  });
});
