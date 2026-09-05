import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import { NativeMenuScreen } from './NativeMenuScreen';
import { openPortalPath } from '../../navigation/moduleRegistry';
import { hasPendingMobileUpdate } from '../../updates/useMobileUpdater';

const mockInstallUpdate = jest.fn(async () => undefined);
const mockOpenInstallerSettings = jest.fn(async () => undefined);
const mockUpdaterState = {
  status: 'current',
  currentVersion: '1.1.20',
  currentBuild: '22',
  feed: null as null | { version: string; versionCode: number; sizeBytes: number },
  progress: 0,
  bytesWritten: 0,
  totalBytes: 0,
  message: '',
  canOpenInstallerSettings: false,
};

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 7, username: 'kozlovskii_me', full_name: 'Максим Козловский', role: 'admin' },
    hasPermission: () => true,
    logout: jest.fn(async () => undefined),
  }),
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'dark' } }),
}));

jest.mock('../../navigation/useNativeBottomNavInset', () => ({
  useNativeBottomNavInset: () => 72,
}));

jest.mock('../../navigation/moduleRegistry', () => ({
  openPortalPath: jest.fn(),
}));

jest.mock('../../updates/useMobileUpdater', () => ({
  ...jest.requireActual('../../updates/useMobileUpdater'),
  useMobileUpdater: () => ({
    state: mockUpdaterState,
    installUpdate: mockInstallUpdate,
    openInstallerSettings: mockOpenInstallerSettings,
  }),
}));

describe('NativeMenuScreen', () => {
  beforeEach(() => {
    Object.assign(mockUpdaterState, {
      status: 'current',
      feed: null,
      progress: 0,
      bytesWritten: 0,
      totalBytes: 0,
      message: '',
      canOpenInstallerSettings: false,
    });
  });

  it('uses profile-first grouped rows instead of the old app grid', async () => {
    const view = await render(<NativeMenuScreen />);

    expect(view.getByText('Максим Козловский')).toBeTruthy();
    expect(view.getByText('Аккаунт')).toBeTruthy();
    expect(view.getByText('Работа')).toBeTruthy();
    expect(view.getByText('Инструменты')).toBeTruthy();
    expect(view.getByText('Система')).toBeTruthy();
    expect(view.queryByTestId('mobile-menu-app-grid')).toBeNull();
  });

  it('keeps native account and module navigation available', async () => {
    const view = await render(<NativeMenuScreen />);

    await fireEvent.press(view.getByLabelText('Открыть настройки'));
    expect(router.push).toHaveBeenCalledWith('/(shell)/menu/settings');

    await fireEvent.press(view.getByLabelText('Открыть Задачи'));
    expect(openPortalPath).toHaveBeenCalledWith('/tasks');
  });

  it('shows the compact update action only when a newer APK is available', async () => {
    Object.assign(mockUpdaterState, {
      status: 'available',
      feed: { version: '1.1.21', versionCode: 23, sizeBytes: 64 * 1024 * 1024 },
      totalBytes: 64 * 1024 * 1024,
    });
    expect(hasPendingMobileUpdate(mockUpdaterState as never)).toBe(true);
    const view = await render(<NativeMenuScreen />);

    expect(view.getByTestId('mobile-menu-update')).toBeTruthy();
    expect(view.getByText('Версия 1.1.21 · 64 МБ')).toBeTruthy();
    await fireEvent.press(view.getByTestId('mobile-menu-update'));
    expect(mockInstallUpdate).toHaveBeenCalled();
  });

  it('shows resumable download progress without losing the partial APK', async () => {
    Object.assign(mockUpdaterState, {
      status: 'paused',
      feed: { version: '1.1.21', versionCode: 23, sizeBytes: 64 * 1024 * 1024 },
      progress: 0.25,
      bytesWritten: 16 * 1024 * 1024,
      totalBytes: 64 * 1024 * 1024,
    });
    const view = await render(<NativeMenuScreen />);

    expect(view.getByTestId('mobile-menu-update-progress')).toBeTruthy();
    expect(view.getByText('25% · 16 МБ из 64 МБ')).toBeTruthy();
    expect(view.getByText('Продолжить')).toBeTruthy();

    await fireEvent.press(view.getByTestId('mobile-menu-update'));
    expect(mockInstallUpdate).toHaveBeenCalled();
  });
});
