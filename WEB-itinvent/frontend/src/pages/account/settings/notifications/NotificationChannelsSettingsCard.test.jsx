import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationChannelsSettingsCard } from './NotificationChannelsSettingsCard';

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
  });

  it('turns all chat categories off from the single master switch', async () => {
    mocks.updatePreferences.mockResolvedValue({
      channels: {
        ...enabledChannels,
        chat: false,
        chat_direct: false,
        chat_group: false,
        chat_task: false,
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
  });
});
