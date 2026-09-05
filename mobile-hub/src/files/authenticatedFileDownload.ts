import { File } from 'expo-file-system';
import { getAuthenticatedRequestHeaders } from './authenticatedRequestHeaders';

type DownloadProgress = {
  bytesWritten: number;
  totalBytes: number;
};

export type AuthenticatedFileDownloadOptions = {
  headers?: Record<string, string>;
  idempotent?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
  preserveSessionOnAuthFailure?: boolean;
};

function isUnauthorizedDownloadError(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message || error || '').toLowerCase();
  return /(?:status(?: code)?|http|response)[^\d]{0,12}401\b/.test(message)
    || message.includes('401 unauthorized')
    || message.includes('unauthorized (401)');
}

function deletePartialFile(destination: File): void {
  if (destination.exists) destination.delete();
}

export async function downloadAuthenticatedFile(
  sourceUrl: string,
  destination: File,
  options: AuthenticatedFileDownloadOptions = {},
): Promise<File> {
  const pending = new File(`${destination.uri}.part`);
  if (pending.exists) pending.delete();
  const attempt = async (forceRefresh: boolean): Promise<File> => {
    const authHeaders = await getAuthenticatedRequestHeaders(options.preserveSessionOnAuthFailure
      ? { forceRefresh, preserveSessionOnRefreshFailure: true }
      : { forceRefresh });
    return File.downloadFileAsync(sourceUrl, pending, {
      idempotent: true,
      signal: options.signal,
      onProgress: options.onProgress,
      headers: {
        ...(options.headers || {}),
        ...authHeaders,
      },
    });
  };

  try {
    let downloaded: File;
    try {
      downloaded = await attempt(false);
    } catch (error) {
      if (options.signal?.aborted || !isUnauthorizedDownloadError(error)) throw error;
      deletePartialFile(pending);
      downloaded = await attempt(true);
    }
    if (!downloaded.exists || Number(downloaded.size || 0) <= 0) {
      throw new Error('Downloaded file is empty');
    }
    await downloaded.move(destination, { overwrite: true });
    return destination;
  } catch (error) {
    deletePartialFile(pending);
    throw error;
  }
}
