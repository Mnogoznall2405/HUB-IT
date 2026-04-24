import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import MailFolderRail from './MailFolderRail';

function renderWithTheme(node) {
  return render(
    <ThemeProvider theme={createTheme()}>
      {node}
    </ThemeProvider>,
  );
}

describe('MailFolderRail', () => {
  it('renders unread badges only when they are positive and shows the flat utility section', () => {
    const onItRequest = vi.fn();
    const onTemplates = vi.fn();

    renderWithTheme(
      <MailFolderRail
        folder="inbox"
        folderTreeItems={[
          { id: 'inbox', label: 'Входящие', well_known_key: 'inbox', icon_key: 'inbox', unread: 4 },
          { id: 'sent', label: 'Отправленные', well_known_key: 'sent', icon_key: 'sent', unread: 0 },
        ]}
        onFolderChange={vi.fn()}
        viewMode="messages"
        onViewModeChange={vi.fn()}
        unreadOnly={false}
        onUnreadToggle={vi.fn()}
        hasAttachmentsOnly={false}
        onToggleHasAttachmentsOnly={vi.fn()}
        filterDateFrom=""
        filterDateTo=""
        onToggleToday={vi.fn()}
        onToggleLast7Days={vi.fn()}
        onCreateFolderRequest={vi.fn()}
        onRenameFolderRequest={vi.fn()}
        onDeleteFolderRequest={vi.fn()}
        onToggleFavorite={vi.fn()}
        onDropMessagesToFolder={vi.fn()}
        utilityItems={[
          { id: 'it-request', label: 'IT-заявка', onClick: onItRequest },
          { id: 'templates', label: 'Шаблоны', onClick: onTemplates },
        ]}
      />,
    );

    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.queryByText(/^0$/)).toBeNull();
    expect(screen.getByTestId('mail-rail-utility-it-request')).toBeTruthy();
    expect(screen.getByTestId('mail-rail-utility-templates')).toBeTruthy();

    fireEvent.click(screen.getByTestId('mail-rail-utility-it-request'));
    fireEvent.click(screen.getByTestId('mail-rail-utility-templates'));

    expect(onItRequest).toHaveBeenCalledTimes(1);
    expect(onTemplates).toHaveBeenCalledTimes(1);
  });

  it('shows nested custom folders under their parent and lets the user collapse the branch', () => {
    renderWithTheme(
      <MailFolderRail
        folder="inbox"
        folderTreeItems={[
          { id: 'inbox', label: 'Inbox', well_known_key: 'inbox', icon_key: 'inbox', unread: 1 },
          { id: 'mailbox:projects', label: 'Projects', icon_key: 'folder', scope: 'mailbox', parent_id: 'inbox' },
        ]}
        onFolderChange={vi.fn()}
        viewMode="messages"
        onViewModeChange={vi.fn()}
        unreadOnly={false}
        onUnreadToggle={vi.fn()}
        hasAttachmentsOnly={false}
        onToggleHasAttachmentsOnly={vi.fn()}
        filterDateFrom=""
        filterDateTo=""
        onToggleToday={vi.fn()}
        onToggleLast7Days={vi.fn()}
        onCreateFolderRequest={vi.fn()}
        onRenameFolderRequest={vi.fn()}
        onDeleteFolderRequest={vi.fn()}
        onToggleFavorite={vi.fn()}
        onDropMessagesToFolder={vi.fn()}
      />,
    );

    expect(screen.getByText('Projects')).toBeTruthy();

    fireEvent.click(screen.getByTestId('mail-folder-toggle-inbox'));
    expect(screen.queryByText('Projects')).toBeNull();

    fireEvent.click(screen.getByTestId('mail-folder-toggle-inbox'));
    expect(screen.getByText('Projects')).toBeTruthy();
  });

  it('allows creating a nested folder under a standard folder like inbox', () => {
    const onCreateFolderRequest = vi.fn();

    renderWithTheme(
      <MailFolderRail
        folder="inbox"
        folderTreeItems={[
          { id: 'inbox', label: 'Inbox', well_known_key: 'inbox', icon_key: 'inbox', unread: 1 },
        ]}
        onFolderChange={vi.fn()}
        viewMode="messages"
        onViewModeChange={vi.fn()}
        unreadOnly={false}
        onUnreadToggle={vi.fn()}
        hasAttachmentsOnly={false}
        onToggleHasAttachmentsOnly={vi.fn()}
        filterDateFrom=""
        filterDateTo=""
        onToggleToday={vi.fn()}
        onToggleLast7Days={vi.fn()}
        onCreateFolderRequest={onCreateFolderRequest}
        onRenameFolderRequest={vi.fn()}
        onDeleteFolderRequest={vi.fn()}
        onToggleFavorite={vi.fn()}
        onDropMessagesToFolder={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('mail-folder-menu-inbox'));
    fireEvent.click(screen.getByTestId('mail-folder-menu-create-child'));

    expect(onCreateFolderRequest).toHaveBeenCalledWith('inbox');
  });
});
