import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  Directory,
  DownloadTask,
  File,
  FileMode,
  Paths,
  type DownloadPauseState,
} from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  MOBILE_UPDATE_PACKAGE_NAME,
  MobileUpdateError,
  type MobileUpdateFeed,
} from './mobileUpdate';

const APK_MIME_TYPE = 'application/vnd.android.package-archive';
const ANDROID_VIEW_ACTION = 'android.intent.action.VIEW';
const FLAG_GRANT_READ_URI_PERMISSION = 0x00000001;
const HASH_CHUNK_BYTES = 512 * 1024;
const DOWNLOAD_STATE_KEY = 'hubit_mobile_update_download_v1';

export type MobileUpdateProgress = {
  phase: 'downloading' | 'verifying' | 'installing';
  progress: number;
  bytesWritten: number;
  totalBytes: number;
};

export type MobileUpdateDownloadSnapshot = {
  kind: 'empty' | 'paused' | 'ready';
  bytesWritten: number;
  totalBytes: number;
};

type StoredDownloadState = {
  schemaVersion: 1;
  status: 'paused' | 'ready';
  version: string;
  versionCode: number | null;
  sizeBytes: number;
  sha256: string;
  fileUri: string;
  resumeData?: string;
};

type ActiveDownload = {
  feed: MobileUpdateFeed;
  file: File;
  task: DownloadTask;
};

let activeDownload: ActiveDownload | null = null;

export function sha256HexFromChunks(chunks: Iterable<Uint8Array>): string {
  const hash = sha256.create();
  for (const chunk of chunks) hash.update(chunk);
  return bytesToHex(hash.digest());
}

async function hashUpdateFile(file: File): Promise<string> {
  const hash = sha256.create();
  const handle = file.open(FileMode.ReadOnly);
  try {
    let chunkCount = 0;
    while (handle.offset !== null && handle.size !== null && handle.offset < handle.size) {
      const remaining = handle.size - handle.offset;
      hash.update(handle.readBytes(Math.min(HASH_CHUNK_BYTES, remaining)));
      chunkCount += 1;
      if (chunkCount % 8 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    return bytesToHex(hash.digest());
  } finally {
    handle.close();
  }
}

export function validateDownloadedUpdate(
  actualSize: number,
  actualSha256: string,
  feed: MobileUpdateFeed,
): void {
  if (actualSize !== feed.sizeBytes) throw new MobileUpdateError('download_size');
  if (actualSha256.toLowerCase() !== feed.sha256) throw new MobileUpdateError('download_hash');
}

function updateDirectory(): Directory {
  const directory = new Directory(Paths.cache, 'hubit-updates');
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

function updateDestination(feed: MobileUpdateFeed): File {
  return new File(updateDirectory(), `HUB-IT-Mobile-${feed.version}.apk`);
}

function removeOtherUpdateFiles(feed: MobileUpdateFeed): File {
  const directory = updateDirectory();
  const destination = new File(directory, `HUB-IT-Mobile-${feed.version}.apk`);
  for (const entry of directory.list()) {
    if (
      entry instanceof File
      && entry.extension.toLowerCase() === '.apk'
      && entry.uri !== destination.uri
    ) {
      entry.delete();
    }
  }
  return destination;
}

async function deleteStoredState(): Promise<void> {
  await SecureStore.deleteItemAsync(DOWNLOAD_STATE_KEY).catch(() => undefined);
}

async function writeStoredState(value: StoredDownloadState): Promise<void> {
  await SecureStore.setItemAsync(DOWNLOAD_STATE_KEY, JSON.stringify(value)).catch(() => undefined);
}

async function readStoredState(feed: MobileUpdateFeed, file: File): Promise<StoredDownloadState | null> {
  try {
    const raw = await SecureStore.getItemAsync(DOWNLOAD_STATE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredDownloadState>;
    if (
      value.schemaVersion !== 1
      || (value.status !== 'paused' && value.status !== 'ready')
      || value.version !== feed.version
      || Number(value.versionCode || 0) !== Number(feed.versionCode || 0)
      || value.sizeBytes !== feed.sizeBytes
      || value.sha256 !== feed.sha256
      || value.fileUri !== file.uri
      || (value.status === 'paused' && !/^\d+$/.test(String(value.resumeData || '')))
    ) {
      await deleteStoredState();
      return null;
    }
    return value as StoredDownloadState;
  } catch {
    await deleteStoredState();
    return null;
  }
}

function storedState(
  status: StoredDownloadState['status'],
  feed: MobileUpdateFeed,
  file: File,
  resumeData?: string,
): StoredDownloadState {
  return {
    schemaVersion: 1,
    status,
    version: feed.version,
    versionCode: feed.versionCode,
    sizeBytes: feed.sizeBytes,
    sha256: feed.sha256,
    fileUri: file.uri,
    ...(resumeData ? { resumeData } : {}),
  };
}

function pauseState(feed: MobileUpdateFeed, file: File, resumeData: string): DownloadPauseState {
  return {
    url: feed.downloadUrl,
    fileUri: file.uri,
    isDirectory: false,
    resumeData,
  };
}

function progressSnapshot(feed: MobileUpdateFeed, bytesWritten: number, totalBytes: number) {
  const safeWritten = Math.max(0, Math.min(feed.sizeBytes, Number(bytesWritten || 0)));
  const safeTotal = Number(totalBytes) > 0 ? Number(totalBytes) : feed.sizeBytes;
  return {
    bytesWritten: safeWritten,
    totalBytes: feed.sizeBytes,
    progress: Math.max(0, Math.min(1, safeWritten / Math.max(1, safeTotal))),
  };
}

async function persistPartialDownload(feed: MobileUpdateFeed, file: File): Promise<MobileUpdateDownloadSnapshot> {
  const bytesWritten = file.exists ? Math.max(0, Number(file.size || 0)) : 0;
  if (bytesWritten <= 0 || bytesWritten >= feed.sizeBytes) {
    return { kind: 'empty', bytesWritten: 0, totalBytes: feed.sizeBytes };
  }
  await writeStoredState(storedState('paused', feed, file, String(bytesWritten)));
  return { kind: 'paused', bytesWritten, totalBytes: feed.sizeBytes };
}

export async function inspectMobileUpdateDownload(
  feed: MobileUpdateFeed,
): Promise<MobileUpdateDownloadSnapshot> {
  const file = removeOtherUpdateFiles(feed);
  const saved = await readStoredState(feed, file);
  if (!file.exists) {
    if (saved) await deleteStoredState();
    return { kind: 'empty', bytesWritten: 0, totalBytes: feed.sizeBytes };
  }

  const size = Math.max(0, Number(file.size || 0));
  if (size === feed.sizeBytes) {
    try {
      validateDownloadedUpdate(size, await hashUpdateFile(file), feed);
      await writeStoredState(storedState('ready', feed, file));
      return { kind: 'ready', bytesWritten: size, totalBytes: feed.sizeBytes };
    } catch {
      file.delete();
      await deleteStoredState();
      return { kind: 'empty', bytesWritten: 0, totalBytes: feed.sizeBytes };
    }
  }

  if (size > 0 && size < feed.sizeBytes) return persistPartialDownload(feed, file);
  file.delete();
  await deleteStoredState();
  return { kind: 'empty', bytesWritten: 0, totalBytes: feed.sizeBytes };
}

async function openInstaller(file: File): Promise<void> {
  await IntentLauncher.startActivityAsync(ANDROID_VIEW_ACTION, {
    data: file.contentUri,
    type: APK_MIME_TYPE,
    flags: FLAG_GRANT_READ_URI_PERMISSION,
  });
}

async function downloadMobileUpdate(
  feed: MobileUpdateFeed,
  onProgress?: (progress: MobileUpdateProgress) => void,
): Promise<File> {
  const cached = await inspectMobileUpdateDownload(feed);
  const destination = updateDestination(feed);
  if (cached.kind === 'ready') return destination;

  const saved = await readStoredState(feed, destination);
  const reportProgress = ({ bytesWritten, totalBytes }: { bytesWritten: number; totalBytes: number }) => {
    const snapshot = progressSnapshot(feed, bytesWritten, totalBytes);
    onProgress?.({ phase: 'downloading', ...snapshot });
  };
  const task = saved?.status === 'paused' && saved.resumeData
    ? DownloadTask.fromSavable(pauseState(feed, destination, saved.resumeData), { onProgress: reportProgress })
    : new DownloadTask(feed.downloadUrl, destination, { onProgress: reportProgress });
  activeDownload = { feed, file: destination, task };

  try {
    const initialBytes = saved?.status === 'paused' ? Number(saved.resumeData || 0) : 0;
    reportProgress({ bytesWritten: initialBytes, totalBytes: feed.sizeBytes });
    const file = saved?.status === 'paused'
      ? await task.resumeAsync()
      : await task.downloadAsync();
    if (!file) throw new MobileUpdateError('download_paused');

    onProgress?.({
      phase: 'verifying',
      progress: 1,
      bytesWritten: feed.sizeBytes,
      totalBytes: feed.sizeBytes,
    });
    validateDownloadedUpdate(file.size, await hashUpdateFile(file), feed);
    await writeStoredState(storedState('ready', feed, file));
    return file;
  } catch (error) {
    if (error instanceof MobileUpdateError && (error.code === 'download_size' || error.code === 'download_hash')) {
      if (destination.exists) destination.delete();
      await deleteStoredState();
      throw error;
    }
    const partial = await persistPartialDownload(feed, destination);
    if (partial.kind === 'paused') throw new MobileUpdateError('download_paused');
    throw error;
  } finally {
    task.release();
    if (activeDownload?.task === task) activeDownload = null;
  }
}

export async function pauseMobileUpdateDownload(): Promise<MobileUpdateDownloadSnapshot | null> {
  const active = activeDownload;
  if (!active || active.task.state !== 'active') return null;
  await active.task.pauseAsync();
  const saved = active.task.savable();
  const bytesWritten = Math.max(0, Number(active.file.size || 0));
  if (saved.resumeData && bytesWritten > 0) {
    await writeStoredState(storedState('paused', active.feed, active.file, saved.resumeData));
  }
  return {
    kind: bytesWritten > 0 ? 'paused' : 'empty',
    bytesWritten,
    totalBytes: active.feed.sizeBytes,
  };
}

export async function installPreparedMobileUpdate(
  feed: MobileUpdateFeed,
  onProgress?: (progress: MobileUpdateProgress) => void,
): Promise<void> {
  if (Platform.OS !== 'android') throw new MobileUpdateError('android_only');
  const destination = updateDestination(feed);
  if (!destination.exists) throw new MobileUpdateError('download_missing');
  onProgress?.({
    phase: 'verifying',
    progress: 1,
    bytesWritten: feed.sizeBytes,
    totalBytes: feed.sizeBytes,
  });
  validateDownloadedUpdate(destination.size, await hashUpdateFile(destination), feed);
  await writeStoredState(storedState('ready', feed, destination));
  onProgress?.({
    phase: 'installing',
    progress: 1,
    bytesWritten: feed.sizeBytes,
    totalBytes: feed.sizeBytes,
  });
  await openInstaller(destination);
}

export async function clearMobileUpdateDownload(feed?: MobileUpdateFeed | null): Promise<void> {
  if (activeDownload?.task.state === 'active') return;
  await deleteStoredState();
  const directory = updateDirectory();
  const preservedUri = feed ? updateDestination(feed).uri : '';
  for (const entry of directory.list()) {
    if (
      entry instanceof File
      && entry.extension.toLowerCase() === '.apk'
      && entry.uri !== preservedUri
    ) {
      entry.delete();
    }
  }
}

export async function openUnknownSourcesSettings(): Promise<void> {
  if (Platform.OS !== 'android') throw new MobileUpdateError('android_only');
  await IntentLauncher.startActivityAsync(
    IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES,
    { data: `package:${MOBILE_UPDATE_PACKAGE_NAME}` },
  );
}

export async function downloadAndInstallMobileUpdate(
  feed: MobileUpdateFeed,
  onProgress?: (progress: MobileUpdateProgress) => void,
): Promise<void> {
  if (Platform.OS !== 'android') throw new MobileUpdateError('android_only');
  const file = await downloadMobileUpdate(feed, onProgress);
  onProgress?.({
    phase: 'installing',
    progress: 1,
    bytesWritten: feed.sizeBytes,
    totalBytes: feed.sizeBytes,
  });
  await openInstaller(file);
}
