import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listMailboxes: vi.fn(),
  refreshSession: vi.fn(),
  notifyApiError: vi.fn(),
  notifySuccess: vi.fn(),
}));

vi.mock('../api/client', () => ({
  authAPI: {
    uploadAvatar: vi.fn(),
    deleteAvatar: vi.fn(),
  },
  mailAPI: {
    listMailboxes: (...args) => mocks.listMailboxes(...args),
    createMailbox: vi.fn(),
    updateMailbox: vi.fn(),
    deleteMailbox: vi.fn(),
  },
  settingsAPI: {},
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    refreshSession: mocks.refreshSession,
  }),
}));

vi.mock('../contexts/NotificationContext', () => ({
  useNotification: () => ({
    notifyApiError: mocks.notifyApiError,
    notifySuccess: mocks.notifySuccess,
  }),
}));

vi.mock('../components/chat/ChatCommon', () => ({
  PresenceAvatar: ({ item }) => <div aria-label={`Аватар ${item?.full_name || item?.username}`} />,
}));

import { ProfileTab } from './AccountWorkspace';

const user = {
  id: 1,
  username: 'ivanov',
  full_name: 'Иван Иванов',
  job_title: 'Инженер',
  department: 'ИТ',
  email: 'ivanov@example.com',
  avatar_url: '/avatar.jpg',
  role: 'operator',
  auth_source: 'ldap',
  assigned_database: 'ITINVENT',
};

function renderProfile(canAccessMail) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <ProfileTab
        user={user}
        dbOptions={[{ id: 'ITINVENT', name: 'Основная БД' }]}
        canAccessMail={canAccessMail}
      />
    </ThemeProvider>,
  );
}

describe('ProfileTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listMailboxes.mockResolvedValue({ items: [] });
  });

  it('shows the human identity in the hero without loading mailboxes when mail is unavailable', async () => {
    renderProfile(false);

    expect(screen.getByText('Иван Иванов')).toBeInTheDocument();
    expect(screen.getByText('Инженер · ИТ')).toBeInTheDocument();
    expect(screen.getByText('ivanov@example.com')).toBeInTheDocument();
    expect(screen.queryByText('Подключённые ящики')).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.listMailboxes).not.toHaveBeenCalled());
  });

  it('loads and shows mailbox management only with mail access', async () => {
    renderProfile(true);

    expect(await screen.findByText('Подключённые ящики')).toBeInTheDocument();
    await waitFor(() => expect(mocks.listMailboxes).toHaveBeenCalledWith({ includeUnread: true }));
    expect(screen.getByText('Дополнительные ящики пока не подключены.')).toBeInTheDocument();
  });

  it('keeps the mobile profile and mailbox controls compact', async () => {
    mocks.listMailboxes.mockResolvedValue({
      items: [{
        id: 'mailbox-1',
        label: 'Рабочая почта',
        mailbox_email: 'ivanov@example.com',
        mailbox_login: 'ivanov@corp.local',
        auth_mode: 'stored_credentials',
        is_primary: true,
        is_active: true,
        unread_count: 0,
      }],
    });

    renderProfile(true);

    expect(screen.getByTestId('profile-hero')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Изменить фото профиля' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Удалить фото профиля' })).toBeInTheDocument();

    const mailboxMenu = await screen.findByRole('button', { name: 'Действия для ящика Рабочая почта' });
    expect(screen.queryByRole('button', { name: 'Редактировать' })).toBeNull();
    expect(screen.queryByText(/Unread:/)).toBeNull();

    fireEvent.click(mailboxMenu);
    expect(screen.getByRole('menuitem', { name: 'Редактировать' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Отключить' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Удалить' })).toBeInTheDocument();
  });
});
