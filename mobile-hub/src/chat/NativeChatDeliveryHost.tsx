import { useEffect, useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { getSessionGeneration } from '../auth/tokenStore';
import * as chatApi from '../api/chatApi';
import { buildAttachmentsFormData } from '../files/nativeFilePicker';
import { isNativeOfflineReadOnly } from '../offline/nativeOfflinePolicy';
import { recordDiagnosticEvent } from '../diagnostics/diagnostics';
import { readNativeEntitySnapshot } from '../cache/nativeSnapshotCache';
import { chatSocket } from './chatSocket';
import { publishNativeChatUploadProgress } from './nativeChatOutbox';
import { createNativeChatDeliveryRunner } from './nativeChatDeliveryRunner';
import { isNativeChatDeliveryBlocked, subscribeNativeChatDeliveryGate } from './nativeChatDeliveryGate';
import {
  getNativeChatThreadHistoryGeneration, scheduleNativeChatThreadSnapshotWrite,
  type NativeChatThreadSnapshot,
} from './nativeChatThreadHistory';

/** Mounted once in the authenticated shell, never once per conversation. */
export function NativeChatDeliveryHost() {
  const { user, hasPermission, offlineMode } = useAuth();
  const userId = Number(user?.id || 0);
  const allowed = hasPermission('chat.read') && hasPermission('chat.write');
  const access = useRef({ userId, allowed, offlineMode });
  useLayoutEffect(() => { access.current = { userId, allowed, offlineMode }; }, [userId, allowed, offlineMode]);
  useEffect(() => {
    if (!userId || !allowed) return;
    const sessionGeneration = getSessionGeneration();
    const historyGeneration = getNativeChatThreadHistoryGeneration();
    let active = true;
    let appActive = AppState.currentState === 'active';
    let runner: ReturnType<typeof createNativeChatDeliveryRunner> | null = null;
    const ownsSession = () => active && access.current.userId === userId && access.current.allowed
      && sessionGeneration === getSessionGeneration()
      && historyGeneration === getNativeChatThreadHistoryGeneration();
    const canDeliver = () => ownsSession() && appActive && !access.current.offlineMode
      && !isNativeOfflineReadOnly() && !isNativeChatDeliveryBlocked();
    const reconcile = () => {
      if (!canDeliver()) { runner?.dispose(); runner = null; return; }
      if (runner) { runner.wake(); return; }
      runner = createNativeChatDeliveryRunner({
        userId, canDeliver,
        transport: async (entry, signal) => {
          if (!canDeliver() || signal.aborted) throw Object.assign(new Error('Delivery paused'), { code: 'HUBIT_OFFLINE_READ_ONLY' });
          const id = entry.message.client_message_id!;
          if (entry.upload) {
            const upload = entry.upload;
            return chatApi.sendFileMessage(entry.message.conversation_id, buildAttachmentsFormData(upload.files, {
              body: upload.body, clientMessageId: id, replyToMessageId: upload.replyToMessageId,
              mediaKind: upload.mediaKind, durationSeconds: upload.durationSeconds,
            }), { signal, onProgress: (loaded, total) => publishNativeChatUploadProgress(entry, loaded, total) });
          }
          // The existing text transport cannot abort a request already accepted by
          // the network. Ownership prevents later requests; the same ID handles a lost ACK.
          return chatApi.sendTextMessage(entry.message.conversation_id, entry.message.body_text || '', {
            clientMessageId: id, replyToMessageId: entry.message.reply_preview?.id,
          });
        },
        persistConfirmed: async (entry, saved) => {
          if (!ownsSession()) return false;
          const dialog = entry.message.conversation_id;
          const previous = await readNativeEntitySnapshot<NativeChatThreadSnapshot>('chat-thread-details', userId, dialog);
          if (!ownsSession()) return false;
          const snapshot: NativeChatThreadSnapshot = previous?.data || {
            conversation: null, title: entry.title || 'Диалог', messages: [], hasOlder: true,
            olderCursor: null, hasNewer: false, newerCursor: null, unreadBoundaryId: null,
            focusAnchorId: null, pinnedMessageId: null, historyMayHaveGaps: true,
          };
          await scheduleNativeChatThreadSnapshotWrite(userId, dialog, { ...snapshot, messages: [saved] },
            { generation: historyGeneration, currentUserId: userId });
          if (!ownsSession()) return false;
          const verified = await readNativeEntitySnapshot<NativeChatThreadSnapshot>('chat-thread-details', userId, dialog);
          return ownsSession() && Boolean(verified?.data.messages.some((item) => item.id === saved.id
            && item.client_message_id === saved.client_message_id && !item.local_status));
        },
        onError: () => { void recordDiagnosticEvent('native_file_error'); },
      });
    };
    const offGate = subscribeNativeChatDeliveryGate(reconcile);
    const appState = AppState.addEventListener('change', (state) => { appActive = state === 'active'; reconcile(); });
    const offSocket = chatSocket.on('status', () => reconcile());
    // Parent offline-policy effects can settle after child effects. Recheck once,
    // without keeping a polling loop alive when there is no eligible session.
    const initial = setTimeout(reconcile, 0);
    return () => {
      active = false; clearTimeout(initial); runner?.dispose();
      appState.remove(); offGate(); offSocket();
    };
  }, [userId, allowed, offlineMode]);
  return null;
}
