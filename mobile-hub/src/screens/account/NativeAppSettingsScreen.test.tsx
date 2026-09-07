import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NativeAppSettingsScreen } from './NativeAppSettingsScreen';

const mockExecute = jest.fn();
const mockNativeUpdaterState = {
  status: 'current',
  currentVersion: '1.1.20',
  currentBuild: '22',
  feed: null as null | { version: string; versionCode: number; sizeBytes: number },
  progress: 0,
  bytesWritten: 0,
  totalBytes: 0,
  message: 'Установлена актуальная версия HUB-IT.',
  canOpenInstallerSettings: false,
};

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'user' },
    offlineMode: false,
    hasPermission: () => true,
  }),
}));

jest.mock('../../native/useNativeCommands', () => ({
  useNativeCommands: () => ({ execute: mockExecute, updater: { state: mockNativeUpdaterState } }),
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'system' } }),
}));

describe('NativeAppSettingsScreen', () => {
  beforeEach(() => {
    mockExecute.mockReset();
    Object.assign(mockNativeUpdaterState, {
      status: 'current',
      currentVersion: '1.1.20',
      currentBuild: '22',
      feed: null,
      progress: 0,
      bytesWritten: 0,
      totalBytes: 0,
      message: 'Установлена актуальная версия HUB-IT.',
      canOpenInstallerSettings: false,
    });
    mockExecute.mockImplementation(async (command: string) => {
      if (command === 'update.getState') return { ...mockNativeUpdaterState };
      if (command === 'offline.getState') {
        return {
          pendingReplies: 0,
          pendingCommands: 0,
          fileCacheBytes: 0,
          snapshotReady: true,
          snapshotScopes: ['mail-inbox', 'mail-message-details', 'task-details'],
          snapshotLastSyncAt: Date.now(),
          offlineCoverage: [
            {
              moduleId: 'addressBook',
              status: 'complete',
              availableStatus: 'complete',
              loaded: 2692,
              total: 2692,
              unit: 'сотрудников',
              revision: 1,
              savedAt: '2026-09-04T06:00:00.000Z',
              lastAttemptAt: '2026-09-04T06:00:00.000Z',
              errorCode: null,
              errorMessage: null,
            },
          ],
        };
      }
      if (command === 'diagnostics.getState') return { eventCount: 0 };
      if (command === 'network.getState') return { connected: true, online: true };
      if (command === 'offline.prepareNative') {
        return { preparedModules: ['Главная', 'Лента', 'Задачи', 'Почта'], failedModules: [] };
      }
      return {};
    });
  });

  it('shows the exact native sections available without a network', async () => {
    const view = await render(<NativeAppSettingsScreen />);
    await fireEvent.press(view.getByRole('button', { name: 'Офлайн-данные' }));

    await waitFor(() => {
      expect(view.getByTestId('native-offline-readiness')).toHaveTextContent(
        'Сохранено для офлайн-просмотра: список писем, письма, задачи.',
      );
    });
    expect(view.getByText(/Последняя синхронизация:/)).toBeTruthy();
    expect(view.getByText(/Кнопка сохраняет стандартные списки/)).toBeTruthy();
    expect(view.getByText(/2692 из 2692 сотрудников/)).toBeTruthy();
  });

  it('shows partial offline readiness and the exact missing sections', async () => {
    mockExecute.mockImplementation(async (command: string) => {
      if (command === 'update.getState') return { ...mockNativeUpdaterState };
      if (command === 'offline.getState') {
        return {
          pendingReplies: 0,
          pendingCommands: 0,
          fileCacheBytes: 0,
          snapshotReady: false,
          snapshotScopes: ['mail-inbox'],
          snapshotMissingScopes: ['tasks-inbox', 'address-book'],
          snapshotLastSyncAt: Date.now(),
        };
      }
      if (command === 'diagnostics.getState') return { eventCount: 0 };
      if (command === 'network.getState') return { connected: true, online: true };
      return {};
    });

    const view = await render(<NativeAppSettingsScreen />);
    await fireEvent.press(view.getByRole('button', { name: 'Офлайн-данные' }));

    await waitFor(() => {
      expect(view.getByTestId('native-offline-readiness')).toHaveTextContent(
        'Сохранено частично: список писем. Не хватает: список задач, адресная книга.',
      );
    });
  });

  it('prepares native offline data from the settings screen', async () => {
    const view = await render(<NativeAppSettingsScreen />);
    await fireEvent.press(view.getByRole('button', { name: 'Офлайн-данные' }));

    await waitFor(() => expect(view.getByText('Подготовить автономный режим')).toBeTruthy());
    await fireEvent.press(view.getByText('Подготовить автономный режим'));

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith('offline.prepareNative', expect.objectContaining({
        dashboard: true,
        feed: true,
        tasks: true,
        mail: true,
        docflow: true,
        addressBook: true,
        database: true,
        myFiles: true,
        companyStructure: true,
      }), expect.objectContaining({
        onOfflinePreparationProgress: expect.any(Function),
      }));
    });
    expect(view.getByText('Автономные данные подготовлены: Главная, Лента, Задачи, Почта.')).toBeTruthy();
  });

  it('shows progress only on the command being executed', async () => {
    const view = await render(<NativeAppSettingsScreen />);
    await fireEvent.press(view.getByRole('button', { name: 'Офлайн-данные' }));
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

    await fireEvent.press(view.getByTestId('native-app-check-network'));

    await waitFor(() => {
      expect(view.getByTestId('native-app-check-network').props.accessibilityState).toEqual(
        expect.objectContaining({ busy: true, disabled: true }),
      );
    });
    await fireEvent.press(view.getByTestId('account-subpage-back'));
    await fireEvent.press(view.getByRole('button', { name: 'Обновления APK' }));
    expect(view.getByTestId('native-app-check-update').props.accessibilityState).toEqual(
      expect.objectContaining({ busy: false, disabled: false }),
    );

    await act(async () => {
      resolveNetwork?.({ connected: true, online: true });
    });
  });

  it('shows live offline preparation progress and loaded item counts', async () => {
    const view = await render(<NativeAppSettingsScreen />);
    await fireEvent.press(view.getByRole('button', { name: 'Офлайн-данные' }));
    await waitFor(() => expect(view.getByTestId('native-offline-readiness')).toBeTruthy());

    let reportProgress: ((event: Record<string, unknown>) => void) | undefined;
    let resolvePreparation: ((value: Record<string, unknown>) => void) | undefined;
    mockExecute.mockImplementation((command: string, _payload: unknown, executionOptions?: Record<string, unknown>) => {
      if (command !== 'offline.prepareNative') return Promise.resolve({});
      reportProgress = executionOptions?.onOfflinePreparationProgress as typeof reportProgress;
      reportProgress?.({ key: 'dashboard', label: 'Главная', status: 'loading', completedModules: 0, totalModules: 2 });
      reportProgress?.({ key: 'dashboard', label: 'Главная', status: 'completed', loaded: 1, total: 1, unit: 'экран', completedModules: 1, totalModules: 2 });
      reportProgress?.({ key: 'addressBook', label: 'Адресная книга', status: 'loading', completedModules: 1, totalModules: 2 });
      return new Promise((resolve) => { resolvePreparation = resolve; });
    });

    await act(async () => {
      fireEvent.press(view.getByText('Подготовить автономный режим'));
    });

    await waitFor(() => {
      expect(view.getByTestId('native-offline-preparation-progress').props.accessibilityValue).toEqual({ min: 0, max: 100, now: 50 });
    });
    expect(view.getByText('Проверено 1 из 2 разделов · Готово 1 из 2')).toBeTruthy();
    expect(view.getAllByText('Адресная книга').length).toBeGreaterThan(0);
    expect(view.getByText('Загружается…')).toBeTruthy();

    await act(async () => {
      reportProgress?.({ key: 'addressBook', label: 'Адресная книга', status: 'completed', loaded: 2_700, total: 2_700, unit: 'сотрудников', completedModules: 2, totalModules: 2 });
      resolvePreparation?.({
        preparedModules: ['Главная', 'Адресная книга'],
        failedModules: [],
        snapshotReady: true,
        snapshotMissingScopes: [],
      });
    });

    await waitFor(() => expect(view.getByText('Проверено 2 из 2 разделов · Готово 2 из 2')).toBeTruthy());
    expect(view.getByText('2700 из 2700 сотрудников')).toBeTruthy();
  });

  it('shows the concrete safe stage when address-book preparation fails', async () => {
    const view = await render(<NativeAppSettingsScreen />);
    await fireEvent.press(view.getByRole('button', { name: 'Офлайн-данные' }));
    await waitFor(() => expect(view.getByTestId('native-offline-readiness')).toBeTruthy());

    mockExecute.mockImplementation((command: string, _payload: unknown, executionOptions?: Record<string, unknown>) => {
      if (command !== 'offline.prepareNative') return Promise.resolve({});
      const reportProgress = executionOptions?.onOfflinePreparationProgress as ((event: Record<string, unknown>) => void) | undefined;
      reportProgress?.({
        key: 'addressBook',
        label: 'Адресная книга',
        status: 'failed',
        completedModules: 1,
        totalModules: 1,
        errorCode: 'address-book-storage',
        errorMessage: 'Не удалось записать защищённый кэш',
      });
      return Promise.resolve({
        preparedModules: [],
        failedModules: ['Адресная книга'],
        snapshotReady: false,
        snapshotMissingScopes: ['address-book'],
      });
    });

    await act(async () => {
      fireEvent.press(view.getByText('Подготовить автономный режим'));
    });

    await waitFor(() => expect(view.getByText('Не удалось записать защищённый кэш')).toBeTruthy());
  });

  it('reflects the shared APK download progress from the menu updater', async () => {
    Object.assign(mockNativeUpdaterState, {
      status: 'downloading',
      feed: { version: '1.1.21', versionCode: 23, sizeBytes: 64 * 1024 * 1024 },
      progress: 0.5,
      bytesWritten: 32 * 1024 * 1024,
      totalBytes: 64 * 1024 * 1024,
      message: 'Скачиваем версию 1.1.21…',
    });
    const view = await render(<NativeAppSettingsScreen />);
    await fireEvent.press(view.getByRole('button', { name: 'Обновления APK' }));

    expect(view.getByTestId('native-app-update-progress')).toBeTruthy();
    expect(view.getByText('50% · 32.0 МБ из 64.0 МБ')).toBeTruthy();
  });
});

it('distinguishes attempted, partial and ready modules and retries only incomplete modules', async () => {
  const view = await render(<NativeAppSettingsScreen />);
  await fireEvent.press(view.getByRole('button', { name: 'Офлайн-данные' }));
  await waitFor(() => expect(view.getByTestId('native-offline-readiness')).toBeTruthy());
  mockExecute.mockImplementation((command: string, payload: Record<string, unknown>, options?: Record<string, unknown>) => {
    if (command !== 'offline.prepareNative') return Promise.resolve({});
    const report = options?.onOfflinePreparationProgress as (event: Record<string, unknown>) => void;
    if (payload.dashboard) {
      report({ key: 'dashboard', label: 'Главная', status: 'completed', complete: true, loaded: 1, total: 1, completedModules: 1, totalModules: 3 });
      report({ key: 'mail', label: 'Почта', status: 'completed', complete: false, loaded: 20, total: 100, completedModules: 2, totalModules: 3 });
      report({ key: 'addressBook', label: 'Адресная книга', status: 'failed', completedModules: 3, totalModules: 3 });
      return Promise.resolve({ preparedModules: ['Главная'], failedModules: ['Адресная книга'], snapshotReady: false });
    }
    report({ key: 'mail', label: 'Почта', status: 'completed', complete: true, loaded: 100, total: 100, completedModules: 1, totalModules: 2 });
    report({ key: 'addressBook', label: 'Адресная книга', status: 'completed', complete: true, loaded: 100, total: 100, completedModules: 2, totalModules: 2 });
    return Promise.resolve({ preparedModules: ['Почта', 'Адресная книга'], failedModules: [], snapshotReady: true });
  });
  await fireEvent.press(view.getByText('Подготовить автономный режим'));
  await waitFor(() => expect(view.getByText('Проверено 3 из 3 разделов · Готово 1 из 3')).toBeTruthy());
  expect(view.getByText('Частично: 20 из 100')).toBeTruthy();
  expect(view.getByTestId('native-offline-preparation-progress').props.accessibilityValue.now).toBe(33);
  await fireEvent.press(view.getByTestId('native-offline-retry-incomplete'));
  await waitFor(() => expect(view.getByText('Проверено 3 из 3 разделов · Готово 3 из 3')).toBeTruthy());
  const calls = mockExecute.mock.calls.filter(([command]) => command === 'offline.prepareNative');
  expect(calls[1][1]).toEqual(expect.objectContaining({ dashboard: false, mail: true, addressBook: true, tasks: false, feed: false }));
  expect(view.queryByTestId('native-offline-retry-incomplete')).toBeNull();
});

it('marks a written copy as failed when final inventory cannot read its scope', async () => {
  const view = await render(<NativeAppSettingsScreen />);
  await fireEvent.press(view.getByRole('button', { name: 'Офлайн-данные' }));
  await waitFor(() => expect(view.getByTestId('native-offline-readiness')).toBeTruthy());
  mockExecute.mockImplementation((command: string, _payload: unknown, options?: Record<string, unknown>) => {
    if (command !== 'offline.prepareNative') return Promise.resolve({});
    const report = options?.onOfflinePreparationProgress as (event: Record<string, unknown>) => void;
    report({ key: 'addressBook', label: 'Адресная книга', status: 'completed', complete: true, loaded: 100, total: 100, completedModules: 1, totalModules: 1 });
    return Promise.resolve({ preparedModules: ['Адресная книга'], failedModules: [], snapshotReady: false, snapshotMissingScopes: ['address-book'] });
  });
  await fireEvent.press(view.getByText('Подготовить автономный режим'));
  await waitFor(() => expect(view.getByText('Проверено 1 из 1 разделов · Готово 0 из 1')).toBeTruthy());
  expect(view.getByText('Копия не прошла итоговую проверку. Повторите подготовку.')).toBeTruthy();
  expect(view.getByTestId('native-offline-retry-incomplete')).toBeTruthy();
});
