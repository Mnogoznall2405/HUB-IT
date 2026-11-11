import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationProvider } from '../../../../contexts/NotificationContext';
import { NotificationChannelsSettingsCard as Card } from './NotificationChannelsSettingsCard';

function NotificationChannelsSettingsCard(props) {
  return (
    <NotificationProvider>
      <Card {...props} />
    </NotificationProvider>
  );
}

const serverError = (detail) => Object.assign(new Error('Request failed with status code 500'), {
  response: { status: 500, data: { detail } },
});

const mocks = vi.hoisted(() => ({
  getPreferences: vi.fn(),
  updatePreferences: vi.fn(),
}));

vi.mock('../../../../api/client', () => ({
  settingsAPI: {
    getNotificationPreferences: mocks.getPreferences,
    updateNotificationPreferences: mocks.updatePreferences,
  },
}));

vi.mock('../../../../lib/chatNotifications', () => ({
  getChatNotificationState: () => ({
    permission: 'granted',
    pushSubscribed: true,
  }),
  subscribeChatNotificationState: () => () => {},
}));

const enabledChannels = {
  mail: true,
  tasks: true,
  task_email: true,
  announcements: true,
  chat: true,
  chat_direct: true,
  chat_group: true,
  chat_task: true,
  chat_ai: true,
};

describe('NotificationChannelsSettingsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPreferences.mockResolvedValue({ channels: enabledChannels });
    mocks.updatePreferences.mockImplementation(async (patch) => ({
      channels: { ...enabledChannels, ...patch },
    }));
  });

  it('shows separate chat switches shared by browser and HUB Desktop', async () => {
    render(<NotificationChannelsSettingsCard />);

    expect(await screen.findByRole('checkbox', { name: 'Получать уведомления о чатах' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Личные сообщения' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Групповые беседы' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Диалоги задач' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Уведомления ИИ-агентов' })).toBeChecked();
    expect(screen.getByText(/браузере и HUB Desktop/i)).toBeInTheDocument();
  });

  it('saves only the selected chat category', async () => {
    render(<NotificationChannelsSettingsCard />);

    const groupSwitch = await screen.findByRole('checkbox', { name: 'Групповые беседы' });
    fireEvent.click(groupSwitch);

    await waitFor(() => {
      expect(mocks.updatePreferences).toHaveBeenCalledWith({ chat_group: false });
    });
    expect(groupSwitch).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Личные сообщения' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Диалоги задач' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Уведомления ИИ-агентов' })).toBeChecked();
  });

  it('saves the AI-agents chat category separately', async () => {
    render(<NotificationChannelsSettingsCard />);

    const aiSwitch = await screen.findByRole('checkbox', { name: 'Уведомления ИИ-агентов' });
    fireEvent.click(aiSwitch);

    await waitFor(() => {
      expect(mocks.updatePreferences).toHaveBeenCalledWith({ chat_ai: false });
    });
    expect(aiSwitch).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Личные сообщения' })).toBeChecked();
  });

  it('turns all chat categories off from the single master switch', async () => {
    mocks.updatePreferences.mockResolvedValue({
      channels: {
        ...enabledChannels,
        chat: false,
        chat_direct: false,
        chat_group: false,
        chat_task: false,
        chat_ai: false,
      },
    });
    render(<NotificationChannelsSettingsCard />);

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Получать уведомления о чатах' }));

    await waitFor(() => {
      expect(mocks.updatePreferences).toHaveBeenCalledWith({ chat: false });
    });
    expect(screen.getByRole('checkbox', { name: 'Личные сообщения' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Групповые беседы' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Диалоги задач' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Уведомления ИИ-агентов' })).not.toBeChecked();
  });

  it('rolls the switch back and shows an error toast when saving fails', async () => {
    mocks.updatePreferences.mockRejectedValueOnce(serverError('Сервис настроек недоступен'));
    render(<NotificationChannelsSettingsCard />);

    const mailSwitch = await screen.findByRole('checkbox', { name: 'Почта' });
    expect(mailSwitch).toBeChecked();
    fireEvent.click(mailSwitch);
    expect(mailSwitch).not.toBeChecked(); // optimistic

    expect(await screen.findByText('Сервис настроек недоступен')).toBeInTheDocument();
    await waitFor(() => expect(mailSwitch).toBeChecked());
    expect(mailSwitch).not.toBeDisabled();
  });

  it('rolls back every chat category when the master switch fails', async () => {
    mocks.updatePreferences.mockRejectedValueOnce(serverError('boom'));
    render(<NotificationChannelsSettingsCard />);

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Получать уведомления о чатах' }));

    expect(await screen.findByText('boom')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'Получать уведомления о чатах' })).toBeChecked();
    });
    expect(screen.getByRole('checkbox', { name: 'Личные сообщения' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Уведомления ИИ-агентов' })).toBeChecked();
  });

  it('shows a load error with retry instead of default switches', async () => {
    mocks.getPreferences.mockRejectedValueOnce(serverError('db down'));
    render(<NotificationChannelsSettingsCard />);

    expect(await screen.findByText('Не удалось загрузить настройки уведомлений.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Почта' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));

    await waitFor(() => {
      expect(screen.queryByText('Не удалось загрузить настройки уведомлений.')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('checkbox', { name: 'Почта' })).not.toBeDisabled();
    expect(mocks.getPreferences).toHaveBeenCalledTimes(2);
  });
});
