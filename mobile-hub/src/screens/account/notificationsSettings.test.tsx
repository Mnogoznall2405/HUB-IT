import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import * as api from '../../api/notificationApi';
import { NativeNotificationsSettingsScreen } from './NativeNotificationsSettingsScreen';

let mockOffline = false;
const mockExecute = jest.fn(async () => ({ status: 'registered' }));
jest.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ offlineMode: mockOffline }) }));
jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'dark' } }),
}));
jest.mock('../../native/useNativeCommands', () => ({ useNativeCommands: () => ({ execute: mockExecute }) }));
jest.mock('../../api/notificationApi', () => ({
  getNotificationPreferences: jest.fn(),
  updateNotificationPreferences: jest.fn(),
}));

const enabledChannels = {
  mail: true,
  tasks: true,
  docflow: true,
  task_email: true,
  announcements: true,
  chat: true,
  chat_direct: true,
  chat_group: true,
  chat_task: true,
  chat_ai: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockOffline = false;
  (api.getNotificationPreferences as jest.Mock).mockResolvedValue({ channels: enabledChannels });
  (api.updateNotificationPreferences as jest.Mock).mockImplementation(async (patch: Record<string, boolean>) => ({
    channels: { ...enabledChannels, ...patch },
  }));
});

function channelSwitch(view: Awaited<ReturnType<typeof render>>, label: string) {
  // The same label may appear both as a channel toggle and as an Android
  // channel-settings button; pick the row that actually contains a switch.
  for (const text of view.getAllByText(label)) {
    const row = text.parent;
    const found = row ? within(row).queryByRole('switch') : null;
    if (found) return found;
  }
  throw new Error(`Switch row for "${label}" not found`);
}

describe('NativeNotificationsSettingsScreen', () => {
  it('shows the ИИ-агенты toggle and saves only chat_ai', async () => {
    const view = await render(<NativeNotificationsSettingsScreen />);

    const aiSwitch = await waitFor(() => channelSwitch(view, 'ИИ-агенты'));
    expect(aiSwitch.props.value).toBe(true);

    fireEvent(aiSwitch, 'valueChange', false);

    await waitFor(() => {
      expect(api.updateNotificationPreferences).toHaveBeenCalledWith({ chat_ai: false });
    });
    expect(aiSwitch.props.value).toBe(false);
    // Other chat categories stay enabled.
    expect(channelSwitch(view, 'Личные сообщения').props.value).toBe(true);
    await view.unmount();
  });

  it('master chat switch turns chat_ai off optimistically', async () => {
    (api.updateNotificationPreferences as jest.Mock).mockResolvedValue({
      channels: { ...enabledChannels, chat: false, chat_direct: false, chat_group: false, chat_task: false, chat_ai: false },
    });
    const view = await render(<NativeNotificationsSettingsScreen />);

    const master = await waitFor(() => channelSwitch(view, 'Получать уведомления о чатах'));
    fireEvent(master, 'valueChange', false);

    await waitFor(() => {
      expect(api.updateNotificationPreferences).toHaveBeenCalledWith({ chat: false });
    });
    expect(channelSwitch(view, 'ИИ-агенты').props.value).toBe(false);
    await view.unmount();
  });
});
