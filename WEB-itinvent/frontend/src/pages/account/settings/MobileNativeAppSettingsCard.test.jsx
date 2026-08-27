import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MobileNativeAppSettingsCard from './MobileNativeAppSettingsCard';

const requestMobileAppCommand = vi.hoisted(() => vi.fn());
const prepareMobileOfflineData = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/mobileAppBridge', () => ({ requestMobileAppCommand }));
vi.mock('../../../lib/mobileOfflinePrefetch', () => ({ prepareMobileOfflineData }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ hasPermission: (permission) => permission !== 'tasks.manage_all' }),
}));

const updateState = {
  status: 'current',
  currentVersion: '1.1.4',
  currentBuild: '6',
  progress: 0,
  message: 'Установлена актуальная версия HUB-IT.',
  canOpenInstallerSettings: false,
  required: false,
  feed: null,
};

describe('MobileNativeAppSettingsCard', () => {
  beforeEach(() => {
    requestMobileAppCommand.mockReset();
    prepareMobileOfflineData.mockReset();
    prepareMobileOfflineData.mockResolvedValue({
      preparedModules: [
        { module: 'dashboard', label: 'Главная' },
        { module: 'tasks', label: 'Задачи' },
        { module: 'mail', label: 'Почта' },
      ],
      failedModules: [],
    });
    requestMobileAppCommand.mockImplementation(async (command) => {
      if (command === 'update.getState' || command === 'update.check') return updateState;
      if (command === 'appLock.getState') return { enabled: true, timeoutSeconds: 60, biometricEnabled: true };
      if (command === 'diagnostics.getState') return {
        eventCount: 2,
        processHealth: {
          status: 'available',
          counts: { anr: 1, crash: 2, nativeCrash: 1, lowMemory: 3 },
        },
        releaseHealth: {
          crashFreeSessionPercent: 99.5,
          counters: {
            sessions_started: 12,
            push_received: 8,
            offline_recovered: 2,
            push_registration_succeeded: 4,
            push_registration_failed: 1,
            update_installer_opened: 1,
            update_completed: 1,
            update_flow_failed: 0,
          },
          queueDepth: { total: 3 },
        },
      };
      if (command === 'offline.getState') return { pendingReplies: 1, pendingCommands: 2, fileCacheBytes: 2048 };
      if (command === 'network.getState') {
        return {
          available: true,
          online: true,
          connected: true,
          transport: 'wifi',
          metered: false,
          changedAtMs: 1_787_500_000_000,
        };
      }
      return {};
    });
  });

  it('loads all native states and exposes the self-update check', async () => {
    render(<MobileNativeAppSettingsCard />);

    expect(await screen.findByText(/Установлена версия 1\.1\.4 \(6\)/)).toBeInTheDocument();
    expect(screen.getByText(/Ответов в очереди: 1 · команд: 2/)).toBeInTheDocument();
    expect(screen.getByText(/99,5% сессий без UI-сбоя/)).toBeInTheDocument();
    expect(screen.getByText(/История Android: ANR 1 · Java-сбоев 2 · native-сбоев 1 · нехватка памяти 3/)).toBeInTheDocument();
    expect(screen.getByText(/Push-регистрация: 4 успешно \/ 1 ошибок · очередь сейчас: 3/)).toBeInTheDocument();
    expect(screen.getByText('Интернет подтверждён')).toBeInTheDocument();
    expect(screen.getByText('Подключение: Wi-Fi · обычный трафик.')).toBeInTheDocument();
    expect(requestMobileAppCommand).toHaveBeenCalledWith('appLock.getState');

    fireEvent.click(screen.getByRole('button', { name: 'Подготовить автономный режим' }));
    expect(await screen.findByText('Для автономного просмотра подготовлены списки: Главная, Задачи, Почта.')).toBeInTheDocument();
    expect(prepareMobileOfflineData).toHaveBeenCalledWith({
      dashboard: true,
      tasks: true,
      mail: true,
      tasksManageAll: false,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Проверить сеть' }));
    await waitFor(() => {
      expect(requestMobileAppCommand).toHaveBeenCalledWith('network.getState', {}, { timeoutMs: undefined });
      expect(requestMobileAppCommand).toHaveBeenCalledWith('haptics.perform', { kind: 'selection' });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Настройки батареи и фона' }));
    await waitFor(() => {
      expect(requestMobileAppCommand).toHaveBeenCalledWith('system.openBackgroundSettings', {}, { timeoutMs: undefined });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Проверить обновление' }));
    await waitFor(() => {
      expect(requestMobileAppCommand).toHaveBeenCalledWith('update.check', {}, { timeoutMs: undefined });
      expect(requestMobileAppCommand).toHaveBeenCalledWith('haptics.perform', { kind: 'selection' });
    });
  });
});
