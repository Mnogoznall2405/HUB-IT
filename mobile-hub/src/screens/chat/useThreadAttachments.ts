import { useCallback, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import * as chatApi from '../../api/chatApi';
import type { ChatAttachment, ChatMessage } from '../../api/types';
import { setChatAttachmentTransfer } from '../../chat/nativeChatAttachmentTransfers';
import { isAttachmentTransferAbort } from '../../chat/chatAttachmentTransfers';
import {
  collectThreadMedia,
  isImageChatAttachment,
  isMediaChatAttachment,
  mediaItemFromConversationAttachment,
  mergeChatMediaItems,
  type ChatMediaItem,
} from '../../chat/chatMedia';
import { toggleSelectedMessageId } from '../../chat/chatMessageSelection';
import {
  downloadChatAttachment,
  openNativeFile,
  shareNativeFile,
} from '../../files/nativeAttachmentDownloads';
import { showNativeToast } from '../../components/nativeToast';
import type { ChatAttachmentTransfer } from '../../components/chat/ChatDocumentAttachment';
import type { FailedAttachmentAction } from './NativeChatThreadScreen';

/** Attachment row actions: download/open/share/save transfers, media viewer,
 * manifest pagination and the actions sheet target. */
export function useThreadAttachments({
  conversationId,
  offlineMode,
  mountedRef,
  accumulatedMessagesRef,
  messagesRef,
  attachmentTransfersRef,
  downloadControllersRef,
  setAttachmentTransfers,
  selectedMessageIdsLength,
  setSelectedMessageIds,
  cancelPendingAttachmentUpload,
  retryPendingAttachmentUpload,
}: {
  conversationId: string;
  offlineMode: boolean;
  mountedRef: MutableRefObject<boolean>;
  accumulatedMessagesRef: MutableRefObject<ChatMessage[]>;
  messagesRef: MutableRefObject<ChatMessage[]>;
  attachmentTransfersRef: MutableRefObject<Record<string, ChatAttachmentTransfer>>;
  downloadControllersRef: MutableRefObject<Map<string, AbortController>>;
  setAttachmentTransfers: Dispatch<SetStateAction<Record<string, ChatAttachmentTransfer>>>;
  selectedMessageIdsLength: number;
  setSelectedMessageIds: Dispatch<SetStateAction<string[]>>;
  cancelPendingAttachmentUpload: (message: ChatMessage) => void;
  retryPendingAttachmentUpload: (message: ChatMessage) => void;
}) {
  const mediaManifestGenerationRef = useRef(0);
  const mediaManifestLoadingRef = useRef(false);
  const mediaManifestHasMoreRef = useRef(false);
  const mediaManifestCursorRef = useRef<string | null>(null);
  const mediaManifestKindRef = useRef<'image' | 'video'>('image');
  const failedAttachmentActionsRef = useRef(new Map<string, FailedAttachmentAction>());
  const [mediaViewer, setMediaViewer] = useState<ChatMediaItem | null>(null);
  const [mediaViewerItems, setMediaViewerItems] = useState<ChatMediaItem[] | null>(null);
  const [attachmentActionTarget, setAttachmentActionTarget] = useState<{
    message: ChatMessage;
    attachment: ChatAttachment;
  } | null>(null);

  const runAttachmentAction = useCallback(async (
    messageIdValue: string,
    attachment: ChatAttachment,
    action: 'open' | 'share' | 'save',
  ) => {
    if (attachmentTransfersRef.current[attachment.id]?.status === 'active') return;
    const controller = action === 'save' ? null : new AbortController();
    if (controller) {
      downloadControllersRef.current.get(attachment.id)?.abort();
      downloadControllersRef.current.set(attachment.id, controller);
    }
    failedAttachmentActionsRef.current.set(attachment.id, { messageId: messageIdValue, attachment, action });
    setAttachmentTransfers((current) => ({
      ...current,
      [attachment.id]: {
        action,
        progress: action === 'save' ? null : 0,
        status: 'active',
        cancellable: Boolean(controller),
      },
    }));
    let completed = false;
    try {
      if (action === 'save') {
        await chatApi.saveAttachmentToMyFiles(messageIdValue, attachment.id);
        if (mountedRef.current) showNativeToast('Сохранено', 'Вложение добавлено в «Мои файлы».');
        completed = true;
        return;
      }
      const file = await downloadChatAttachment(attachment, {
        signal: controller?.signal,
        onProgress: (progress) => {
          if (!mountedRef.current || downloadControllersRef.current.get(attachment.id) !== controller) return;
          // Download ticks reach only the subscribed attachment row via the
          // external store — no screen rerender per progress frame.
          setChatAttachmentTransfer(attachment.id, {
            action,
            progress: progress.progress,
            status: 'active',
            cancellable: true,
          });
        },
      });
      if (!mountedRef.current || downloadControllersRef.current.get(attachment.id) !== controller) return;
      if (action === 'share') {
        await shareNativeFile(file, attachment.file_name || 'hubit-file', attachment.mime_type);
      } else {
        await openNativeFile(file, attachment.mime_type);
      }
      completed = true;
    } catch (cause) {
      if (!mountedRef.current) return;
      if (controller && downloadControllersRef.current.get(attachment.id) !== controller) return;
      const cancelled = isAttachmentTransferAbort(cause, controller?.signal);
      setAttachmentTransfers((current) => ({
        ...current,
        [attachment.id]: {
          action,
          progress: current[attachment.id]?.progress ?? 0,
          status: cancelled ? 'cancelled' : 'failed',
          cancellable: false,
        },
      }));
    } finally {
      if (controller && downloadControllersRef.current.get(attachment.id) === controller) {
        downloadControllersRef.current.delete(attachment.id);
      }
      if (completed && mountedRef.current) {
        failedAttachmentActionsRef.current.delete(attachment.id);
        setAttachmentTransfers((current) => {
          if (!current[attachment.id]) return current;
          const next = { ...current };
          delete next[attachment.id];
          return next;
        });
      }
    }
  }, [attachmentTransfersRef, downloadControllersRef, failedAttachmentActionsRef, mountedRef, setAttachmentTransfers]);

  const cancelAttachmentTransfer = useCallback((message: ChatMessage, attachment: ChatAttachment) => {
    if (message.local_status === 'sending') {
      cancelPendingAttachmentUpload(message);
      return;
    }
    downloadControllersRef.current.get(attachment.id)?.abort();
  }, [cancelPendingAttachmentUpload, downloadControllersRef]);

  const retryAttachmentTransfer = useCallback((message: ChatMessage, attachment: ChatAttachment) => {
    if (message.local_status === 'failed' || message.local_status === 'cancelled') {
      retryPendingAttachmentUpload(message);
      return;
    }
    const failedAction = failedAttachmentActionsRef.current.get(attachment.id);
    if (!failedAction) return;
    void runAttachmentAction(failedAction.messageId, failedAction.attachment, failedAction.action);
  }, [failedAttachmentActionsRef, retryPendingAttachmentUpload, runAttachmentAction]);

  const mediaManifestNextRetryAtRef = useRef(0);
  const loadMoreMediaManifest = useCallback(async (restart = false) => {
    if (offlineMode) {
      mediaManifestHasMoreRef.current = false;
      return;
    }
    if (mediaManifestLoadingRef.current) return;
    if (!restart && !mediaManifestHasMoreRef.current) return;
    if (!restart && Date.now() < mediaManifestNextRetryAtRef.current) return;
    const generation = mediaManifestGenerationRef.current;
    mediaManifestLoadingRef.current = true;
    try {
      const page = await chatApi.getConversationAttachments(conversationId, {
        kind: mediaManifestKindRef.current,
        limit: 48,
        beforeAttachmentId: restart ? undefined : mediaManifestCursorRef.current || undefined,
      });
      if (!mountedRef.current || generation !== mediaManifestGenerationRef.current) return;
      const nextItems = page.items.map((entry) => mediaItemFromConversationAttachment(entry, conversationId));
      setMediaViewerItems((current) => mergeChatMediaItems(current || [], nextItems));
      mediaManifestHasMoreRef.current = page.has_more;
      mediaManifestCursorRef.current = page.next_before_attachment_id;
    } catch {
      // A failed page is not "no more pages" — keep hasMore but back off so a
      // dead endpoint is not hammered by onEndReached refires.
      if (generation === mediaManifestGenerationRef.current) {
        mediaManifestNextRetryAtRef.current = Date.now() + 5_000;
      }
    } finally {
      if (generation === mediaManifestGenerationRef.current) mediaManifestLoadingRef.current = false;
    }
  }, [conversationId, mountedRef, offlineMode]);

  const openMediaViewer = useCallback((
    nextItem: ChatMediaItem,
    seedItems: ChatMediaItem[] = [],
  ) => {
    const imageKind = isImageChatAttachment(nextItem.attachment);
    mediaManifestGenerationRef.current += 1;
    mediaManifestLoadingRef.current = false;
    mediaManifestHasMoreRef.current = !offlineMode;
    mediaManifestCursorRef.current = null;
    mediaManifestKindRef.current = imageKind ? 'image' : 'video';
    const localCorpus = accumulatedMessagesRef.current.length
      ? accumulatedMessagesRef.current
      : messagesRef.current;
    const localItems = collectThreadMedia(localCorpus).filter((entry) => (
      isImageChatAttachment(entry.attachment) === imageKind
    ));
    setMediaViewerItems(mergeChatMediaItems(seedItems, localItems, [nextItem]));
    setMediaViewer(nextItem);
    if (!offlineMode) void loadMoreMediaManifest(true);
  }, [accumulatedMessagesRef, loadMoreMediaManifest, messagesRef, offlineMode]);

  const closeMediaViewer = useCallback(() => {
    mediaManifestGenerationRef.current += 1;
    mediaManifestLoadingRef.current = false;
    mediaManifestHasMoreRef.current = false;
    mediaManifestCursorRef.current = null;
    setMediaViewer(null);
    setMediaViewerItems(null);
  }, []);

  const openAttachmentActions = useCallback((message: ChatMessage, attachment: ChatAttachment) => {
    if (selectedMessageIdsLength) {
      setSelectedMessageIds((current) => toggleSelectedMessageId(current, message.id));
      return;
    }
    if (isMediaChatAttachment(attachment)) {
      openMediaViewer({ message, attachment });
      return;
    }
    setAttachmentActionTarget({ message, attachment });
  }, [openMediaViewer, selectedMessageIdsLength, setSelectedMessageIds]);

  // Identical contract — keep one implementation so they cannot drift.
  const openAttachment = openAttachmentActions;

  return {
    mediaViewer,
    setMediaViewer,
    mediaViewerItems,
    attachmentActionTarget,
    setAttachmentActionTarget,
    runAttachmentAction,
    cancelAttachmentTransfer,
    retryAttachmentTransfer,
    loadMoreMediaManifest,
    openMediaViewer,
    closeMediaViewer,
    openAttachmentActions,
    openAttachment,
  };
}
