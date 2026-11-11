import { Platform } from 'react-native';
import HubitShareIntentModule, {
  type HubitNativeSharePayload,
} from '../../modules/hubit-share-intent';
import { sanitizeNativeFileName, validateUploadFile } from '../files/filePolicy';
import type { NativePickedFile } from '../files/nativeFilePicker';

export type IncomingShareFileInfo = { name: string; mimeType: string; size: number };

/** Text and/or files received from another app through the Android share sheet. */
export type IncomingShare = HubitNativeSharePayload & {
  files?: IncomingShareFileInfo[];
};
/** @deprecated legacy name from the text-only share. */
export type IncomingTextShare = IncomingShare & {
  target?: IncomingShareTarget;
};

export type IncomingShareTarget = 'mail' | 'task' | 'chat';

/** What a destination screen receives: the share, its files already copied into the cache. */
export type QueuedIncomingShare = IncomingTextShare & {
  copiedFiles?: NativePickedFile[];
  conversationId?: string;
};

export const INCOMING_SHARE_MAX_FILES = 10;

let queuedNativeShare: QueuedIncomingShare | null = null;

function normalizeShareFiles(value: unknown): IncomingShareFileInfo[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, INCOMING_SHARE_MAX_FILES).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Partial<IncomingShareFileInfo>;
    const size = Number(item.size);
    return [{
      name: sanitizeNativeFileName(String(item.name || '')),
      mimeType: String(item.mimeType || 'application/octet-stream').trim().toLowerCase().slice(0, 100),
      size: Number.isFinite(size) && size > 0 ? Math.trunc(size) : 0,
    }];
  });
}

export function normalizeIncomingTextShare(value: unknown): IncomingShare | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Partial<IncomingShare>;
  const id = String(item.id || '').trim().slice(0, 100);
  const text = String(item.text || '').slice(0, 20_000);
  const subject = String(item.subject || '').trim().slice(0, 500);
  const mimeType = String(item.mimeType || 'text/plain').trim().slice(0, 100);
  const receivedAt = Number(item.receivedAt || 0);
  const files = normalizeShareFiles(item.files);
  if (!id || !receivedAt) return null;
  if (files.length) {
    // A file share may carry any MIME type; its text (if any) is the caption.
    return { id, text, subject, mimeType, receivedAt, files };
  }
  if (!text.trim() || !['text/plain', 'text/*'].includes(mimeType.toLowerCase())) return null;
  return { id, text, subject, mimeType, receivedAt };
}

export async function getPendingIncomingTextShare(): Promise<IncomingShare | null> {
  if (Platform.OS !== 'android' || !HubitShareIntentModule) return null;
  return normalizeIncomingTextShare(await HubitShareIntentModule.getPendingShareAsync());
}

export function subscribeIncomingTextShare(listener: () => void): () => void {
  if (Platform.OS !== 'android' || !HubitShareIntentModule) return () => undefined;
  const subscription = HubitShareIntentModule.addListener('onShareIntent', (event) => {
    if (event?.available) listener();
  });
  return () => subscription.remove();
}

/** Copies the shared files into the app cache (done once a destination is chosen) and
 * applies the same upload policy as the pickers: blocked types and empty files are dropped. */
export async function copyIncomingShareFiles(share: IncomingShare): Promise<NativePickedFile[]> {
  if (!share.files?.length || Platform.OS !== 'android' || !HubitShareIntentModule) return [];
  const copied = await HubitShareIntentModule.copySharedFilesAsync(share.id);
  const accepted: NativePickedFile[] = [];
  for (const file of copied || []) {
    if (!String(file?.uri || '').startsWith('file://')) continue;
    try {
      const policy = validateUploadFile({ name: file.name, mimeType: file.mimeType, size: file.size });
      accepted.push({
        uri: file.uri,
        name: policy.name,
        mimeType: policy.mimeType || 'application/octet-stream',
        size: policy.size,
        source: (policy.mimeType || '').startsWith('image/') ? 'gallery' : 'document',
      });
    } catch {
      // Blocked type / empty / too large: the destination simply does not get this file.
    }
  }
  return accepted;
}

export function discardIncomingShare(share: IncomingShare): void {
  if (Platform.OS !== 'android' || !HubitShareIntentModule || !share.files?.length) return;
  void HubitShareIntentModule.discardSharedFilesAsync(share.id).catch(() => undefined);
}

export function queueIncomingShare(
  share: IncomingShare,
  target: IncomingShareTarget,
  extra: { copiedFiles?: NativePickedFile[]; conversationId?: string } = {},
): void {
  queuedNativeShare = {
    ...share,
    target,
    ...(extra.copiedFiles?.length ? { copiedFiles: extra.copiedFiles } : null),
    ...(extra.conversationId ? { conversationId: extra.conversationId } : null),
  };
}

/** Takes the queued share for a destination exactly once. A chat share is addressed to
 * one conversation: other threads must not consume it. */
export function consumeIncomingShare(
  target: IncomingShareTarget,
  conversationId?: string,
): QueuedIncomingShare | null {
  if (queuedNativeShare?.target !== target) return null;
  if (target === 'chat' && queuedNativeShare.conversationId !== conversationId) return null;
  const share = queuedNativeShare;
  queuedNativeShare = null;
  return share;
}

export function clearQueuedIncomingShareForTests(): void {
  queuedNativeShare = null;
}
