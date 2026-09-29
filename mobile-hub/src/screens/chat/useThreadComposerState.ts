import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '../../api/types';
import { chatSocket } from '../../chat/chatSocket';
import { getNativeChatDraftState } from '../../chat/chatDrafts';
import { getTrailingMentionQuery } from '../../components/chat/ChatMentionSuggestions';
import { showNativeToast } from '../../components/nativeToast';
import type { NativePickedFile } from '../../files/nativeFilePicker';

export type ThreadComposerMode = { type: 'reply' | 'edit'; message: ChatMessage } | null;

/** Composer input, reply/edit mode, drafts and outgoing typing state. */
export function useThreadComposerState({
  conversationId,
  userId,
  canWrite,
  offlineMode,
  sendScope,
  messages,
}: {
  conversationId: string;
  userId?: number;
  canWrite: boolean;
  offlineMode: boolean;
  sendScope: symbol;
  messages: ChatMessage[];
}) {
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftError, setDraftError] = useState('');
  const textRevisionRef = useRef(0);
  const draftBeforeEditRef = useRef('');
  const [text, setTextState] = useState('');
  const setText = useCallback((value: string | ((previous: string) => string)) => {
    textRevisionRef.current += 1;
    setTextState(value);
  }, []);
  const [composerMode, setComposerModeState] = useState<ThreadComposerMode>(null);
  const setComposerMode = useCallback((value: ThreadComposerMode) => {
    textRevisionRef.current += 1;
    setComposerModeState(value);
  }, []);
  useEffect(() => {
    if (!composerMode || composerMode.message.is_deleted) return;
    const source = messages.find((message) => message.id === composerMode.message.id);
    if (!source?.is_deleted) return;
    setComposerMode({ ...composerMode, message: { ...composerMode.message, is_deleted: true, body_text: 'Сообщение удалено' } });
  }, [composerMode, messages, setComposerMode]);
  const pendingComposerSendRef = useRef<symbol | null>(null);
  const attachmentDraftSendRef = useRef(false);
  const [composerBusy, updateComposerBusy] = useState(false);
  const composerBusyRef = useRef(false);
  const setComposerBusy = useCallback((value: boolean) => {
    composerBusyRef.current = value;
    updateComposerBusy(value);
  }, []);
  useEffect(() => { setComposerBusy(false); }, [sendScope, setComposerBusy]);
  const [attachmentPickerVisible, setAttachmentPickerVisible] = useState(false);
  const [attachmentDraftFiles, setAttachmentDraftFilesState] = useState<NativePickedFile[]>([]);
  const setAttachmentDraftFiles = useCallback((files: NativePickedFile[] | ((current: NativePickedFile[]) => NativePickedFile[])) => {
    textRevisionRef.current += 1;
    setAttachmentDraftFilesState(files);
  }, []);
  const [attachmentDraftError, setAttachmentDraftError] = useState('');
  const [imageEditorFile, setImageEditorFile] = useState<NativePickedFile | null>(null);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const cancelVoiceRef = useRef<(() => void) | null>(null);
  const typingIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingActiveRef = useRef(false);

  useEffect(() => {
    setDraftHydrated(false);
    setDraftError('');
    const initialRevision = textRevisionRef.current;
    let active = true;
    const owner = Number(userId || 0);
    if (!owner) return () => { active = false; };
    void getNativeChatDraftState(owner, conversationId).then((draft) => {
      if (!active) return;
      if (textRevisionRef.current === initialRevision) {
        setTextState(draft?.text || '');
        setComposerMode(draft?.context?.mode || null);
        draftBeforeEditRef.current = draft?.context?.beforeEditText || '';
        setAttachmentDraftFiles(draft?.context?.files || []);
      }
      setDraftHydrated(true);
    }).catch(() => {
      if (active) setDraftError('Не удалось прочитать черновик. Откройте диалог снова, чтобы повторить.');
    });
    return () => { active = false; };
  }, [conversationId, userId, setAttachmentDraftFiles, setComposerMode]);

  const stopOutgoingTyping = useCallback(() => {
    if (typingIdleRef.current) {
      clearTimeout(typingIdleRef.current);
      typingIdleRef.current = null;
    }
    if (typingActiveRef.current) {
      typingActiveRef.current = false;
      chatSocket.sendTyping(conversationId, false);
    }
  }, [conversationId]);

  const handleComposerText = useCallback((value: string) => {
    setText(value);
    if (!canWrite || composerMode?.type === 'edit') return;
    if (!value.trim()) {
      stopOutgoingTyping();
      return;
    }
    if (!typingActiveRef.current) {
      typingActiveRef.current = true;
      chatSocket.sendTyping(conversationId, true);
    }
    if (typingIdleRef.current) clearTimeout(typingIdleRef.current);
    typingIdleRef.current = setTimeout(() => {
      typingActiveRef.current = false;
      chatSocket.sendTyping(conversationId, false);
      typingIdleRef.current = null;
    }, 2000);
  }, [canWrite, composerMode?.type, conversationId, setText, stopOutgoingTyping]);

  const mentionQuery = useMemo(() => getTrailingMentionQuery(text), [text]);

  const startReply = useCallback((message: ChatMessage) => {
    if (composerBusyRef.current) return;
    if (composerMode?.type === 'edit') {
      setText(draftBeforeEditRef.current);
      draftBeforeEditRef.current = '';
    }
    setComposerMode({ type: 'reply', message });
  }, [composerMode?.type, setComposerMode, setText]);

  const startEdit = useCallback((message: ChatMessage) => {
    if (composerBusyRef.current) return;
    if (offlineMode) {
      showNativeToast('Нет сети', 'Редактирование сообщения на сервере недоступно офлайн. Локальный черновик можно продолжить.');
      return;
    }
    if (composerMode?.type !== 'edit') draftBeforeEditRef.current = text;
    setComposerMode({ type: 'edit', message });
    setText(message.body_text || '');
  }, [composerMode?.type, offlineMode, setComposerMode, setText, text]);

  const cancelComposerMode = useCallback(() => {
    if (composerBusyRef.current) return;
    if (composerMode?.type === 'edit') {
      setText(draftBeforeEditRef.current);
      draftBeforeEditRef.current = '';
    }
    setComposerMode(null);
  }, [composerMode?.type, setComposerMode, setText]);

  const handleVoiceRecordingChange = useCallback((recording: boolean) => {
    setVoiceRecording(recording);
  }, []);

  return {
    draftHydrated,
    draftError,
    setDraftError,
    text,
    setText,
    setTextState,
    textRevisionRef,
    draftBeforeEditRef,
    composerMode,
    setComposerMode,
    pendingComposerSendRef,
    attachmentDraftSendRef,
    composerBusy,
    composerBusyRef,
    setComposerBusy,
    attachmentPickerVisible,
    setAttachmentPickerVisible,
    attachmentDraftFiles,
    setAttachmentDraftFiles,
    attachmentDraftError,
    setAttachmentDraftError,
    imageEditorFile,
    setImageEditorFile,
    voiceRecording,
    cancelVoiceRef,
    typingIdleRef,
    typingActiveRef,
    stopOutgoingTyping,
    handleComposerText,
    mentionQuery,
    startReply,
    startEdit,
    cancelComposerMode,
    handleVoiceRecordingChange,
  };
}
