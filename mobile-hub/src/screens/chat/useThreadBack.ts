import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { Keyboard } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as chatApi from '../../api/chatApi';
import type { ChatMessage } from '../../api/types';
import { findLatestIncomingMessage } from '../../chat/chatState';
import { notifyNativeChatConversationRead } from '../../chat/chatActiveConversation';
import { nextChatThreadBackAction } from '../../chat/chatGestures';
import { useAndroidBackHandler } from '../../chat/useAndroidBackHandler';
import type { useThreadSheets } from './useThreadSheets';
import type { useThreadComposerState } from './useThreadComposerState';
import type { useThreadForward } from './useThreadForward';
import type { useThreadSelection } from './useThreadSelection';
import type { useThreadSearch } from './useThreadSearch';
import type { useThreadAttachments } from './useThreadAttachments';

type Sheets = ReturnType<typeof useThreadSheets>;
type Composer = ReturnType<typeof useThreadComposerState>;
type Forward = ReturnType<typeof useThreadForward>;
type Selection = ReturnType<typeof useThreadSelection>;
type Search = ReturnType<typeof useThreadSearch>;
type Attachments = ReturnType<typeof useThreadAttachments>;

/** Back/layer dispatcher: closes the topmost overlay in priority order or
 * leaves the thread via the unsaved-draft guard. */
export function useThreadBack({
  conversationId,
  userId,
  offlineMode,
  mountedRef,
  leaveInFlightRef,
  requestLeave,
  messagesRef,
  actionMessage,
  setActionMessage,
  voiceRecording,
  attachmentDraftClientMessageIdRef,
  sheets,
  composer,
  forward,
  selection,
  search,
  attachments,
}: {
  conversationId: string;
  userId?: number;
  offlineMode: boolean;
  mountedRef: MutableRefObject<boolean>;
  leaveInFlightRef: MutableRefObject<boolean>;
  requestLeave: (onAllowed: () => void) => void;
  messagesRef: MutableRefObject<ChatMessage[]>;
  actionMessage: ChatMessage | null;
  setActionMessage: Dispatch<SetStateAction<ChatMessage | null>>;
  voiceRecording: boolean;
  attachmentDraftClientMessageIdRef: MutableRefObject<string>;
  sheets: Sheets;
  composer: Composer;
  forward: Forward;
  selection: Selection;
  search: Search;
  attachments: Attachments;
}) {
  const {
    attachmentActionTarget,
    setAttachmentActionTarget,
    mediaViewer,
    closeMediaViewer,
  } = attachments;
  const {
    profileMember,
    setProfileMember,
    infoVisible,
    setInfoVisible,
    renameVisible,
    setRenameVisible,
    memberPickerVisible,
    setMemberPickerVisible,
    taskPickerVisible,
    setTaskPickerVisible,
    stickerPickerVisible,
    setStickerPickerVisible,
    emojiPickerVisible,
    setEmojiPickerVisible,
    pollCreateVisible,
    setPollCreateVisible,
  } = sheets;
  const {
    attachmentDraftFiles,
    setAttachmentDraftFiles,
    setAttachmentDraftError,
    attachmentPickerVisible,
    setAttachmentPickerVisible,
    imageEditorFile,
    setImageEditorFile,
    cancelVoiceRef,
  } = composer;
  const {
    forwardSource,
    setForwardSource,
    forwardInFlightRef,
    setForwardProgress,
    setForwardError,
    setForwardQueue,
  } = forward;
  const { selectedMessageIds, clearSelection } = selection;
  const { searchOpen, setSearchOpen, setSearchResults, setSearchCompleted } = search;
  const { workspace } = useLocalSearchParams<{ workspace?: string | string[] }>();
  const workspaceParam = Array.isArray(workspace) ? workspace[0] : workspace;
  const backWorkspace = workspaceParam === 'ai' || workspaceParam === 'chats' ? workspaceParam : '';

  const leaveThread = useCallback(() => {
    if (leaveInFlightRef.current) return;
    requestLeave(() => {
      if (leaveInFlightRef.current || !mountedRef.current) return;
      leaveInFlightRef.current = true;
      const latest = findLatestIncomingMessage(messagesRef.current, userId);
      notifyNativeChatConversationRead(conversationId);
      Keyboard.dismiss();
      if (backWorkspace) {
        const inbox = `/(shell)/chat?workspace=${backWorkspace}`;
        // navigate pops to the inbox already in the stack and refreshes its params.
        if (router.canGoBack?.()) router.navigate(inbox as never);
        else router.replace(inbox as never);
      } else if (router.canGoBack?.()) router.back();
      else router.replace('/(shell)/chat');
      if (!offlineMode && latest?.id) {
        void chatApi.markConversationRead(conversationId, latest.id).catch(() => undefined);
      }
    });
  }, [backWorkspace, conversationId, offlineMode, requestLeave, userId]);

  const closeThreadLayer = useCallback((layer: ReturnType<typeof nextChatThreadBackAction>) => {
    if (layer === 'viewer') {
      closeMediaViewer();
      return;
    }
    if (layer === 'voice') {
      cancelVoiceRef.current?.();
      return;
    }
    if (layer === 'sheet') {
      if (attachmentActionTarget) {
        setAttachmentActionTarget(null);
        return;
      }
      setActionMessage(null);
      return;
    }
    if (layer === 'forward') {
      if (forwardInFlightRef.current) return;
      setForwardProgress(null);
      setForwardError('');
      setForwardSource(null);
      setForwardQueue([]);
      return;
    }
    if (layer === 'search') {
      setSearchOpen(false);
      setSearchResults([]);
      setSearchCompleted(false);
      return;
    }
    if (layer === 'selection') {
      clearSelection();
      return;
    }
    if (layer === 'picker') {
      if (attachmentDraftFiles.length) {
        attachmentDraftClientMessageIdRef.current = '';
        setAttachmentDraftFiles([]);
        setAttachmentDraftError('');
        return;
      }
      if (profileMember) {
        setProfileMember(null);
        return;
      }
      setAttachmentPickerVisible(false);
      setEmojiPickerVisible(false);
      setInfoVisible(false);
      setRenameVisible(false);
      setMemberPickerVisible(false);
      setTaskPickerVisible(false);
      setStickerPickerVisible(false);
      setPollCreateVisible(false);
      setImageEditorFile(null);
      return;
    }
    leaveThread();
  }, [attachmentActionTarget, attachmentDraftClientMessageIdRef, attachmentDraftFiles.length,
    clearSelection, closeMediaViewer, leaveThread, profileMember]);

  const handleThreadBack = useCallback(() => {
    const pickerOpen = attachmentPickerVisible
      || attachmentDraftFiles.length > 0
      || emojiPickerVisible
      || infoVisible
      || renameVisible
      || memberPickerVisible
      || taskPickerVisible
      || stickerPickerVisible
      || pollCreateVisible
      || Boolean(imageEditorFile)
      || Boolean(profileMember);
    const action = nextChatThreadBackAction({
      viewer: Boolean(mediaViewer),
      voice: voiceRecording,
      sheet: Boolean(actionMessage || attachmentActionTarget),
      forward: Boolean(forwardSource),
      search: searchOpen,
      selection: selectedMessageIds.length > 0,
      picker: pickerOpen,
    });
    closeThreadLayer(action);
    return true;
  }, [
    actionMessage,
    attachmentActionTarget,
    attachmentPickerVisible,
    attachmentDraftFiles.length,
    closeThreadLayer,
    emojiPickerVisible,
    forwardSource,
    infoVisible,
    mediaViewer,
    memberPickerVisible,
    renameVisible,
    searchOpen,
    selectedMessageIds.length,
    imageEditorFile,
    stickerPickerVisible,
    pollCreateVisible,
    taskPickerVisible,
    profileMember,
    voiceRecording,
  ]);

  useAndroidBackHandler(handleThreadBack);

  return { leaveThread, closeThreadLayer, handleThreadBack };
}
