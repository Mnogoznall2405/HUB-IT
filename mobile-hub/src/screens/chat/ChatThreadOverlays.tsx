import React from 'react';
import type { ChatAttachment, ChatConversationSummary, ChatMessage } from '../../api/types';
import type { ChatMenuAnchor } from '../../chat/chatMessageMenuLayout';
import { isAiConversation, resolveAiBotForConversation } from '../../chat/chatAiWorkspace';
import { mediaItemFromConversationAttachment, type ChatMediaItem } from '../../chat/chatMedia';
import { resolveChatMessageIsOwn } from '../../chat/chatState';
import { getNativeChatQueueState } from '../../chat/nativeChatOutbox';
import { MessageActionsSheet } from '../../components/chat/MessageActionsSheet';
import { ChatAttachmentActionsSheet } from '../../components/chat/ChatAttachmentActionsSheet';
import { ChatAttachmentPanel } from '../../components/chat/ChatAttachmentPanel';
import { ChatPollCreateSheet } from '../../components/chat/ChatPollCreateSheet';
import { ChatAttachmentDraftSheet } from '../../components/chat/ChatAttachmentDraftSheet';
import { ForwardMessageSheet } from '../../components/chat/ForwardMessageSheet';
import { ChatMediaViewer } from '../../components/chat/ChatMediaViewer';
import { ChatConversationInfoSheet } from '../../components/chat/ChatConversationInfoSheet';
import { ChatParticipantProfileSheet } from '../../components/chat/ChatParticipantProfileSheet';
import { ChatMemberPickerSheet, ChatRenameSheet } from '../../components/chat/ChatGroupEditSheets';
import { ChatTaskShareSheet } from '../../components/chat/ChatTaskShareSheet';
import { ChatStickerPickerSheet } from '../../components/chat/ChatStickerPickerSheet';
import { ChatEmojiPickerSheet } from '../../components/chat/ChatEmojiPickerSheet';
import { ChatImageEditorSheet } from '../../components/chat/ChatImageEditorSheet';
import type { ChatAiBot } from '../../api/types';
import type { useThreadSheets } from './useThreadSheets';
import type { useThreadComposerState } from './useThreadComposerState';
import type { useThreadForward } from './useThreadForward';
import type { useThreadAttachments } from './useThreadAttachments';
import type { useThreadMessageActions } from './useThreadMessageActions';
import type { useThreadSend } from './useThreadSend';
import type { useThreadSelection } from './useThreadSelection';
import type { NativePickedFile } from '../../files/nativeFilePicker';

type Sheets = ReturnType<typeof useThreadSheets>;
type Composer = ReturnType<typeof useThreadComposerState>;
type Forward = ReturnType<typeof useThreadForward>;
type Attachments = ReturnType<typeof useThreadAttachments>;
type MessageActions = ReturnType<typeof useThreadMessageActions>;
type Send = ReturnType<typeof useThreadSend>;
type Selection = ReturnType<typeof useThreadSelection>;

/** All thread overlay sheets rendered above the message list — pure view that
 * binds the extracted hook results to the existing sheet components. */
export function ChatThreadOverlays({
  conversationId,
  conversation,
  title,
  userId,
  aiBots,
  actionMessage,
  actionAnchor,
  setActionMessage,
  setActionAnchor,
  pinnedMessageId,
  viewerMediaItems,
  renderBubble,
  isCurrentSendScope,
  sheets,
  composer,
  forward,
  attachments,
  messageActions,
  send,
  selection,
}: {
  conversationId: string;
  conversation: ChatConversationSummary | null;
  title: string;
  userId?: number;
  aiBots: ChatAiBot[];
  actionMessage: ChatMessage | null;
  actionAnchor: ChatMenuAnchor | null;
  setActionMessage: React.Dispatch<React.SetStateAction<ChatMessage | null>>;
  setActionAnchor: React.Dispatch<React.SetStateAction<ChatMenuAnchor | null>>;
  pinnedMessageId: string | null;
  viewerMediaItems: ChatMediaItem[];
  renderBubble?: (message: ChatMessage) => React.ReactNode;
  isCurrentSendScope: () => boolean;
  sheets: Sheets;
  composer: Composer;
  forward: Forward;
  attachments: Attachments;
  messageActions: MessageActions;
  send: Send;
  selection: Selection;
}) {
  const {
    infoVisible,
    setInfoVisible,
    profileMember,
    setProfileMember,
    conversationBusy,
    renameVisible,
    setRenameVisible,
    memberPickerVisible,
    setMemberPickerVisible,
    chatUsers,
    taskPickerVisible,
    setTaskPickerVisible,
    shareableTasks,
    taskPickerLoading,
    stickerPickerVisible,
    setStickerPickerVisible,
    stickerPacks,
    stickerPickerLoading,
    stickerImporting,
    recentStickerIds,
    emojiPickerVisible,
    setEmojiPickerVisible,
    pollCreateVisible,
    setPollCreateVisible,
    updateConversationSetting,
    renameGroup,
    resetAiContext,
    deleteAiConversation,
    openMemberPicker,
    addMembers,
    openPersonProfile,
    openMemberActions,
    requestLeaveGroup,
    loadShareableTasks,
    openTaskPicker,
    shareTask,
    openStickerPicker,
    importStickerPack,
    removeStickerPack,
    sendSticker,
  } = sheets;
  const {
    text,
    setText,
    composerBusy,
    setComposerBusy,
    attachmentPickerVisible,
    setAttachmentPickerVisible,
    attachmentDraftFiles,
    setAttachmentDraftFiles,
    attachmentDraftError,
    setAttachmentDraftError,
    imageEditorFile,
    setImageEditorFile,
    startReply,
    startEdit,
  } = composer;
  const {
    forwardSource,
    forwardQueue,
    forwardConversations,
    forwarding,
    forwardProgress,
    forwardError,
    forwardInFlightRef,
    openForward,
    forwardToConversation,
    setForwardSource,
    setForwardQueue,
    setForwardProgress,
    setForwardError,
  } = forward;
  const {
    mediaViewer,
    setMediaViewer,
    attachmentActionTarget,
    setAttachmentActionTarget,
    runAttachmentAction,
    loadMoreMediaManifest,
    openMediaViewer,
    closeMediaViewer,
  } = attachments;
  const {
    copyMessageText,
    copyMessageLink,
    prepareReport,
    showMessageReads,
    togglePinnedMessage,
  } = messageActions;
  const {
    toggleReaction,
    requestDelete,
    discardPendingMessage,
    retryPendingMessage,
    pickAndSendAttachment,
    sendAttachmentDraft,
    sendLocation,
    sendContact,
    sendPoll,
    sendGif,
    sendPickedFiles,
    attachmentDraftClientMessageIdRef,
  } = send;
  const { openTask } = sheets;
  const { startSelection } = selection;

  return (
    <>
      <MessageActionsSheet
        message={actionMessage}
        isOwn={Boolean(actionMessage && resolveChatMessageIsOwn(actionMessage, userId))}
        anchor={actionAnchor}
        onClose={() => {
          setActionMessage(null);
          setActionAnchor(null);
        }}
        onReply={startReply}
        onEdit={startEdit}
        onDelete={requestDelete}
        onForward={(message) => void openForward(message)}
        onReaction={(message, emoji) => void toggleReaction(message, emoji)}
        onCopyText={copyMessageText}
        onCopyLink={copyMessageLink}
        onPin={togglePinnedMessage}
        onReads={(message) => void showMessageReads(message)}
        onOpenTask={(message) => {
          if (message.task_preview?.id) openTask(message.task_preview.id);
        }}
        onReport={prepareReport}
        onSelect={startSelection}
        onRetry={actionMessage
          && (actionMessage.local_status === 'failed' || actionMessage.local_status === 'cancelled')
          && !['queued', 'retry'].includes(getNativeChatQueueState(actionMessage) || '')
          ? retryPendingMessage
          : undefined}
        onDiscardPending={actionMessage?.local_status ? discardPendingMessage : undefined}
        pinnedMessageId={pinnedMessageId}
        renderBubble={renderBubble}
      />
      <ChatAttachmentActionsSheet
        attachment={attachmentActionTarget?.attachment || null}
        onClose={() => setAttachmentActionTarget(null)}
        onOpen={() => {
          if (!attachmentActionTarget) return;
          void runAttachmentAction(
            attachmentActionTarget.message.id,
            attachmentActionTarget.attachment,
            'open',
          );
        }}
        onShare={() => {
          if (!attachmentActionTarget) return;
          void runAttachmentAction(
            attachmentActionTarget.message.id,
            attachmentActionTarget.attachment,
            'share',
          );
        }}
        onForward={() => {
          if (!attachmentActionTarget) return;
          void openForward(attachmentActionTarget.message);
        }}
        onSave={() => {
          if (!attachmentActionTarget) return;
          void runAttachmentAction(
            attachmentActionTarget.message.id,
            attachmentActionTarget.attachment,
            'save',
          );
        }}
      />
      {/* T8: Telegram-style attachment panel — inline above the composer with
          the media grid, multiselect, caption and the action row. */}
      <ChatAttachmentPanel
        visible={attachmentPickerVisible}
        onClose={() => setAttachmentPickerVisible(false)}
        onSendFiles={(files, caption) => {
          setAttachmentPickerVisible(false);
          void sendPickedFiles(files, { body: caption });
        }}
        onOpenCamera={() => void pickAndSendAttachment('camera')}
        onOpenGallery={() => void pickAndSendAttachment('gallery')}
        onOpenDocument={() => void pickAndSendAttachment('document')}
        onOpenTask={openTaskPicker}
        onOpenStickers={() => void openStickerPicker()}
        onSendLocation={() => {
          setAttachmentPickerVisible(false);
          void sendLocation();
        }}
        onSendContact={() => {
          setAttachmentPickerVisible(false);
          void sendContact();
        }}
        onOpenPoll={() => {
          setAttachmentPickerVisible(false);
          setEmojiPickerVisible(false);
          setStickerPickerVisible(false);
          setTaskPickerVisible(false);
          setPollCreateVisible(true);
        }}
      />
      <ChatPollCreateSheet
        visible={pollCreateVisible}
        onClose={() => setPollCreateVisible(false)}
        onCreate={(question, options, anonymous) => {
          setPollCreateVisible(false);
          void sendPoll(question, options, anonymous);
        }}
      />
      <ChatAttachmentDraftSheet
        visible={attachmentDraftFiles.length > 0 && !imageEditorFile}
        files={attachmentDraftFiles}
        caption={text}
        busy={composerBusy}
        error={attachmentDraftError}
        onChangeCaption={setText}
        onEdit={(index) => {
          const file = attachmentDraftFiles[index];
          if (file?.mimeType.startsWith('image/') && !composerBusy) setImageEditorFile(file);
        }}
        onRemove={(index) => {
          setAttachmentDraftFiles((current) => {
            const next = current.filter((_, itemIndex) => itemIndex !== index);
            if (!next.length) {
              attachmentDraftClientMessageIdRef.current = '';
              setAttachmentDraftError('');
            }
            return next;
          });
        }}
        onCancel={() => {
          attachmentDraftClientMessageIdRef.current = '';
          setAttachmentDraftFiles([]);
          setAttachmentDraftError('');
        }}
        onSend={() => void sendAttachmentDraft()}
      />
      <ForwardMessageSheet
        message={forwardSource}
        count={forwardQueue.length || (forwardSource ? 1 : 0)}
        conversations={forwardProgress ? [forwardProgress.target] : forwardConversations}
        status={forwardProgress ? `Подтверждено: ${forwardProgress.completed} из ${forwardProgress.total}. Осталось: ${forwardProgress.total - forwardProgress.completed}.` : ''}
        error={forwardError}
        busy={forwarding}
        onClose={() => {
          if (forwardInFlightRef.current) return;
          setForwardProgress(null);
          setForwardError('');
          setForwardSource(null);
          setForwardQueue([]);
        }}
        onForward={(target) => void forwardToConversation(target)}
      />
      <ChatMediaViewer
        item={mediaViewer}
        items={viewerMediaItems}
        onChange={setMediaViewer}
        onClose={closeMediaViewer}
        onRequestMore={() => void loadMoreMediaManifest()}
        onOpen={() => {
          if (!mediaViewer) return;
          void runAttachmentAction(mediaViewer.message.id, mediaViewer.attachment, 'open');
        }}
        onShare={() => {
          if (!mediaViewer) return;
          void runAttachmentAction(mediaViewer.message.id, mediaViewer.attachment, 'share');
        }}
        onSave={() => {
          if (!mediaViewer) return;
          void runAttachmentAction(mediaViewer.message.id, mediaViewer.attachment, 'save');
        }}
        onForward={() => {
          if (!mediaViewer) return;
          const message = mediaViewer.message;
          closeMediaViewer();
          void openForward(message);
        }}
      />
      <ChatConversationInfoSheet
        visible={infoVisible}
        conversation={conversation}
        currentUserId={userId}
        busy={conversationBusy}
        onClose={() => setInfoVisible(false)}
        onToggleSetting={(key, value) => void updateConversationSetting(key, value)}
        onRename={() => {
          setInfoVisible(false);
          setRenameVisible(true);
        }}
        onResetAiContext={isAiConversation(conversation) ? resetAiContext : undefined}
        onDeleteAi={isAiConversation(conversation) ? deleteAiConversation : undefined}
        aiBot={resolveAiBotForConversation(aiBots, conversation?.id)}
        onAddMembers={() => {
          setInfoVisible(false);
          void openMemberPicker();
        }}
        onMemberPress={(member) => openPersonProfile(member.user)}
        onMemberManage={openMemberActions}
        onLeave={requestLeaveGroup}
        onOpenAttachment={(attachment, galleryItems) => {
          const nextItems = (galleryItems.length ? galleryItems : [attachment])
            .map((item) => mediaItemFromConversationAttachment(item, conversationId));
          setInfoVisible(false);
          openMediaViewer(mediaItemFromConversationAttachment(attachment, conversationId), nextItems);
        }}
      />
      <ChatParticipantProfileSheet
        visible={Boolean(profileMember)}
        member={profileMember}
        isGroup={conversation?.kind === 'group' || conversation?.kind === 'task'}
        onClose={() => setProfileMember(null)}
      />
      <ChatRenameSheet
        visible={renameVisible}
        initialTitle={conversation?.title || title}
        busy={conversationBusy}
        heading={isAiConversation(conversation) ? 'Название диалога' : 'Название группы'}
        inputLabel={isAiConversation(conversation) ? 'Новое название диалога' : 'Новое название группы'}
        onClose={() => setRenameVisible(false)}
        onSave={(nextTitle) => void renameGroup(nextTitle)}
      />
      <ChatMemberPickerSheet
        visible={memberPickerVisible}
        users={chatUsers}
        excludedUserIds={(conversation?.members || []).map((member) => member.user.id)}
        busy={conversationBusy}
        onClose={() => setMemberPickerVisible(false)}
        onAdd={(userIds) => void addMembers(userIds)}
      />
      <ChatTaskShareSheet
        visible={taskPickerVisible}
        tasks={shareableTasks}
        loading={taskPickerLoading}
        onClose={() => setTaskPickerVisible(false)}
        onSearch={(query) => void loadShareableTasks(query)}
        onShare={(task) => void shareTask(task)}
      />
      <ChatStickerPickerSheet
        visible={stickerPickerVisible}
        packs={stickerPacks}
        recentIds={recentStickerIds}
        loading={stickerPickerLoading}
        importing={stickerImporting}
        onClose={() => setStickerPickerVisible(false)}
        onSend={(sticker) => void sendSticker(sticker)}
        onImport={(source) => void importStickerPack(source)}
        onRemove={removeStickerPack}
      />
      <ChatEmojiPickerSheet
        visible={emojiPickerVisible}
        onClose={() => setEmojiPickerVisible(false)}
        onSelect={(emoji) => {
          setText((current) => `${current}${emoji}`);
          setEmojiPickerVisible(false);
        }}
        onSelectGif={(gif) => void sendGif(gif)}
        onOpenStickers={() => void openStickerPicker()}
      />
      <ChatImageEditorSheet
        file={imageEditorFile}
        busy={composerBusy}
        caption={text}
        onChangeCaption={setText}
        confirmLabel={attachmentDraftFiles.some((file) => file === imageEditorFile) ? 'Сохранить фото' : 'Отправить фото'}
        onCancel={() => setImageEditorFile(null)}
        onConfirm={async (file: NativePickedFile) => {
          if (!isCurrentSendScope()) return;
          if (attachmentDraftFiles.some((item) => item === imageEditorFile)) {
            setAttachmentDraftFiles((files) => files.map((item) => item === imageEditorFile ? file : item));
            setImageEditorFile(null);
            return;
          }
          setComposerBusy(true);
          try {
            if (await sendPickedFiles([file])) setImageEditorFile(null);
          } finally {
            if (isCurrentSendScope()) setComposerBusy(false);
          }
        }}
      />
    </>
  );
}
