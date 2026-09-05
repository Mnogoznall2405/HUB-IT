import * as Application from 'expo-application';
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { recordReleaseHealthMetric } from '../diagnostics/diagnostics';
import {
  fetchMobileUpdateFeed,
  getMobileUpdateErrorMessage,
  isMobileUpdateAvailable,
  isMobileUpdateRequired,
  MOBILE_UPDATE_PACKAGE_NAME,
  MobileUpdateError,
  type MobileUpdateFeed,
} from './mobileUpdate';
import {
  clearMobileUpdateDownload,
  downloadAndInstallMobileUpdate,
  inspectMobileUpdateDownload,
  installPreparedMobileUpdate,
  openUnknownSourcesSettings,
  pauseMobileUpdateDownload,
  type MobileUpdateProgress,
} from './mobileUpdateInstaller';

export const MOBILE_UPDATE_AUTO_CHECK_INTERVAL_MS = 30 * 60 * 1000;

export type MobileUpdaterState = {
  status: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'paused' | 'verifying' | 'ready' | 'installing' | 'error';
  currentVersion: string;
  currentBuild: string;
  feed: MobileUpdateFeed | null;
  progress: number;
  bytesWritten: number;
  totalBytes: number;
  message: string;
  canOpenInstallerSettings: boolean;
  required: boolean;
  lastCheckedAt: number | null;
};

const installedVersion = String(Application.nativeApplicationVersion || '0.0.0').trim();
const installedBuild = String(Application.nativeBuildVersion || '').trim();

function initialState(): MobileUpdaterState {
  return {
    status: 'idle',
    currentVersion: installedVersion,
    currentBuild: installedBuild,
    feed: null,
    progress: 0,
    bytesWritten: 0,
    totalBytes: 0,
    message: 'Проверяем актуальную версию приложения.',
    canOpenInstallerSettings: false,
    required: false,
    lastCheckedAt: null,
  };
}

function isBusy(status: MobileUpdaterState['status']): boolean {
  return status === 'downloading' || status === 'verifying' || status === 'installing';
}

export function hasPendingMobileUpdate(state: MobileUpdaterState): boolean {
  if (!state.feed) return false;
  try {
    return isMobileUpdateAvailable(state.currentVersion, state.feed, state.currentBuild);
  } catch {
    return false;
  }
}

export function shouldAutoCheckMobileUpdate(input: {
  now: number;
  lastCheckedAt: number;
  hasUser: boolean;
  offline: boolean;
  status: MobileUpdaterState['status'];
}): boolean {
  return input.hasUser
    && !input.offline
    && !isBusy(input.status)
    && input.now - input.lastCheckedAt >= MOBILE_UPDATE_AUTO_CHECK_INTERVAL_MS;
}

function progressMessage(feed: MobileUpdateFeed, phase: MobileUpdateProgress['phase']): string {
  if (phase === 'downloading') return `Скачиваем версию ${feed.version}…`;
  if (phase === 'verifying') return 'Проверяем размер и SHA-256 APK…';
  return 'Открываем системный установщик Android…';
}

function cachedDownloadMessage(kind: 'empty' | 'paused' | 'ready', version: string): string {
  if (kind === 'paused') return 'Загрузка приостановлена. Нажмите «Продолжить».';
  if (kind === 'ready') return `Версия ${version} уже скачана и проверена. Нажмите «Установить».`;
  return `Доступна версия ${version}.`;
}

export type MobileUpdaterController = ReturnType<typeof useMobileUpdaterController>;

export function useMobileUpdaterController() {
  const [state, setState] = useState<MobileUpdaterState>(initialState);
  const stateRef = useRef(state);
  const mountedRef = useRef(true);
  const checkInFlightRef = useRef<Promise<MobileUpdaterState> | null>(null);
  const installerStartedRef = useRef(false);
  const reopenAfterSettingsRef = useRef(false);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const updateState = useCallback((
    next: MobileUpdaterState | ((current: MobileUpdaterState) => MobileUpdaterState),
  ) => {
    const resolved = typeof next === 'function' ? next(stateRef.current) : next;
    stateRef.current = resolved;
    if (mountedRef.current) setState(resolved);
    return resolved;
  }, []);

  const checkForUpdate = useCallback(async () => {
    if (checkInFlightRef.current) return checkInFlightRef.current;
    if (isBusy(stateRef.current.status)) return stateRef.current;

    const operation = (async () => {
      const checkedAt = Date.now();
      updateState((current) => ({
        ...current,
        status: 'checking',
        message: 'Проверяем обновления…',
        canOpenInstallerSettings: false,
      }));
      try {
        if (Platform.OS !== 'android' || Application.applicationId !== MOBILE_UPDATE_PACKAGE_NAME) {
          throw new MobileUpdateError('android_only');
        }
        const feed = await fetchMobileUpdateFeed();
        const sdkVersion = Number(Platform.Version);
        if (Number.isFinite(sdkVersion) && sdkVersion < feed.minSdk) {
          throw new MobileUpdateError('android_version');
        }
        const available = isMobileUpdateAvailable(installedVersion, feed, installedBuild);
        const required = isMobileUpdateRequired(installedBuild, feed);
        if (!available) {
          await clearMobileUpdateDownload();
          return updateState({
            ...initialState(),
            status: 'current',
            feed,
            lastCheckedAt: checkedAt,
            message: 'Установлена актуальная версия HUB-IT.',
          });
        }

        const cached = await inspectMobileUpdateDownload(feed);
        const status = cached.kind === 'paused'
          ? 'paused'
          : cached.kind === 'ready' ? 'ready' : 'available';
        return updateState({
          ...initialState(),
          status,
          feed,
          required,
          progress: cached.totalBytes > 0 ? cached.bytesWritten / cached.totalBytes : 0,
          bytesWritten: cached.bytesWritten,
          totalBytes: cached.totalBytes,
          lastCheckedAt: checkedAt,
          message: required
            ? `Эта сборка больше не совместима с сервером. Установите HUB-IT ${feed.version}.`
            : cachedDownloadMessage(cached.kind, feed.version),
        });
      } catch (error) {
        return updateState((current) => ({
          ...current,
          status: current.feed && ['available', 'paused', 'ready'].includes(current.status)
            ? current.status
            : 'error',
          lastCheckedAt: checkedAt,
          message: current.feed
            ? current.message
            : getMobileUpdateErrorMessage(error),
        }));
      }
    })();
    checkInFlightRef.current = operation;
    try {
      return await operation;
    } finally {
      checkInFlightRef.current = null;
    }
  }, [updateState]);

  const applyProgress = useCallback((feed: MobileUpdateFeed, progress: MobileUpdateProgress) => {
    installerStartedRef.current = progress.phase === 'installing';
    updateState((current) => ({
      ...current,
      feed,
      status: progress.phase,
      progress: progress.progress,
      bytesWritten: progress.bytesWritten,
      totalBytes: progress.totalBytes,
      message: progressMessage(feed, progress.phase),
      canOpenInstallerSettings: false,
    }));
  }, [updateState]);

  const installUpdate = useCallback(async (feedOverride?: MobileUpdateFeed | null) => {
    const current = stateRef.current;
    const feed = feedOverride || current.feed;
    if (!feed || isBusy(current.status)) return current;
    installerStartedRef.current = false;
    try {
      if (current.status === 'ready') {
        await installPreparedMobileUpdate(feed, (progress) => applyProgress(feed, progress));
      } else {
        await downloadAndInstallMobileUpdate(feed, (progress) => applyProgress(feed, progress));
      }
      void recordReleaseHealthMetric('update_installer_opened');
      return updateState((latest) => ({
        ...latest,
        feed,
        status: 'installing',
        progress: 1,
        bytesWritten: feed.sizeBytes,
        totalBytes: feed.sizeBytes,
        message: 'Подтвердите обновление в системном установщике Android.',
        canOpenInstallerSettings: false,
      }));
    } catch (error) {
      if (error instanceof MobileUpdateError && error.code === 'download_paused') {
        const cached = await inspectMobileUpdateDownload(feed);
        return updateState((latest) => ({
          ...latest,
          feed,
          status: 'paused',
          progress: cached.totalBytes > 0 ? cached.bytesWritten / cached.totalBytes : latest.progress,
          bytesWritten: cached.bytesWritten,
          totalBytes: cached.totalBytes,
          message: 'Загрузка приостановлена. Нажмите «Продолжить».',
          canOpenInstallerSettings: false,
        }));
      }
      void recordReleaseHealthMetric('update_flow_failed');
      return updateState((latest) => ({
        ...latest,
        feed,
        status: 'error',
        message: getMobileUpdateErrorMessage(error),
        canOpenInstallerSettings: installerStartedRef.current,
      }));
    }
  }, [applyProgress, updateState]);

  const pauseUpdate = useCallback(async () => {
    if (stateRef.current.status !== 'downloading') return stateRef.current;
    try {
      const paused = await pauseMobileUpdateDownload();
      if (!paused) return stateRef.current;
      return updateState((current) => ({
        ...current,
        status: 'paused',
        progress: paused.totalBytes > 0 ? paused.bytesWritten / paused.totalBytes : current.progress,
        bytesWritten: paused.bytesWritten,
        totalBytes: paused.totalBytes,
        message: 'Загрузка приостановлена. Нажмите «Продолжить».',
      }));
    } catch (error) {
      return updateState((current) => ({
        ...current,
        status: 'error',
        message: getMobileUpdateErrorMessage(error),
      }));
    }
  }, [updateState]);

  const openInstallerSettings = useCallback(async () => {
    try {
      reopenAfterSettingsRef.current = true;
      await openUnknownSourcesSettings();
    } catch (error) {
      reopenAfterSettingsRef.current = false;
      updateState((current) => ({
        ...current,
        status: 'error',
        message: getMobileUpdateErrorMessage(error),
        canOpenInstallerSettings: false,
      }));
    }
  }, [updateState]);

  const handleAppBecameActive = useCallback(async () => {
    const current = stateRef.current;
    if (reopenAfterSettingsRef.current && current.feed) {
      reopenAfterSettingsRef.current = false;
      try {
        await installPreparedMobileUpdate(current.feed, (progress) => applyProgress(current.feed!, progress));
        return updateState((latest) => ({
          ...latest,
          status: 'installing',
          message: 'Подтвердите обновление в системном установщике Android.',
          canOpenInstallerSettings: false,
        }));
      } catch (error) {
        return updateState((latest) => ({
          ...latest,
          status: 'error',
          message: getMobileUpdateErrorMessage(error),
          canOpenInstallerSettings: true,
        }));
      }
    }
    if (current.status === 'installing' && current.feed) {
      return updateState({
        ...current,
        status: 'ready',
        message: 'Установка не завершена. Нажмите «Установить», чтобы открыть установщик снова.',
      });
    }
    return current;
  }, [applyProgress, updateState]);

  return useMemo(() => ({
    state,
    checkForUpdate,
    installUpdate,
    pauseUpdate,
    openInstallerSettings,
    handleAppBecameActive,
  }), [checkForUpdate, handleAppBecameActive, installUpdate, openInstallerSettings, pauseUpdate, state]);
}

const MobileUpdaterContext = createContext<MobileUpdaterController | null>(null);

export function MobileUpdateProvider({ children }: { children: ReactNode }) {
  const updater = useMobileUpdaterController();
  const { user, offlineMode } = useAuth();
  const {
    state: updaterState,
    checkForUpdate,
    pauseUpdate,
    handleAppBecameActive,
  } = updater;
  const lastAutoCheckAtRef = useRef(0);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const autoCheck = useCallback(() => {
    const now = Date.now();
    const lastCheckedAt = Math.max(lastAutoCheckAtRef.current, updaterState.lastCheckedAt || 0);
    if (!shouldAutoCheckMobileUpdate({
      now,
      lastCheckedAt,
      hasUser: Boolean(user),
      offline: offlineMode,
      status: updaterState.status,
    })) return;
    lastAutoCheckAtRef.current = now;
    void checkForUpdate();
  }, [checkForUpdate, offlineMode, updaterState.status, user]);

  useEffect(() => {
    autoCheck();
  }, [autoCheck, user?.id]);

  useEffect(() => {
    if (offlineMode) void pauseUpdate();
  }, [offlineMode, pauseUpdate]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const becameActive = appStateRef.current !== 'active' && nextState === 'active';
      appStateRef.current = nextState;
      if (!becameActive) return;
      void handleAppBecameActive().finally(autoCheck);
    });
    return () => subscription.remove();
  }, [autoCheck, handleAppBecameActive]);

  return createElement(MobileUpdaterContext.Provider, { value: updater }, children);
}

export function useMobileUpdater(): MobileUpdaterController {
  const updater = useContext(MobileUpdaterContext);
  if (!updater) throw new Error('useMobileUpdater must be used inside MobileUpdateProvider');
  return updater;
}
