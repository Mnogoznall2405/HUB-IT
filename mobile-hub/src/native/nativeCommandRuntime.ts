import { Linking } from 'react-native';
import {
  APP_LOCK_TIMEOUT_OPTIONS,
  getAppLockSettings,
  setAppLockSettings,
} from '../auth/biometricAuth';
import type { HubUser } from '../api/types';
import { getNativeSnapshotInventory } from '../cache/nativeSnapshotCache';
import {
  clearDiagnosticEvents,
  getDiagnosticEventCount,
  getReleaseHealthSnapshot,
  shareDiagnosticReport,
} from '../diagnostics/diagnostics';
import { getAndroidProcessHealthSnapshot } from '../diagnostics/androidProcessHealth';
import {
  clearAttachmentCache,
  getAttachmentCacheSize,
} from '../files/nativeAttachmentDownloads';
import { syncPendingNotificationReplies } from '../lifecycle/mobileBackgroundSync';
import { clearNativeMailCache, getNativeMailCacheSize } from '../mail/nativeMailFiles';
import {
  openAndroidNotificationChannelSettings,
  syncNativePushToken,
} from '../notifications/nativePush';
import { getPendingChatReplyCount } from '../notifications/pendingNotificationReplies';
import { performPortalHaptic } from '../native/haptics';
import { getNativeConnectivitySnapshot } from '../network/nativeConnectivity';
import { drainOfflineCommandQueue, getOfflineCommandCount } from '../offline/offlineCommandQueue';
import { prepareNativeOfflineData } from '../offline/nativeOfflinePreparation';
import {
  clearNativeMyFilesCache,
  getNativeMyFilesCacheSize,
} from '../myFiles/nativeMyFilesTransfers';
import {
  clearNativeDocflowCache,
  getNativeDocflowCacheSize,
} from '../docflow/nativeDocflowFiles';
import { shareNativeText } from '../share/nativeOutgoingShare';
import { openAndroidBackgroundSettings } from '../system/androidBackgroundSettings';
import { clearNativeTaskFileCache, getNativeTaskFileCacheSize } from '../tasks/nativeTaskFiles';
import type { MobileUpdateFeed } from '../updates/mobileUpdate';
import type { MobileUpdaterState } from '../updates/useMobileUpdater';
import type { NativeCommandName } from './nativeCommandContract';

export type NativeCommandUpdater = {
  state: MobileUpdaterState;
  checkForUpdate: () => Promise<MobileUpdaterState>;
  installUpdate: (feed?: MobileUpdateFeed | null) => Promise<MobileUpdaterState>;
  openInstallerSettings: () => Promise<void>;
};

export type NativeCommandDeps = {
  user: HubUser | null;
  biometricEnabled: boolean;
  enableBiometrics: () => Promise<void>;
  skipBiometrics: () => Promise<void>;
  updater: NativeCommandUpdater;
};

export function updaterSnapshot(state: MobileUpdaterState) {
  return {
    status: state.status,
    currentVersion: state.currentVersion,
    currentBuild: state.currentBuild,
    progress: state.progress,
    message: state.message,
    canOpenInstallerSettings: state.canOpenInstallerSettings,
    required: state.required,
    feed: state.feed ? {
      version: state.feed.version,
      versionCode: state.feed.versionCode,
      sizeBytes: state.feed.sizeBytes,
      changelog: state.feed.changelog,
    } : null,
  };
}

export function assertAppLockPayload(payload: Record<string, unknown>) {
  if (typeof payload.enabled !== 'boolean') throw new Error('Invalid app lock state');
  const timeoutSeconds = Number(payload.timeoutSeconds);
  if (!APP_LOCK_TIMEOUT_OPTIONS.includes(timeoutSeconds as (typeof APP_LOCK_TIMEOUT_OPTIONS)[number])) {
    throw new Error('Invalid app lock timeout');
  }
  return { enabled: payload.enabled, timeoutSeconds };
}

async function getOfflineState(user: HubUser | null) {
  if (!user) throw new Error('Authenticated user is required');
  const [pendingReplies, pendingCommands, snapshots] = await Promise.all([
    getPendingChatReplyCount(user.id),
    getOfflineCommandCount(user.id),
    getNativeSnapshotInventory(user.id),
  ]);
  return {
    pendingReplies,
    pendingCommands,
    fileCacheBytes: getAttachmentCacheSize()
      + getNativeMailCacheSize()
      + getNativeTaskFileCacheSize()
      + getNativeMyFilesCacheSize()
      + getNativeDocflowCacheSize(),
    snapshotReady: snapshots.ready,
    snapshotScopes: snapshots.scopes,
    snapshotLastSyncAt: snapshots.lastSyncAt,
  };
}

async function getDiagnosticsState(user: HubUser | null) {
  const [eventCount, releaseHealth, processHealth, offline] = await Promise.all([
    getDiagnosticEventCount(),
    getReleaseHealthSnapshot(),
    getAndroidProcessHealthSnapshot(),
    getOfflineState(user),
  ]);
  const pendingReplies = Number(offline.pendingReplies || 0);
  const pendingCommands = Number(offline.pendingCommands || 0);
  return {
    eventCount,
    processHealth,
    releaseHealth: {
      ...releaseHealth,
      queueDepth: {
        pendingReplies,
        pendingCommands,
        total: pendingReplies + pendingCommands,
      },
    },
  };
}

export async function executeNativeCommand(
  command: NativeCommandName,
  payload: Record<string, unknown>,
  deps: NativeCommandDeps,
): Promise<unknown> {
  const { user, biometricEnabled, enableBiometrics, skipBiometrics, updater } = deps;
  switch (command) {
    case 'notifications.getState':
      return syncNativePushToken({ requestPermission: false });
    case 'notifications.requestPermission':
      return syncNativePushToken({ requestPermission: true });
    case 'notifications.openSettings':
      await Linking.openSettings();
      return { opened: true };
    case 'notifications.openChannelSettings':
      await openAndroidNotificationChannelSettings(String(payload.channelId || ''));
      return { opened: true };
    case 'update.getState':
      return updaterSnapshot(updater.state);
    case 'update.check':
      return updaterSnapshot(await updater.checkForUpdate());
    case 'update.install': {
      let nextState = updater.state;
      if (!nextState.feed) nextState = await updater.checkForUpdate();
      if (!nextState.feed || nextState.status !== 'available') return updaterSnapshot(nextState);
      return updaterSnapshot(await updater.installUpdate(nextState.feed));
    }
    case 'update.openInstallerSettings':
      await updater.openInstallerSettings();
      return { opened: true };
    case 'appLock.getState':
      return { ...(await getAppLockSettings()), biometricEnabled };
    case 'appLock.update':
      return { ...(await setAppLockSettings(assertAppLockPayload(payload))), biometricEnabled };
    case 'biometrics.enable':
      await enableBiometrics();
      return { ...(await getAppLockSettings()), biometricEnabled: true };
    case 'biometrics.disable':
      await skipBiometrics();
      return { enabled: false, timeoutSeconds: 60, biometricEnabled: false };
    case 'diagnostics.getState':
      return getDiagnosticsState(user);
    case 'diagnostics.share':
      await shareDiagnosticReport();
      return { ...(await getDiagnosticsState(user)), shared: true };
    case 'diagnostics.clear':
      await clearDiagnosticEvents();
      return getDiagnosticsState(user);
    case 'offline.getState':
      return getOfflineState(user);
    case 'offline.prepareNative': {
      if (!user) throw new Error('Authenticated user is required');
      const preparation = await prepareNativeOfflineData({
        userId: user.id,
        isAdmin: String(user.role || '').trim().toLowerCase() === 'admin' || payload.tasksManageAll === true,
        dashboard: payload.dashboard === true,
        tasks: payload.tasks === true,
        mail: payload.mail === true,
      });
      return { ...(await getOfflineState(user)), ...preparation };
    }
    case 'offline.retryQueues':
      if (!user) throw new Error('Authenticated user is required');
      await Promise.all([
        syncPendingNotificationReplies(user.id),
        drainOfflineCommandQueue(user.id),
      ]);
      return getOfflineState(user);
    case 'offline.clearFileCache':
      clearAttachmentCache();
      clearNativeMailCache();
      clearNativeTaskFileCache();
      clearNativeMyFilesCache();
      clearNativeDocflowCache();
      return getOfflineState(user);
    case 'network.getState':
      if (Object.keys(payload).length > 0) throw new Error('Invalid network state payload');
      return getNativeConnectivitySnapshot();
    case 'system.openBackgroundSettings':
      if (Object.keys(payload).length > 0) throw new Error('Invalid background settings payload');
      return openAndroidBackgroundSettings();
    case 'haptics.perform':
      return performPortalHaptic(payload);
    case 'share.text':
      return shareNativeText(payload);
    default: {
      const unreachable: never = command;
      throw new Error(`Unsupported native command: ${unreachable}`);
    }
  }
}
