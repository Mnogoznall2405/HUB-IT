import { getSessionGeneration } from '../auth/tokenStore';
import type { ChatMessage } from '../api/types';
import { recordDiagnosticEvent } from '../diagnostics/diagnostics';
import { isNativeOfflineReadOnly } from '../offline/nativeOfflinePolicy';
import { createNativeChatDeliveryRunner } from './nativeChatDeliveryRunner';
import {
  createNativeChatDeliveryTransport,
  createNativeChatPersistConfirmed,
  type NativeChatTransport,
} from './nativeChatDeliveryTransport';
import {
  NATIVE_CHAT_MAX_DELIVERY_ATTEMPTS,
  readNativeChatOutbox,
  type NativeChatOutboxEntry,
} from './nativeChatOutbox';
import { getNativeChatThreadHistoryGeneration } from './nativeChatThreadHistory';

export const NATIVE_CHAT_BACKGROUND_DRAIN_BUDGET_MS = 120_000;

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

function hasDeliverableWork(rows: Array<NativeChatOutboxEntry & { busy?: boolean }>): boolean {
  return rows.some((row) => {
    const delivery = row.delivery;
    if (!delivery || delivery.state === 'confirmed' || delivery.state === 'cancelled'
      || delivery.state === 'paused') return false;
    if (row.busy) return true;
    if (delivery.attempts >= NATIVE_CHAT_MAX_DELIVERY_ATTEMPTS) return false;
    return delivery.state !== 'retry' || (delivery.notBefore || 0) <= Date.now();
  });
}

// S8-C: the WorkManager background task calls this while the app is suspended,
// so the outbox drains without a mounted React tree. Delivery itself is the
// same runner + transport the foreground host uses; the drain only adds a
// deadline and stops when nothing is deliverable right now (retry backoffs are
// left for the next wake or the foreground runner). The UI-lock gate is
// skipped on purpose — nothing unblocks it headless, and queued sends were
// already authorized while the app was open.
export async function drainNativeChatOutboxInBackground(userId: number, options: {
  budgetMs?: number;
  pollMs?: number;
  transport?: NativeChatTransport;
  persistConfirmed?: (entry: NativeChatOutboxEntry, saved: ChatMessage) => Promise<boolean>;
  ownsSession?: () => boolean;
} = {}): Promise<void> {
  const deadline = Date.now() + (options.budgetMs ?? NATIVE_CHAT_BACKGROUND_DRAIN_BUDGET_MS);
  const sessionGeneration = getSessionGeneration();
  const ownsSession = options.ownsSession ?? (() => getSessionGeneration() === sessionGeneration);
  const canDeliver = () => ownsSession() && Date.now() < deadline && !isNativeOfflineReadOnly();
  const runner = createNativeChatDeliveryRunner({
    userId, canDeliver,
    transport: options.transport ?? createNativeChatDeliveryTransport(canDeliver),
    persistConfirmed: options.persistConfirmed ?? createNativeChatPersistConfirmed({
      ownsSession, userId, historyGeneration: getNativeChatThreadHistoryGeneration(),
    }),
    onError: () => { void recordDiagnosticEvent('native_file_error'); },
  });
  try {
    while (canDeliver() && hasDeliverableWork(await readNativeChatOutbox(userId))) {
      await sleep(options.pollMs ?? 300);
    }
  } finally {
    runner.dispose();
  }
}
