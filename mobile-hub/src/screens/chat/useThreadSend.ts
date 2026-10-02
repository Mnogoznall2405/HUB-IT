import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as chatApi from '../../api/chatApi';
import type { ChatMessage, HubUser } from '../../api/types';
import { formatApiError } from '../../api/formatError';
import { recordDiagnosticEvent } from '../../diagnostics/diagnostics';
import { markChatSend } from '../../diagnostics/chatSendTiming';
import { mergeMessages, toggleReactionOptimistic } from '../../chat/chatState';
import type { ChatListAnchorReason } from '../../chat/chatListAnchor';
import { createChatClientMessageId } from '../../chat/chatModels';
import { detectChatBodyFormat } from '../../chat/chatMarkdown';
import { clearNativeChatDraft } from '../../chat/chatDrafts';
import { getNativeChatQueueState, type createNativeChatOutbox } from '../../chat/nativeChatOutbox';
import {
  buildPendingAttachmentMessage,
  type PendingAttachmentMediaKind,
} from '../../chat/chatAttachmentTransfers';
import { downloadGifToCache, type ChatGifItem } from '../../chat/chatGiphy';
import { chatMessageMotionKey, type ChatMessageEnterKind } from '../../components/chat/ChatMessageEnterMotion';
import type { ChatAttachmentTransfer } from '../../components/chat/ChatDocumentAttachment';
import { showNativeToast } from '../../components/nativeToast';
import {
  NativeFilePermissionError,
  openAppPermissionSettings,
  pickNativeAttachments,
  type NativeAttachmentSource,
  type NativePickedFile,
} from '../../files/nativeFilePicker';
import type { useThreadComposerState } from './useThreadComposerState';
import type { PendingAttachmentUpload } from './NativeChatThreadScreen';

type ThreadOutbox = ReturnType<typeof createNativeChatOutbox>;
type Composer = ReturnType<typeof useThreadComposerState>;

function createClientMessageId(): string {
  return createChatClientMessageId();
}

/** Send pipeline: text/upload queueing, retry/cancel, pickers that feed sends. */
export function useThreadSend({
  conversationId,
  user,
  canWrite,
  offlineMode,
  isCurrentSendScope,
  mountedRef,
  outbox,
  requestBottomAnchor,
  setMessages,
  messageEnterMotionsRef,
  knownMessageIdsRef,
  pendingAttachmentUploadsRef,
  uploadControllersRef,
  setAttachmentTransfers,
  setEmojiPickerVisible,
  composer,
}: {
  conversationId: string;
  user: HubUser | null;
  canWrite: boolean;
  offlineMode: boolean;
  isCurrentSendScope: () => boolean;
  mountedRef: MutableRefObject<boolean>;
  outbox: ThreadOutbox;
  requestBottomAnchor: (reason?: ChatListAnchorReason) => void;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  messageEnterMotionsRef: MutableRefObject<Map<string, ChatMessageEnterKind>>;
  knownMessageIdsRef: MutableRefObject<Set<string>>;
  pendingAttachmentUploadsRef: MutableRefObject<Map<string, PendingAttachmentUpload>>;
  uploadControllersRef: MutableRefObject<Map<string, AbortController>>;
  setAttachmentTransfers: Dispatch<SetStateAction<Record<string, ChatAttachmentTransfer>>>;
  setEmojiPickerVisible: Dispatch<SetStateAction<boolean>>;
  composer: Composer;
}) {
  const {
    text,
    setText,
    textRevisionRef,
    composerMode,
    setComposerMode,
    composerBusyRef,
    setComposerBusy,
    pendingComposerSendRef,
    attachmentDraftSendRef,
    draftBeforeEditRef,
    attachmentDraftFiles,
    setAttachmentDraftFiles,
    setAttachmentDraftError,
    setImageEditorFile,
    setAttachmentPickerVisible,
    stopOutgoingTyping,
  } = composer;
  const attachmentDraftClientMessageIdRef = useRef('');

  const sendBody = useCallback(async (
    body: string,
    clientMessageId = createClientMessageId(),
    replyPreview?: ChatMessage['reply_preview'],
    animateFromComposer = true,
    onPersisted?: () => void,
    onQueueFailed?: (cause: unknown) => void,
    messageKind: 'location' | 'contact' | 'poll' | 'text' = 'text',
  ): Promise<void> => {
    const trimmed = body.trim();
    if (!trimmed || !isCurrentSendScope()) return;
    markChatSend(clientMessageId, 'tap_send');
    stopOutgoingTyping();
    const pendingId = `pending:${clientMessageId}`;
    const pending: ChatMessage = {
      id: pendingId,
      conversation_id: conversationId,
      sender_user_id: Number(user?.id || 0),
      sender: user ? {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        avatar_url: user.avatar_url,
      } : null,
      kind: messageKind,
      body: trimmed,
      body_text: trimmed,
      body_format: messageKind === 'text' ? detectChatBodyFormat(trimmed) : 'plain',
      created_at: new Date().toISOString(),
      client_message_id: clientMessageId,
      is_own: true,
      local_status: 'sending',
      attachments: [],
      reactions: [],
      reply_preview: replyPreview || null,
    };
    if (animateFromComposer) {
      messageEnterMotionsRef.current.set(chatMessageMotionKey(pending), 'outgoing');
    }
    requestBottomAnchor('own-send');
    setMessages((current) => mergeMessages(
      current.filter((message) => message.id !== pendingId),
      pending,
      user?.id,
    ));
    markChatSend(clientMessageId, 'bubble_visible');
    knownMessageIdsRef.current.add(pendingId);
    try {
      const queued = await outbox.queue(pending);
      if (!isCurrentSendScope()) return;
      if (getNativeChatQueueState(queued.message) !== 'cancelled') onPersisted?.();
      setMessages((current) => mergeMessages(current, queued.message, user?.id));
    } catch (cause) {
      if (!isCurrentSendScope()) return;
      setMessages((current) => current.map((message) => (
        message.id === pendingId ? { ...message, local_status: 'failed' } : message
      )));
      if (onQueueFailed) {
        onQueueFailed(cause);
      } else {
        showNativeToast('Не удалось сохранить сообщение',
          formatApiError(cause, 'Текст остался в поле ввода. Сообщение не поставлено в очередь.'));
      }
    }
  }, [isCurrentSendScope, conversationId, outbox, requestBottomAnchor, stopOutgoingTyping, user]);

  const toggleReaction = useCallback(async (message: ChatMessage, emoji: string) => {
    if (!isCurrentSendScope() || !canWrite || message.is_deleted || message.local_status) return;
    const previousReactions = message.reactions || [];
    setMessages((current) => current.map((item) => (
      item.id === message.id
        ? { ...item, reactions: toggleReactionOptimistic(item.reactions, emoji, user?.id) }
        : item
    )));
    try {
      const reactions = await chatApi.toggleReaction(conversationId, message.id, emoji);
      if (!isCurrentSendScope()) return;
      setMessages((current) => current.map((item) => (
        item.id === message.id ? { ...item, reactions } : item
      )));
    } catch (cause) {
      if (!isCurrentSendScope()) return;
      setMessages((current) => current.map((item) => (
        item.id === message.id ? { ...item, reactions: previousReactions } : item
      )));
      showNativeToast('Не удалось изменить реакцию', formatApiError(cause, 'Повторите попытку'));
    }
  }, [isCurrentSendScope, canWrite, conversationId, user?.id]);

  const requestDelete = useCallback((message: ChatMessage) => {
    Alert.alert(
      'Удалить сообщение?',
      'Текст и вложения будут скрыты у всех участников диалога.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => {
            if (!isCurrentSendScope()) return;
            void chatApi.deleteMessage(conversationId, message.id)
              .then((deleted) => {
                if (isCurrentSendScope()) {
                  setMessages((current) => mergeMessages(current, deleted, user?.id));
                }
              })
              .catch((cause) => {
                if (isCurrentSendScope()) {
                  Alert.alert('Не удалось удалить сообщение', formatApiError(cause, 'Повторите попытку'));
                }
              });
          },
        },
      ],
    );
  }, [isCurrentSendScope, conversationId, user?.id]);

  const discardPendingMessage = useCallback((message: ChatMessage) => {
    const id = message.client_message_id;
    if (!id || !message.local_status || message.local_status === 'sending') return;
    Alert.alert('Убрать сообщение из очереди?', 'Повторная отправка будет недоступна. Если сервер уже получил сообщение, оно останется в переписке.', [
      { text: 'Оставить', style: 'cancel' },
      { text: 'Убрать', style: 'destructive', onPress: () => {
        if (!mountedRef.current || uploadControllersRef.current.has(id)) return;
        void outbox.discard(id).then(() => {
          if (!mountedRef.current) return;
          pendingAttachmentUploadsRef.current.delete(id);
          setMessages((current) => current.filter((item) => !(item.client_message_id === id && item.local_status)));
        }).catch(() => {
          if (mountedRef.current) Alert.alert('Не удалось убрать сообщение', 'Дождитесь завершения отправки или повторите действие.');
        });
      } },
    ]);
  }, [mountedRef, outbox, pendingAttachmentUploadsRef, uploadControllersRef]);

  const sendMessage = useCallback(async () => {
    if (composerBusyRef.current || !isCurrentSendScope()) return;
    const body = text.trim();
    if (!body) return;

    if (composerMode?.type === 'edit') {
      if (offlineMode) {
        showNativeToast('Нет сети', 'Сохранение правки на сервере недоступно офлайн.');
        return;
      }
      if (composerMode.message.is_deleted) {
        showNativeToast('Сообщение удалено', 'Сохранить изменения нельзя. Текст правки остался в поле ввода. Отмена редактирования вернёт ваш обычный черновик.');
        return;
      }
      setComposerBusy(true);
      try {
        const saved = await chatApi.editMessage(conversationId, composerMode.message.id, body);
        if (!isCurrentSendScope()) return;
        setMessages((current) => mergeMessages(current, saved, user?.id));
        setText(draftBeforeEditRef.current);
        draftBeforeEditRef.current = '';
        setComposerMode(null);
      } catch (cause) {
        if (isCurrentSendScope()) {
          showNativeToast('Не удалось сохранить изменения', formatApiError(cause, 'Повторите попытку'));
        }
      } finally {
        if (isCurrentSendScope()) setComposerBusy(false);
      }
      return;
    }

    const replyMessage = composerMode?.type === 'reply' ? composerMode.message : null;
    if (pendingComposerSendRef.current) return;
    const submission = Symbol('composer-send');
    pendingComposerSendRef.current = submission;
    const replyPreview = replyMessage ? {
      id: replyMessage.id,
      sender_name: replyMessage.sender?.full_name || replyMessage.sender?.username || 'Сообщение',
      kind: replyMessage.kind === 'file' || replyMessage.kind === 'task_share' ? replyMessage.kind : 'text' as const,
      body: replyMessage.body_text || '',
      attachments_count: replyMessage.attachments?.length || 0,
    } : undefined;
    const replyModeSnapshot = composerMode?.type === 'reply' ? composerMode : null;
    // S2: clear the composer immediately — the scope already holds body/reply.
    setText('');
    setComposerMode(null);
    const postClearRevision = textRevisionRef.current;
    const sending = sendBody(body, undefined, replyPreview, true, () => {
      if (pendingComposerSendRef.current === submission) pendingComposerSendRef.current = null;
      if (!mountedRef.current) return;
      if (user?.id) void clearNativeChatDraft(user.id, conversationId).catch(() => undefined);
    }, (cause) => {
      if (!isCurrentSendScope()) return;
      if (textRevisionRef.current === postClearRevision) {
        // Composer untouched since send — give the text back quietly.
        setText(body);
        if (replyModeSnapshot) setComposerMode(replyModeSnapshot);
        showNativeToast('Не удалось сохранить сообщение',
          formatApiError(cause, 'Текст возвращён в поле ввода. Сообщение не поставлено в очередь.'));
        return;
      }
      Alert.alert('Не удалось сохранить сообщение',
        formatApiError(cause, 'Новый ввод сохранён; отправленный текст остался в пузыре ошибки.'), [
          { text: 'Скопировать текст', onPress: () => { void Clipboard.setStringAsync(body).catch(() => undefined); } },
          {
            text: 'Повторить',
            onPress: () => { void sendBody(body, undefined, replyPreview, false); },
          },
          { text: 'Отмена', style: 'cancel' },
        ]);
    });
    try { await sending; }
    finally { if (pendingComposerSendRef.current === submission) pendingComposerSendRef.current = null; }
  }, [isCurrentSendScope, composerMode, conversationId, mountedRef, offlineMode, sendBody,
    setComposerMode, setText, text, user?.id]);

  const setAttachmentTransfersForIds = useCallback((
    attachmentIds: string[],
    transfer: ChatAttachmentTransfer,
  ) => {
    setAttachmentTransfers((current) => {
      const next = { ...current };
      attachmentIds.forEach((attachmentId) => {
        next[attachmentId] = transfer;
      });
      return next;
    });
  }, [setAttachmentTransfers]);

  const clearAttachmentTransfersForIds = useCallback((attachmentIds: string[]) => {
    setAttachmentTransfers((current) => {
      if (!attachmentIds.some((attachmentId) => current[attachmentId])) return current;
      const next = { ...current };
      attachmentIds.forEach((attachmentId) => delete next[attachmentId]);
      return next;
    });
  }, [setAttachmentTransfers]);

  const sendPickedFiles = useCallback(async (
    files: NativePickedFile[],
    extra: {
      mediaKind?: PendingAttachmentMediaKind;
      durationSeconds?: number;
      clientMessageId?: string;
      body?: string;
      replyToMessageId?: string;
      replyPreview?: ChatMessage['reply_preview'];
    } = {},
  ): Promise<boolean> => {
    if (!files.length || !isCurrentSendScope()) return false;
    const clientMessageId = extra.clientMessageId || createClientMessageId();
    markChatSend(clientMessageId, 'tap_send');
    const previousUpload = pendingAttachmentUploadsRef.current.get(clientMessageId);
    const replyMessage = !previousUpload && composerMode?.type === 'reply' ? composerMode.message : null;
    const replyPreview = extra.replyPreview ?? previousUpload?.replyPreview ?? (replyMessage ? {
      id: replyMessage.id,
      sender_name: replyMessage.sender?.full_name || replyMessage.sender?.username || 'Сообщение',
      kind: replyMessage.kind === 'file' || replyMessage.kind === 'task_share' ? replyMessage.kind : 'text' as const,
      body: replyMessage.body_text || '',
      attachments_count: replyMessage.attachments?.length || 0,
    } : undefined);
    const upload: PendingAttachmentUpload = previousUpload || {
      files: [...files],
      mediaKind: extra.mediaKind,
      durationSeconds: extra.durationSeconds,
      body: extra.body ?? text,
      replyToMessageId: extra.replyToMessageId || replyMessage?.id,
      replyPreview,
    };
    pendingAttachmentUploadsRef.current.set(clientMessageId, upload);

    const pending = buildPendingAttachmentMessage({
      conversationId,
      clientMessageId,
      files: upload.files,
      mediaKind: upload.mediaKind,
      body: upload.body,
      bodyFormat: detectChatBodyFormat(upload.body),
      replyPreview: upload.replyPreview,
      sender: user ? {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        avatar_url: user.avatar_url,
      } : null,
    });
    const attachmentIds = (pending.attachments || []).map((attachment) => attachment.id);
    const controller = new AbortController();
    uploadControllersRef.current.get(clientMessageId)?.abort();
    uploadControllersRef.current.set(clientMessageId, controller);
    setAttachmentTransfersForIds(attachmentIds, {
      action: 'upload',
      progress: 0,
      status: 'active',
      cancellable: true,
    });
    stopOutgoingTyping();
    requestBottomAnchor('own-send');
    const replyModeSnapshot = !previousUpload && composerMode?.type === 'reply' ? composerMode : null;
    const captionSnapshot = upload.body;
    const draftFilesSnapshot = attachmentDraftFiles;
    let postClearRevision = -1;
    if (!previousUpload) {
      // S2: composer (caption + reply + draft files) clears immediately;
      // the upload scope already holds the full payload.
      setText('');
      setComposerMode(null);
      setAttachmentDraftFiles([]);
      postClearRevision = textRevisionRef.current;
      messageEnterMotionsRef.current.set(chatMessageMotionKey(pending), 'outgoing');
    }
    knownMessageIdsRef.current.add(pending.id);
    setMessages((current) => mergeMessages(
      current.filter((message) => message.id !== pending.id),
      pending,
      user?.id,
    ));
    markChatSend(clientMessageId, 'bubble_visible');

    try {
      const queued = await outbox.queue(pending, upload);
      if (!isCurrentSendScope()) return false;
      const durableUpload = queued.upload;
      if (!durableUpload) throw new Error('Не удалось восстановить сохранённое вложение');
      pendingAttachmentUploadsRef.current.set(clientMessageId, durableUpload);
      setMessages((current) => mergeMessages(current, queued.message, user?.id));
      clearAttachmentTransfersForIds(attachmentIds);
      if (getNativeChatQueueState(queued.message) !== 'cancelled' && !previousUpload) {
        if (user?.id) void clearNativeChatDraft(user.id, conversationId).catch(() => undefined);
      }
      return getNativeChatQueueState(queued.message) !== 'cancelled';
    } catch (cause) {
      if (!isCurrentSendScope()) return false;
      const cancelled = controller.signal.aborted;
      setMessages((current) => current.map((message) => message.id === pending.id
        ? { ...message, local_status: cancelled ? 'cancelled' : 'failed' } : message));
      setAttachmentTransfersForIds(attachmentIds, {
        action: 'upload', progress: 0, status: cancelled ? 'cancelled' : 'failed', cancellable: false,
      });
      if (!cancelled) {
        void recordDiagnosticEvent('native_file_error');
        if (!previousUpload && textRevisionRef.current === postClearRevision) {
          setText(captionSnapshot || '');
          if (replyModeSnapshot) setComposerMode(replyModeSnapshot);
          setAttachmentDraftFiles(draftFilesSnapshot);
          // The failed draft send keeps its idempotency key: retrying must
          // reuse this client_message_id, not mint a duplicate bubble/message.
          attachmentDraftClientMessageIdRef.current = clientMessageId;
          showNativeToast('Не удалось сохранить вложение', formatApiError(cause,
            'Подпись и файлы возвращены в композер. Сообщение не поставлено в очередь.'));
        } else {
          showNativeToast('Не удалось сохранить вложение', formatApiError(cause,
            'Файл не поставлен в очередь. Повторите сохранение на устройстве.'));
        }
      }
      return false;
    } finally {
      if (uploadControllersRef.current.get(clientMessageId) === controller) {
        uploadControllersRef.current.delete(clientMessageId);
      }
    }
  }, [attachmentDraftFiles, isCurrentSendScope, clearAttachmentTransfersForIds, composerMode,
    conversationId, outbox, requestBottomAnchor, setAttachmentDraftFiles,
    setAttachmentTransfersForIds, setComposerMode, setText, stopOutgoingTyping, text, user]);

  const sendPickedFile = useCallback(async (
    file: NativePickedFile | null,
    extra: { mediaKind?: 'image' | 'video' | 'file' | 'audio'; durationSeconds?: number } = {},
  ) => {
    if (file) await sendPickedFiles([file], { ...extra, clientMessageId: createClientMessageId() });
  }, [sendPickedFiles]);

  const cancelPendingAttachmentUpload = useCallback((message: ChatMessage) => {
    const clientMessageId = String(message.client_message_id || '').trim();
    if (!clientMessageId) return;
    uploadControllersRef.current.get(clientMessageId)?.abort();
    void outbox.cancelDelivery(clientMessageId).catch(() => {
      if (mountedRef.current) showNativeToast('Не удалось отменить отправку', 'Повторите действие.');
    });
  }, [mountedRef, outbox, uploadControllersRef]);

  const retryPendingAttachmentUpload = useCallback((message: ChatMessage) => {
    const clientMessageId = String(message.client_message_id || '').trim();
    if (clientMessageId && getNativeChatQueueState(message)) {
      void outbox.retryDelivery(clientMessageId).catch(() => {
        if (mountedRef.current) showNativeToast('Не удалось повторить отправку', 'Дождитесь завершения текущей операции.');
      });
      return;
    }
    const pending = pendingAttachmentUploadsRef.current.get(clientMessageId);
    if (!clientMessageId || !pending) return;
    void sendPickedFiles(pending.files, {
      clientMessageId,
      mediaKind: pending.mediaKind,
      durationSeconds: pending.durationSeconds,
      body: pending.body,
      replyToMessageId: pending.replyToMessageId,
      replyPreview: pending.replyPreview,
    });
  }, [mountedRef, outbox, pendingAttachmentUploadsRef, sendPickedFiles]);

  const retryPendingMessage = useCallback((message: ChatMessage) => {
    if (message.attachments?.length) {
      retryPendingAttachmentUpload(message);
      return;
    }
    void sendBody(
      message.body_text || '',
      message.client_message_id || undefined,
      message.reply_preview || undefined,
      false,
    );
  }, [retryPendingAttachmentUpload, sendBody]);

  const pickAndSendAttachment = useCallback(async (source: NativeAttachmentSource) => {
    setAttachmentPickerVisible(false);
    try {
      const files = await pickNativeAttachments(source);
      if (!files.length || !isCurrentSendScope()) return;
      if (files.length === 1 && (source === 'camera' || source === 'gallery') && files[0].mimeType.startsWith('image/')) {
        setImageEditorFile(files[0]);
        return;
      }
      if (files.length > 1) {
        setAttachmentDraftError('');
        attachmentDraftClientMessageIdRef.current = createClientMessageId();
        setAttachmentDraftFiles(files);
        return;
      }
      await sendPickedFile(files[0]);
    } catch (cause) {
      if (!mountedRef.current) return;
      if (cause instanceof NativeFilePermissionError) {
        Alert.alert(
          'Нет доступа к камере',
          'Разрешите HUB-IT использовать камеру в настройках Android.',
          [
            { text: 'Отмена', style: 'cancel' },
            { text: 'Открыть настройки', onPress: () => void openAppPermissionSettings() },
          ],
        );
      } else {
        showNativeToast('Не удалось отправить вложение', formatApiError(cause, 'Повторите попытку'));
      }
    }
  }, [isCurrentSendScope, mountedRef, sendPickedFile]);

  const sendAttachmentDraft = useCallback(async () => {
    if (!attachmentDraftFiles.length || attachmentDraftSendRef.current) return;
    attachmentDraftSendRef.current = true;
    setComposerBusy(true);
    const files = attachmentDraftFiles;
    const clientMessageId = attachmentDraftClientMessageIdRef.current || createClientMessageId();
    attachmentDraftClientMessageIdRef.current = '';
    setAttachmentDraftError('');
    try { await sendPickedFiles(files, { clientMessageId }); }
    finally {
      attachmentDraftSendRef.current = false;
      if (mountedRef.current) setComposerBusy(false);
    }
  }, [attachmentDraftFiles, mountedRef, sendPickedFiles, setComposerBusy]);

  const sendLocation = useCallback(async () => {
    // Double taps must not stack GPS lookups and duplicate the bubble.
    if (composerBusyRef.current) return;
    setComposerBusy(true);
    try {
      const Location = await import('expo-location');
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Нет доступа к геопозиции',
          'Разрешите HUB-IT определять местоположение в настройках Android.',
          [
            { text: 'Отмена', style: 'cancel' },
            { text: 'Открыть настройки', onPress: () => void openAppPermissionSettings() },
          ],
        );
        return;
      }
      // expo-location has no timeout option on this SDK version — bound the
      // wait ourselves so a hung provider cannot keep the composer busy.
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const position = await Promise.race([
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('Истекло время ожидания геопозиции')),
            15_000,
          );
        }),
      ]).finally(() => { if (timeoutId !== null) clearTimeout(timeoutId); });
      if (!isCurrentSendScope()) return;
      await sendBody(
        JSON.stringify({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
        createClientMessageId(),
        undefined,
        true,
        undefined,
        undefined,
        'location',
      );
    } catch (cause) {
      if (mountedRef.current) {
        showNativeToast('Не удалось отправить геопозицию', formatApiError(cause, 'Повторите попытку'));
      }
    } finally {
      if (mountedRef.current) setComposerBusy(false);
    }
  }, [composerBusyRef, isCurrentSendScope, mountedRef, sendBody, setComposerBusy]);

  const sendContact = useCallback(async () => {
    if (composerBusyRef.current) return;
    setComposerBusy(true);
    try {
      const Contacts = await import('expo-contacts');
      const permission = await Contacts.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Нет доступа к контактам',
          'Разрешите HUB-IT читать контакты в настройках Android.',
          [
            { text: 'Отмена', style: 'cancel' },
            { text: 'Открыть настройки', onPress: () => void openAppPermissionSettings() },
          ],
        );
        return;
      }
      // On some OEM builds the picker promise never settles after dismiss —
      // without a bound the composer stays busy forever. Generous timeout
      // because the pick is user-paced.
      let contactTimeoutId: ReturnType<typeof setTimeout> | null = null;
      const contact = await Promise.race([
        Contacts.Contact.presentPicker(),
        new Promise<never>((_, reject) => {
          contactTimeoutId = setTimeout(
            () => reject(new Error('Истекло время ожидания выбора контакта')),
            60_000,
          );
        }),
      ]).finally(() => { if (contactTimeoutId !== null) clearTimeout(contactTimeoutId); });
      if (!contact || !isCurrentSendScope()) return;
      const [fullName, phones] = await Promise.all([
        contact.getFullName().catch(() => ''),
        contact.getPhones().catch(() => []),
      ]);
      const phone = phones[0]?.number ? String(phones[0].number).trim() : '';
      const name = String(fullName || '').trim() || phone;
      if (!name) return;
      await sendBody(
        JSON.stringify(phone ? { name, phone } : { name }),
        createClientMessageId(),
        undefined,
        true,
        undefined,
        undefined,
        'contact',
      );
    } catch (cause) {
      if (mountedRef.current) {
        showNativeToast('Не удалось отправить контакт', formatApiError(cause, 'Повторите попытку'));
      }
    } finally {
      if (mountedRef.current) setComposerBusy(false);
    }
  }, [composerBusyRef, isCurrentSendScope, mountedRef, sendBody, setComposerBusy]);

  const sendPoll = useCallback(async (question: string, options: string[], anonymous = true) => {
    const trimmedQuestion = question.trim();
    const normalizedOptions = options.map((item) => item.trim()).filter(Boolean);
    if (!trimmedQuestion || normalizedOptions.length < 2 || composerBusyRef.current) return;
    setComposerBusy(true);
    try {
      await sendBody(
        JSON.stringify({ question: trimmedQuestion, options: normalizedOptions, anonymous }),
        createClientMessageId(),
        undefined,
        true,
        undefined,
        undefined,
        'poll',
      );
    } finally {
      if (mountedRef.current) setComposerBusy(false);
    }
  }, [composerBusyRef, mountedRef, sendBody, setComposerBusy]);

  const votePoll = useCallback(async (message: ChatMessage, optionIndex: number) => {
    if (!isCurrentSendScope() || message.kind !== 'poll') return;
    // Optimistic: server aggregates votes; the poll payload returns canonical state.
    const previousPoll = message.poll || null;
    const current = previousPoll;
    if (current) {
      const nextOptions = current.options.map((option, index) => ({ ...option }));
      const sameVote = current.my_option_index === optionIndex;
      if (current.my_option_index != null && nextOptions[current.my_option_index]) {
        nextOptions[current.my_option_index].votes = Math.max(0, nextOptions[current.my_option_index].votes - 1);
      }
      if (!sameVote && nextOptions[optionIndex]) {
        nextOptions[optionIndex].votes += 1;
      }
      setMessages((items) => mergeMessages(items, {
        ...message,
        poll: {
          ...current,
          options: nextOptions,
          total_voters: Math.max(0, current.total_voters + (sameVote ? -1 : current.my_option_index == null ? 1 : 0)),
          my_option_index: sameVote ? null : optionIndex,
        },
      }, user?.id));
    }
    try {
      const result = await chatApi.voteMessagePoll(message.conversation_id, message.id, optionIndex);
      if (!isCurrentSendScope() || !result.poll) return;
      setMessages((items) => mergeMessages(items, { ...message, poll: result.poll }, user?.id));
    } catch (cause) {
      if (!mountedRef.current) return;
      if (previousPoll) {
        setMessages((items) => mergeMessages(items, { ...message, poll: previousPoll }, user?.id));
      }
      showNativeToast('Не удалось проголосовать', formatApiError(cause, 'Повторите попытку'));
    }
  }, [isCurrentSendScope, mountedRef, setMessages, user?.id]);

  // R-POLL-2: the author stops the poll; the ack carries the aggregate state.
  const closePoll = useCallback(async (message: ChatMessage) => {
    if (!isCurrentSendScope() || message.kind !== 'poll') return;
    const previousPoll = message.poll || null;
    if (previousPoll) {
      setMessages((items) => mergeMessages(items, {
        ...message,
        poll: { ...previousPoll, closed: true },
      }, user?.id));
    }
    try {
      const result = await chatApi.closeMessagePoll(message.conversation_id, message.id);
      if (!isCurrentSendScope() || !result.poll) return;
      setMessages((items) => mergeMessages(items, { ...message, poll: result.poll }, user?.id));
    } catch (cause) {
      if (!mountedRef.current) return;
      if (previousPoll) {
        setMessages((items) => mergeMessages(items, { ...message, poll: previousPoll }, user?.id));
      }
      showNativeToast('Не удалось завершить опрос', formatApiError(cause, 'Повторите попытку'));
    }
  }, [isCurrentSendScope, mountedRef, setMessages, user?.id]);

  const sendGif = useCallback(async (gif: ChatGifItem) => {
    // The download can take seconds; without the busy guard a second tap
    // downloads and sends the same GIF again.
    if (composerBusyRef.current) return;
    setEmojiPickerVisible(false);
    setComposerBusy(true);
    try {
      const file = await downloadGifToCache(gif);
      await sendPickedFile(file);
    } catch (cause) {
      if (mountedRef.current) {
        showNativeToast('Не удалось отправить GIF', formatApiError(cause, 'Повторите попытку'));
      }
    } finally {
      if (mountedRef.current) setComposerBusy(false);
    }
  }, [composerBusyRef, mountedRef, sendPickedFile, setComposerBusy, setEmojiPickerVisible]);

  return {
    sendBody,
    sendMessage,
    sendPickedFiles,
    sendPickedFile,
    toggleReaction,
    requestDelete,
    discardPendingMessage,
    cancelPendingAttachmentUpload,
    retryPendingAttachmentUpload,
    retryPendingMessage,
    pickAndSendAttachment,
    sendAttachmentDraft,
    sendLocation,
    sendContact,
    sendPoll,
    votePoll,
    closePoll,
    sendGif,
    setAttachmentTransfersForIds,
    clearAttachmentTransfersForIds,
    attachmentDraftClientMessageIdRef,
  };
}
