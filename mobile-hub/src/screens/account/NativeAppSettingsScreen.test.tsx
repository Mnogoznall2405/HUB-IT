import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NativeAppSettingsScreen } from './NativeAppSettingsScreen';

const mockExecute = jest.fn();

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'user' },
    offlineMode: false,
    hasPermission: () => true,
  }),
}));

jest.mock('../../native/useNativeCommands', () => ({
  useNativeCommands: () => ({ execute: mockExecute }),
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'system' } }),
}));

describe('NativeAppSettingsScreen', () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockExecute.mockImplementation(async (command: string) => {
      if (command === 'update.getState') return { currentVersion: '1.1.13', currentBuild: 113 };
      if (command === 'offline.getState') {
        return {
          pendingReplies: 0,
          pendingCommands: 0,
          fileCacheBytes: 0,
          snapshotReady: true,
          snapshotScopes: ['mail-inbox', 'mail-message-details', 'task-details'],
          snapshotLastSyncAt: Date.now(),
        };
      }
      if (command === 'diagnostics.getState') return { eventCount: 0 };
      if (command === 'network.getState') return { connected: true, online: true };
      if (command === 'offline.prepareNative') {
        return { preparedModules: ['Главная', 'Задачи', 'Почта'], failedModules: [] };
      }
      return {};
    });
  });

  it('shows the exact native sections available without a network', async () => {
    const view = await render(<NativeAppSettingsScreen />);

    await waitFor(() => {
      expect(view.getByTestId('native-offline-readiness')).toHaveTextContent(
        'Сохранено для офлайн-просмотра: список писем, письма, задачи.',
      );
    });
    expect(view.getByText(/Последняя синхронизация:/)).toBeTruthy();
    expect(view.getByText(/Кнопка сохраняет стандартные списки/)).toBeTruthy();
  });

  it('prepares native offline data from the settings screen', async () => {
    const view = await render(<NativeAppSettingsScreen />);

    await waitFor(() => expect(view.getByText('Подготовить автономный режим')).toBeTruthy());
    fireEvent.press(view.getByText('Подготовить автономный режим'));

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith('offline.prepareNative', expect.objectContaining({
        dashboard: true,
        tasks: true,
        mail: true,
      }));
    });
    expect(view.getByText('Автономные данные подготовлены: Главная, Задачи, Почта.')).toBeTruthy();
  });

  it('shows progress only on the command being executed', async () => {
    const view = await render(<NativeAppSettingsScreen />);
    await waitFor(() => expect(view.getByTestId('native-offline-readiness')).toBeTruthy());

    let resolveNetwork: ((value: { connected: boolean; online: boolean }) => void) | undefined;
    mockExecute.mockImplementation((command: string) => {
      if (command === 'network.getState') {
        return new Promise((resolve) => {
          resolveNetwork = resolve;
        });
      }
      return Promise.resolve({});
    });

    fireEvent.press(view.getByTestId('native-app-check-network'));

    await waitFor(() => {
      expect(view.getByTestId('native-app-check-network').props.accessibilityState).toEqual(
        expect.objectContaining({ busy: true, disabled: true }),
      );
    });
    expect(view.getByTestId('native-app-check-update').props.accessibilityState).toEqual(
      expect.objectContaining({ busy: false, disabled: false }),
    );

    await act(async () => {
      resolveNetwork?.({ connected: true, online: true });
    });
  });
});
