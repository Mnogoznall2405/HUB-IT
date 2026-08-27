import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
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

export type MobileUpdateProgress = {
  phase: 'downloading' | 'verifying' | 'installing';
  progress: number;
};

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

function prepareUpdateDestination(feed: MobileUpdateFeed): File {
  const directory = new Directory(Paths.cache, 'hubit-updates');
  directory.create({ intermediates: true, idempotent: true });
  for (const entry of directory.list()) {
    if (entry instanceof File && entry.extension.toLowerCase() === '.apk') entry.delete();
  }
  return new File(directory, `HUB-IT-Mobile-${feed.version}.apk`);
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
  const destination = prepareUpdateDestination(feed);
  let file: File;
  try {
    file = await File.downloadFileAsync(feed.downloadUrl, destination, {
      idempotent: true,
      onProgress: ({ bytesWritten, totalBytes }) => {
        const denominator = totalBytes > 0 ? totalBytes : feed.sizeBytes;
        onProgress?.({
          phase: 'downloading',
          progress: Math.max(0, Math.min(1, bytesWritten / denominator)),
        });
      },
    });
  } catch (error) {
    if (destination.exists) destination.delete();
    throw error;
  }

  try {
    onProgress?.({ phase: 'verifying', progress: 1 });
    const digest = await hashUpdateFile(file);
    validateDownloadedUpdate(file.size, digest, feed);
    onProgress?.({ phase: 'installing', progress: 1 });
    await IntentLauncher.startActivityAsync(ANDROID_VIEW_ACTION, {
      data: file.contentUri,
      type: APK_MIME_TYPE,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
    });
  } catch (error) {
    if (error instanceof MobileUpdateError && file.exists) file.delete();
    throw error;
  }
}
