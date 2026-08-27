import { Platform } from 'react-native';
import HubitShareIntentModule, {
  type HubitNativeSharePayload,
} from '../../modules/hubit-share-intent';

export type IncomingTextShare = HubitNativeSharePayload & {
  target?: 'mail' | 'task';
};

let queuedNativeShare: IncomingTextShare | null = null;

export function normalizeIncomingTextShare(value: unknown): IncomingTextShare | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Partial<IncomingTextShare>;
  const id = String(item.id || '').trim().slice(0, 100);
  const text = String(item.text || '').slice(0, 20_000);
  const subject = String(item.subject || '').trim().slice(0, 500);
  const mimeType = String(item.mimeType || 'text/plain').trim().slice(0, 100);
  const receivedAt = Number(item.receivedAt || 0);
  if (!id || !text.trim() || !receivedAt || !['text/plain', 'text/*'].includes(mimeType.toLowerCase())) {
    return null;
  }
  return { id, text, subject, mimeType, receivedAt };
}

export async function getPendingIncomingTextShare(): Promise<IncomingTextShare | null> {
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

export function queueIncomingShare(
  share: IncomingTextShare,
  target: 'mail' | 'task',
): void {
  queuedNativeShare = { ...share, target };
}

export function consumeIncomingShare(target: 'mail' | 'task'): IncomingTextShare | null {
  if (queuedNativeShare?.target !== target) return null;
  const share = queuedNativeShare;
  queuedNativeShare = null;
  return share;
}

export function clearQueuedIncomingShareForTests(): void {
  queuedNativeShare = null;
}
