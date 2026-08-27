import * as Application from 'expo-application';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
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
  downloadAndInstallMobileUpdate,
  openUnknownSourcesSettings,
} from './mobileUpdateInstaller';

export type MobileUpdaterState = {
  status: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'verifying' | 'installing' | 'error';
  currentVersion: string;
  currentBuild: string;
  feed: MobileUpdateFeed | null;
  progress: number;
  message: string;
  canOpenInstallerSettings: boolean;
  required: boolean;
};

const installedVersion = String(Application.nativeApplicationVersion || '0.0.0').trim();
const installedBuild = String(Application.nativeBuildVersion || '').trim();

const INITIAL_STATE: MobileUpdaterState = {
  status: 'idle',
  currentVersion: installedVersion,
  currentBuild: installedBuild,
  feed: null,
  progress: 0,
  message: 'Проверяем актуальную версию приложения.',
  canOpenInstallerSettings: false,
  required: false,
};

export function useMobileUpdater() {
  const [state, setState] = useState<MobileUpdaterState>(INITIAL_STATE);
  const mountedRef = useRef(true);
  const installerStartedRef = useRef(false);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const updateState = useCallback((nextState: MobileUpdaterState) => {
    if (mountedRef.current) setState(nextState);
    return nextState;
  }, []);

  const checkForUpdate = useCallback(async () => {
    updateState({
      ...INITIAL_STATE,
      status: 'checking',
      message: 'Проверяем обновления…',
    });
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
      return updateState({
        ...INITIAL_STATE,
        status: available ? 'available' : 'current',
        feed,
        required,
        message: available
          ? required
            ? `Эта сборка больше не совместима с сервером. Установите HUB-IT ${feed.version}.`
            : `Доступна версия ${feed.version}. Можно скачать и установить её прямо здесь.`
          : 'Установлена актуальная версия HUB-IT.',
      });
    } catch (error) {
      return updateState({
        ...INITIAL_STATE,
        status: 'error',
        message: getMobileUpdateErrorMessage(error),
      });
    }
  }, [updateState]);

  const installUpdate = useCallback(async (feedOverride?: MobileUpdateFeed | null) => {
    const feed = feedOverride || state.feed;
    if (!feed) return state;
    installerStartedRef.current = false;
    try {
      await downloadAndInstallMobileUpdate(feed, ({ phase, progress }) => {
        installerStartedRef.current = phase === 'installing';
        updateState({
          ...state,
          status: phase,
          progress,
          message: phase === 'downloading'
            ? `Загружаем версию ${feed.version}…`
            : phase === 'verifying'
              ? 'Проверяем размер и SHA-256 APK…'
              : 'Открываем системный установщик Android…',
          canOpenInstallerSettings: false,
        });
      });
      void recordReleaseHealthMetric('update_installer_opened');
      return updateState({
        ...state,
        feed,
        status: 'installing',
        progress: 1,
        message: 'Подтвердите обновление в системном установщике Android.',
        canOpenInstallerSettings: false,
      });
    } catch (error) {
      void recordReleaseHealthMetric('update_flow_failed');
      return updateState({
        ...state,
        feed,
        status: 'error',
        progress: 0,
        message: getMobileUpdateErrorMessage(error),
        canOpenInstallerSettings: installerStartedRef.current,
      });
    }
  }, [state, updateState]);

  const openInstallerSettings = useCallback(async () => {
    try {
      await openUnknownSourcesSettings();
    } catch (error) {
      updateState({
        ...state,
        status: 'error',
        message: getMobileUpdateErrorMessage(error),
        canOpenInstallerSettings: false,
      });
    }
  }, [state, updateState]);

  return {
    state,
    checkForUpdate,
    installUpdate,
    openInstallerSettings,
  };
}
