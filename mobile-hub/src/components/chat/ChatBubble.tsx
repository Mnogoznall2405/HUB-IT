import React, { memo, useMemo, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { ChatAttachment, ChatMessage, ChatUserSummary } from '../../api/types';
import { ChatDeliveryStatus } from './ChatDeliveryStatus';
import { ChatReactionButton } from './ChatReactionButton';
import { ChatBubblePhoto } from './ChatBubblePhoto';
import {
  ChatDocumentAttachment,
  type ChatAttachmentTransfer,
} from './ChatDocumentAttachment';
import { ChatLinkPreviewCard } from './ChatLinkPreviewCard';
import { ChatStickerImage } from './ChatStickerImage';
import {
  CHAT_SENDER_AVATAR_SIZE,
  CHAT_STICKER_SIZE,
  buildChatMetaPlainText,
  estimateChatMetaWidth,
  isPhotoChatAttachment,
  isStickerOnlyMessage,
  resolveChatBubbleMetaMode,
  CHAT_PHOTO_DEFAULT_ASPECT,
  resolveChatPhotoWidth,
  shouldBleedBubbleMedia,
  shouldShowSenderAvatar,
  type ChatBubbleGroupPosition,
} from '../../chat/chatBubbleLayout';
import { shouldRenderChatMarkdown, stripChatMarkdownPreview } from '../../chat/chatMarkdown';
import { pickChatAttachmentPreviewUrl } from '../../chat/chatMedia';
import { extractFirstChatUrl } from '../../chat/chatLinkPreview';
import { isStickerChatAttachment, stickerFromChatAttachment } from '../../chat/chatStickers';
import {
  CHAT_BUBBLE_LONG_PRESS_MS,
  DEFAULT_CHAT_QUICK_REACTION,
  isAudioChatAttachment,
  resolveChatBubbleTapAction,
} from '../../chat/chatVoice';
import { type ChatTokens, useChatTokens } from '../../theme/chatTokens';
import { resolveAttachmentUrl } from '../../utils/attachmentUrl';
import { ChatMarkdownBody } from './ChatMarkdownBody';
import { ChatVoiceNote } from './ChatVoiceNote';
import { PresenceAvatar } from './PresenceAvatar';

export function buildChatMessageAccessibilityLabel(
  message: ChatMessage,
  isOwn: boolean,
  options: { awaitingConnection?: boolean } = {},
): string {
  const senderName = message.sender?.full_name || message.sender?.username;
  const attachments = message.is_deleted ? [] : message.attachments || [];
  const voiceAttachment = attachments.find((attachment) => isAudioChatAttachment(attachment));
  const attachmentsCount = voiceAttachment ? 0 : attachments.length;
  const createdAt = message.created_at ? new Date(message.created_at) : null;
  const time = createdAt && Number.isFinite(createdAt.getTime())
    ? createdAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : '';
  const delivery = message.local_status === 'sending'
    ? 'Отправляется'
    : message.local_status === 'failed'
      ? (options.awaitingConnection ? 'Ожидает подключения' : 'Не отправлено')
      : message.local_status === 'cancelled'
        ? 'Отправка отменена'
      : isOwn
        ? message.delivery_status === 'read' ? 'Прочитано' : 'Доставлено'
        : null;

  return [
    message.kind === 'system'
      ? 'Системное сообщение'
      : isOwn
        ? 'Ваше сообщение'
        : senderName ? `Сообщение от ${senderName}` : 'Сообщение от участника',
    message.is_deleted ? 'Сообщение удалено' : message.body_text,
    voiceAttachment ? 'Голосовое сообщение' : attachmentsCount ? `Вложений: ${attachmentsCount}` : null,
    time ? `Время ${time}` : null,
    message.edited_at && !message.is_deleted ? 'Изменено' : null,
    delivery,
  ]
    .filter(Boolean)
    .join('. ');
}

export const ChatBubble = memo(function ChatBubble({
  message,
  isOwn,
  selected = false,
  highlighted = false,
  onPress,
  onLongPress,
  onActionsPress,
  onActionsAnchor,
  onAttachmentPress,
  onAttachmentOpen,
  attachmentTransfer,
  attachmentTransfers,
  onAttachmentTransferCancel,
  onAttachmentTransferRetry,
  onReactionPress,
  onQuickReaction,
  onReplyPreviewPress,
  onTaskPress,
  onConfirmAction,
  onCancelAction,
  onRetry,
  onDiscard,
  onSenderPress,
  groupPosition = 'single',
  showSenderAvatars = false,
  awaitingConnection = false,
}: {
  message: ChatMessage;
  isOwn: boolean;
  selected?: boolean;
  highlighted?: boolean;
  showSenderAvatars?: boolean;
  awaitingConnection?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  onActionsPress?: () => void;
  onActionsAnchor?: (anchor: { x: number; y: number; width: number; height: number }) => void;
  onSenderPress?: (sender: ChatUserSummary) => void;
  onAttachmentPress?: (attachment: ChatAttachment) => void;
  onAttachmentOpen?: (attachment: ChatAttachment) => void;
  attachmentTransfer?: ({ attachmentId: string } & ChatAttachmentTransfer) | null;
  attachmentTransfers?: Record<string, ChatAttachmentTransfer>;
  onAttachmentTransferCancel?: (attachment: ChatAttachment) => void;
  onAttachmentTransferRetry?: (attachment: ChatAttachment) => void;
  onReactionPress?: (emoji: string) => void;
  onQuickReaction?: (emoji: string) => void;
  onReplyPreviewPress?: (messageId: string) => void;
  onTaskPress?: (taskId: string) => void;
  onConfirmAction?: (actionId: string) => void;
  onCancelAction?: (actionId: string) => void;
  onRetry?: () => void;
  onDiscard?: () => void;
  groupPosition?: ChatBubbleGroupPosition;
}) {
  const chatTokens = useChatTokens();
  const styles = useMemo(() => createStyles(chatTokens), [chatTokens]);
  const { width: windowWidth } = useWindowDimensions();
  const reactions = message.reactions || [];
  const isDeleted = Boolean(message.is_deleted);
  const attachments = isDeleted ? [] : message.attachments || [];
  const accessibilityLabel = buildChatMessageAccessibilityLabel(message, isOwn, { awaitingConnection });
  const actionCard = message.action_card as {
    id?: string;
    status?: string;
    preview?: { title?: string; summary?: string; warnings?: string[]; effects?: string[] };
  } | null | undefined;

  const showSenderName = Boolean(
    !isOwn && message.sender && (groupPosition === 'single' || groupPosition === 'first'),
  );
  const stickerOnly = isStickerOnlyMessage(message);
  const photoAttachments = attachments.filter((attachment) => isPhotoChatAttachment(attachment));
  const hasDocumentAttachments = attachments.some((attachment) => (
    !isStickerChatAttachment(attachment)
    && !isAudioChatAttachment(attachment)
    && !isPhotoChatAttachment(attachment)
  ));
  const lastPhotoId = photoAttachments.length
    ? photoAttachments[photoAttachments.length - 1].id
    : null;
  const hasText = Boolean(message.body_text);
  const markdownBody = Boolean(message.body_text && !stickerOnly && shouldRenderChatMarkdown(message));
  const hasTrailingBlock = Boolean(
    actionCard?.id
    || message.local_status === 'failed'
    || markdownBody
    || hasDocumentAttachments
    || (!isDeleted && extractFirstChatUrl(message.body_text)),
  );
  const metaMode = resolveChatBubbleMetaMode({
    hasText,
    hasPhoto: photoAttachments.length > 0,
    isStickerOnly: stickerOnly,
    hasTrailingBlock,
  });
  const bleedMedia = shouldBleedBubbleMedia({
    hasText,
    hasPhoto: photoAttachments.length > 0,
    hasSenderName: showSenderName,
    hasQuote: Boolean(message.reply_preview),
    hasForwardNote: Boolean(message.forward_preview),
    hasTrailingBlock,
  });
  const photoWidth = resolveChatPhotoWidth(windowWidth);
  const photoMaxHeight = Math.round(photoWidth / CHAT_PHOTO_DEFAULT_ASPECT);
  const documentWidth = Math.round(Math.max(160, Math.min(280, windowWidth * 0.72)));
  const avatarVisible = shouldShowSenderAvatar({ isOwn, showSenderAvatars, groupPosition });
  const timeLabel = message.created_at
    ? new Date(message.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : '';
  const metaPlainText = buildChatMetaPlainText({
    timeLabel,
    sending: false,
    edited: Boolean(message.edited_at && !isDeleted),
    showTicks: isOwn,
    read: true,
  });
  const meta = (
    <BubbleMeta
      timeLabel={timeLabel}
      sending={message.local_status === 'sending'}
      failed={message.local_status === 'failed' || message.local_status === 'cancelled'}
      own={isOwn}
      edited={Boolean(message.edited_at && !isDeleted)}
      read={message.delivery_status === 'read'}
      tone={metaMode === 'overlay' ? 'overlay' : isOwn ? 'own' : 'other'}
    />
  );
  const overlayMeta = metaMode === 'overlay' ? (
    <View style={styles.metaPill} pointerEvents="none">{meta}</View>
  ) : null;

  const pressHandler = onPress || onActionsPress;
  const interactive = Boolean(pressHandler || onLongPress || onQuickReaction);
  const lastTapAtRef = useRef(0);
  const bubbleRef = useRef<View>(null);

  const handlePress = () => {
    const now = Date.now();
    const action = resolveChatBubbleTapAction({
      selected,
      hasQuickReaction: Boolean(onQuickReaction),
      previousTapAt: lastTapAtRef.current,
      now,
    });
    if (action === 'quick-reaction') {
      lastTapAtRef.current = 0;
      onQuickReaction?.(DEFAULT_CHAT_QUICK_REACTION);
      return;
    }
    lastTapAtRef.current = now;
    bubbleRef.current?.measureInWindow?.((x, y, width, height) => {
      if (width > 8 && height > 8) onActionsAnchor?.({ x, y, width, height });
    });
    pressHandler?.();
  };

  return (
    <View style={[
      styles.wrap,
      groupPosition === 'middle' || groupPosition === 'last' ? styles.wrapGrouped : null,
      isOwn ? styles.wrapOwn : styles.wrapOther,
    ]}>
      <View style={[styles.messageRow, isOwn && styles.messageRowOwn]}>
        {selected ? <View style={styles.selectedMark} accessibilityElementsHidden /> : null}
        {showSenderAvatars && !isOwn ? (
          <Pressable
            style={styles.avatarSlot}
            onPress={() => message.sender && onSenderPress?.(message.sender)}
            disabled={!avatarVisible || !message.sender || !onSenderPress}
            accessibilityRole={avatarVisible && onSenderPress ? 'button' : undefined}
            accessibilityLabel={avatarVisible && message.sender
              ? `Открыть профиль ${message.sender.full_name || message.sender.username}`
              : undefined}
          >
            {avatarVisible ? (
              <PresenceAvatar
                label={message.sender?.full_name || message.sender?.username || '?'}
                avatarUrl={message.sender?.avatar_url}
                size={CHAT_SENDER_AVATAR_SIZE}
              />
            ) : null}
          </Pressable>
        ) : null}
        <Pressable
          ref={bubbleRef}
          onPress={handlePress}
          onLongPress={onLongPress}
          delayLongPress={CHAT_BUBBLE_LONG_PRESS_MS}
          disabled={!interactive}
          style={({ pressed }) => [
              styles.bubble,
              stickerOnly ? styles.bubbleSticker : isOwn ? styles.own : styles.other,
              bleedMedia && styles.bubbleBleed,
              groupPosition !== 'single' && styles.groupedBubble,
              isOwn && groupPosition === 'first' && styles.groupFirstOwn,
              isOwn && groupPosition === 'middle' && styles.groupMiddleOwn,
              isOwn && groupPosition === 'last' && styles.groupLastOwn,
              !isOwn && groupPosition === 'first' && styles.groupFirstOther,
              !isOwn && groupPosition === 'middle' && styles.groupMiddleOther,
              !isOwn && groupPosition === 'last' && styles.groupLastOther,
              selected && styles.bubbleSelected,
              highlighted && styles.bubbleHighlighted,
              pressed && interactive ? styles.bubblePressed : null,
            ]}
          accessibilityRole={interactive ? 'button' : undefined}
          accessibilityState={selected ? { selected: true } : undefined}
          accessibilityLabel={highlighted ? `Результат поиска. ${accessibilityLabel}` : accessibilityLabel}
          accessibilityHint={onLongPress && !selected
            ? 'Удерживайте, чтобы выделить. Нажмите, чтобы открыть действия. Нажмите дважды для реакции'
            : selected
              ? 'Нажмите, чтобы снять выделение'
            : pressHandler
              ? 'Нажмите, чтобы открыть действия. Смахните вправо для ответа или влево для пересылки'
              : undefined}
        >
        {showSenderName ? (
          <Pressable
            onPress={(event) => {
              event.stopPropagation();
              if (message.sender) onSenderPress?.(message.sender);
            }}
            disabled={!onSenderPress || !message.sender}
            accessibilityRole={onSenderPress ? 'button' : undefined}
            accessibilityLabel={onSenderPress
              ? `Открыть профиль ${message.sender!.full_name || message.sender!.username}`
              : undefined}
          >
            <Text style={styles.senderName} numberOfLines={1}>
              {message.sender!.full_name || message.sender!.username}
            </Text>
          </Pressable>
        ) : null}
        {message.reply_preview ? (
          <Pressable
            style={styles.quote}
            onPress={(event) => {
              event.stopPropagation();
              onReplyPreviewPress?.(message.reply_preview!.id);
            }}
            disabled={!onReplyPreviewPress}
            accessibilityRole={onReplyPreviewPress ? 'button' : undefined}
            accessibilityLabel={`Перейти к исходному сообщению: ${message.reply_preview.body || 'Вложение'}`}
          >
            <Text style={styles.quoteSender} numberOfLines={1}>{message.reply_preview.sender_name}</Text>
            <Text style={styles.quoteBody} numberOfLines={2}>
              {stripChatMarkdownPreview(message.reply_preview.body) || message.reply_preview.body || 'Вложение'}
            </Text>
          </Pressable>
        ) : null}
        {message.forward_preview ? (
          <Text style={styles.forwarded} numberOfLines={1}>
            Переслано от {message.forward_preview.sender_name}
          </Text>
        ) : null}
        {message.kind === 'task_share' && message.task_preview ? (
          <Pressable
            style={styles.taskCard}
            onPress={(event) => {
              event.stopPropagation();
              onTaskPress?.(message.task_preview!.id);
            }}
            disabled={!onTaskPress}
            accessibilityRole={onTaskPress ? 'button' : undefined}
            accessibilityLabel={`Открыть задачу ${message.task_preview.title}`}
          >
            <Text style={styles.taskEyebrow}>ЗАДАЧА · {message.task_preview.status || 'новая'}</Text>
            <Text style={styles.taskTitle}>{message.task_preview.title}</Text>
            {message.task_preview.assignee_full_name ? (
              <Text style={styles.taskMeta}>Исполнитель: {message.task_preview.assignee_full_name}</Text>
            ) : null}
          </Pressable>
        ) : null}
        {message.body_text && !stickerOnly ? (
          markdownBody ? (
            <ChatMarkdownBody value={message.body_text} isOwn={isOwn} deleted={isDeleted} />
          ) : (
            <Text style={[styles.text, isOwn ? styles.textOwn : styles.textOther, isDeleted && styles.deletedText]}>
              {message.body_text}
              {metaMode === 'inline' ? (
                <View style={[styles.metaSpacer, { width: estimateChatMetaWidth(metaPlainText) }]} />
              ) : null}
            </Text>
          )
        ) : null}
        {!isDeleted && message.body_text && !stickerOnly ? (
          <ChatLinkPreviewCard text={message.body_text} isOwn={isOwn} />
        ) : null}
        {attachments.map((attachment, attachmentIndex) => {
          const resolvedTransfer = attachmentTransfers?.[attachment.id]
            || (attachmentTransfer?.attachmentId === attachment.id ? attachmentTransfer : null);
          if (isStickerChatAttachment(attachment)) {
            return (
              <Pressable
                key={attachmentIndex}
                onPress={(event) => {
                  event.stopPropagation();
                  onAttachmentPress?.(attachment);
                }}
                disabled={!onAttachmentPress}
                accessibilityRole={onAttachmentPress ? 'button' : undefined}
                accessibilityLabel={`Стикер ${attachment.file_name || ''}`.trim()}
              >
                <ChatStickerImage
                  sticker={stickerFromChatAttachment(attachment)}
                  size={CHAT_STICKER_SIZE}
                  autoPlay
                />
                {stickerOnly ? overlayMeta : null}
              </Pressable>
            );
          }
          if (isAudioChatAttachment(attachment)) {
            return (
              <ChatVoiceNote
                key={attachmentIndex}
                attachment={attachment}
                isOwn={isOwn}
              />
            );
          }
          const localPreviewUrl = attachment.id.startsWith('pending-attachment:')
            ? String(attachment.local_uri || '').trim()
            : '';
          const previewUrl = resolveAttachmentUrl(pickChatAttachmentPreviewUrl(attachment));
          const effectivePreviewUrl = localPreviewUrl || previewUrl;
          const isPhoto = Boolean(effectivePreviewUrl && isPhotoChatAttachment(attachment));
          if (!isPhoto) {
            return (
              <ChatDocumentAttachment
                key={attachmentIndex}
                attachment={attachment}
                width={documentWidth}
                transfer={resolvedTransfer}
                onOpen={onAttachmentOpen
                  ? () => onAttachmentOpen(attachment)
                  : onAttachmentPress ? () => onAttachmentPress(attachment) : undefined}
                onMore={onAttachmentPress ? () => onAttachmentPress(attachment) : undefined}
                onCancel={onAttachmentTransferCancel
                  ? () => onAttachmentTransferCancel(attachment)
                  : undefined}
                onRetry={onAttachmentTransferRetry
                  ? () => onAttachmentTransferRetry(attachment)
                  : undefined}
              />
            );
          }
          return (
            <Pressable
              key={attachmentIndex}
              onPress={(event) => {
                event.stopPropagation();
                onAttachmentPress?.(attachment);
              }}
              disabled={!onAttachmentPress || Boolean(message.local_status)}
              accessibilityRole={onAttachmentPress ? 'button' : undefined}
              accessibilityLabel={`Открыть фото ${attachment.file_name || ''}`.trim()}
              accessibilityHint="Открывает полноэкранный просмотр"
              style={styles.photoButton}
            >
              <ChatBubblePhoto
                uri={effectivePreviewUrl!}
                maxWidth={photoWidth}
                maxHeight={photoMaxHeight}
                radius={bleedMedia ? 14 : 10}
              >
                {attachment.id === lastPhotoId ? overlayMeta : null}
                {resolvedTransfer ? (
                  <AttachmentTransferOverlay
                    transfer={resolvedTransfer}
                    fileName={attachment.file_name || 'вложение'}
                    onCancel={onAttachmentTransferCancel
                      ? () => onAttachmentTransferCancel(attachment)
                      : undefined}
                    onRetry={onAttachmentTransferRetry
                      ? () => onAttachmentTransferRetry(attachment)
                      : undefined}
                  />
                ) : null}
              </ChatBubblePhoto>
            </Pressable>
          );
        })}
        {metaMode === 'row' ? (
          <View style={styles.metaRow}>{meta}</View>
        ) : null}
        {metaMode === 'inline' ? (
          <View style={[styles.metaFloat, bleedMedia && styles.metaFloatBleed]} pointerEvents="none">
            {meta}
          </View>
        ) : null}
        {(message.local_status === 'failed' || message.local_status === 'cancelled') && !attachments.length ? (
          <Pressable
            onPress={onRetry}
            disabled={!onRetry}
            style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
            accessibilityRole="button"
            accessibilityLabel="Повторить отправку сообщения"
          >
            <Text style={styles.retryText}>
              {message.local_status === 'cancelled'
                ? 'Отправка отменена · повторить'
                : awaitingConnection
                  ? 'Ожидает подключения'
                  : 'Не отправлено · повторить'}
            </Text>
          </Pressable>
        ) : null}
        {(message.local_status === 'failed' || message.local_status === 'cancelled') && onDiscard ? (
          <Pressable onPress={onDiscard} style={styles.retry} accessibilityRole="button" accessibilityLabel="Убрать сообщение из очереди">
            <Text style={styles.retryText}>Убрать из очереди</Text>
          </Pressable>
        ) : null}
        {actionCard?.id ? (
          <View style={styles.actionCard}>
            <Text style={styles.actionTitle}>{actionCard.preview?.title || 'Действие AI'}</Text>
            {actionCard.preview?.summary ? <Text style={styles.actionSummary}>{actionCard.preview.summary}</Text> : null}
            {actionCard.preview?.warnings?.map((warning) => (
              <Text key={warning} style={styles.actionWarning}>⚠ {warning}</Text>
            ))}
            {actionCard.status === 'pending' ? (
              <View style={styles.actionButtons}>
                <Pressable
                  onPress={(event) => {
                    event.stopPropagation();
                    onCancelAction?.(actionCard.id!);
                  }}
                  disabled={!onCancelAction}
                  style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Отмена"
                >
                  <Text style={styles.actionCancelText}>Отмена</Text>
                </Pressable>
                <Pressable
                  onPress={(event) => {
                    event.stopPropagation();
                    onConfirmAction?.(actionCard.id!);
                  }}
                  disabled={!onConfirmAction}
                  style={({ pressed }) => [styles.actionButton, styles.actionConfirm, pressed && styles.actionButtonPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Подтвердить"
                >
                  <Text style={styles.actionConfirmText}>Подтвердить</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={styles.actionStatus}>
                {actionCard.status === 'executing' ? 'Выполняется' : actionCard.status === 'completed' ? 'Выполнено' : actionCard.status || 'Обработано'}
              </Text>
            )}
          </View>
        ) : null}
        </Pressable>
      </View>
      {!isDeleted && reactions.length > 0 ? (
        <View style={styles.reactions}>
          {reactions.map((reaction) => (
            <ChatReactionButton
              key={reaction.emoji}
              onPress={onReactionPress ? () => onReactionPress(reaction.emoji) : undefined}
              style={[styles.reaction, reaction.reacted_by_me && styles.reactionOwn]}
              label={`${reaction.reacted_by_me ? 'Убрать' : 'Добавить'} реакцию ${reaction.emoji}`}
            >
              <Text style={styles.reactionText}>{reaction.emoji} {reaction.count}</Text>
            </ChatReactionButton>
          ))}
        </View>
      ) : null}
    </View>
  );
});

function AttachmentTransferOverlay({
  transfer,
  fileName,
  onCancel,
  onRetry,
}: {
  transfer: ChatAttachmentTransfer;
  fileName: string;
  onCancel?: () => void;
  onRetry?: () => void;
}) {
  const chatTokens = useChatTokens();
  const styles = useMemo(() => createStyles(chatTokens), [chatTokens]);
  const status = transfer.status || 'active';
  const progress = transfer.progress == null
    ? null
    : Math.round(Math.max(0, Math.min(1, transfer.progress)) * 100);
  const active = status === 'active';
  const action = active && transfer.cancellable && onCancel
    ? { label: `Отменить отправку ${fileName}`, mark: '×', onPress: onCancel }
    : !active && onRetry
      ? { label: `Повторить отправку ${fileName}`, mark: '↻', onPress: onRetry }
      : null;
  const stateLabel = active
    ? transfer.action === 'upload' ? 'Отправка' : 'Загрузка'
    : status === 'cancelled' ? 'Отменено' : 'Ошибка';

  return (
    <View style={styles.transferOverlay} pointerEvents="box-none">
      <Pressable
        onPress={(event) => {
          event.stopPropagation();
          action?.onPress();
        }}
        disabled={!action}
        style={({ pressed }) => [styles.transferControl, pressed && styles.transferControlPressed]}
        accessibilityRole={action ? 'button' : 'progressbar'}
        accessibilityLabel={action?.label || `${stateLabel}: ${fileName}`}
        accessibilityValue={active && progress != null
          ? { min: 0, max: 100, now: progress, text: `${progress} процентов` }
          : undefined}
      >
        <Text style={styles.transferMark}>{action?.mark || (progress == null ? '…' : `${progress}%`)}</Text>
      </Pressable>
      <Text style={styles.transferLabel}>{stateLabel}{active && progress != null ? ` ${progress}%` : ''}</Text>
    </View>
  );
}

function BubbleMeta({
  timeLabel,
  sending,
  failed,
  own,
  edited,
  read,
  tone,
}: {
  timeLabel: string;
  sending: boolean;
  failed: boolean;
  own: boolean;
  edited: boolean;
  read: boolean;
  tone: 'own' | 'other' | 'overlay';
}) {
  const chatTokens = useChatTokens();
  const styles = useMemo(() => createStyles(chatTokens), [chatTokens]);
  const toneStyle = tone === 'overlay'
    ? styles.metaOverlay
    : tone === 'own' ? styles.metaOwn : styles.metaOther;
  const spinnerColor = tone === 'overlay'
    ? '#ffffff'
    : tone === 'own' ? chatTokens.bubbleOwnMetaText : chatTokens.bubbleOtherMetaText;
  return (
    <>
      <Text style={[styles.meta, toneStyle]}>{timeLabel}</Text>
      {edited ? <Text style={[styles.meta, toneStyle]}> · изм.</Text> : null}
      {own ? <ChatDeliveryStatus status={sending ? 'sending' : failed ? 'failed' : read ? 'read' : 'sent'} color={spinnerColor} /> : null}
    </>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  wrap: { marginVertical: 4, maxWidth: '88%' },
  wrapGrouped: { marginTop: 1 },
  wrapOwn: { alignSelf: 'flex-end' },
  wrapOther: { alignSelf: 'flex-start' },
  selectedMark: {
    width: 18,
    height: 18,
    marginHorizontal: 6,
    marginBottom: 8,
    borderRadius: 9,
    backgroundColor: chatTokens.composerActionBg,
  },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end' },
  messageRowOwn: { flexDirection: 'row-reverse' },
  avatarSlot: {
    width: CHAT_SENDER_AVATAR_SIZE,
    marginRight: 6,
    justifyContent: 'flex-end',
  },
  bubble: {
    flexShrink: 1,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'transparent',
    paddingHorizontal: 10,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  bubbleBleed: { paddingHorizontal: 0, paddingVertical: 0 },
  bubbleSticker: { backgroundColor: 'transparent', paddingHorizontal: 0, paddingVertical: 0 },
  bubblePressed: { opacity: 0.88 },
  bubbleSelected: { backgroundColor: chatTokens.sidebarRowSoftActive },
  bubbleHighlighted: {
    borderColor: chatTokens.composerActionBg,
  },
  own: { backgroundColor: chatTokens.bubbleOwnBg },
  other: { backgroundColor: chatTokens.bubbleOtherBg },
  groupedBubble: { marginTop: 0 },
  groupFirstOwn: { borderBottomRightRadius: 5 },
  groupMiddleOwn: { borderTopRightRadius: 5, borderBottomRightRadius: 5 },
  groupLastOwn: { borderTopRightRadius: 5 },
  groupFirstOther: { borderBottomLeftRadius: 5 },
  groupMiddleOther: { borderTopLeftRadius: 5, borderBottomLeftRadius: 5 },
  groupLastOther: { borderTopLeftRadius: 5 },
  senderName: { color: chatTokens.accentText, fontSize: 13, fontWeight: '700', marginBottom: 3 },
  quote: {
    marginBottom: 6,
    paddingLeft: 8,
    borderLeftWidth: 3,
    borderLeftColor: chatTokens.composerActionBg,
  },
  quoteSender: { color: chatTokens.accentText, fontSize: 12, fontWeight: '700' },
  quoteBody: { marginTop: 1, color: chatTokens.textSecondary, fontSize: 12, lineHeight: 16 },
  forwarded: { marginBottom: 4, color: chatTokens.accentText, fontSize: 12, fontWeight: '600' },
  taskCard: {
    minWidth: 210,
    marginBottom: 5,
    padding: 10,
    borderRadius: 12,
    backgroundColor: chatTokens.sidebarRowSoftActive,
    borderLeftWidth: 3,
    borderLeftColor: chatTokens.composerActionBg,
  },
  taskEyebrow: { color: chatTokens.accentText, fontSize: 11, fontWeight: '800' },
  taskTitle: { marginTop: 3, color: chatTokens.textPrimary, fontSize: 15, fontWeight: '700' },
  taskMeta: { marginTop: 4, color: chatTokens.textSecondary, fontSize: 12 },
  actionCard: { minWidth: 220, marginTop: 7, padding: 11, borderRadius: 12, backgroundColor: chatTokens.sidebarSearchBg },
  actionTitle: { color: chatTokens.textPrimary, fontSize: 15, fontWeight: '700' },
  actionSummary: { marginTop: 4, color: chatTokens.textSecondary, fontSize: 13, lineHeight: 18 },
  actionWarning: { marginTop: 5, color: chatTokens.dangerText, fontSize: 12 },
  actionButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 10 },
  actionButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10 },
  actionConfirm: { backgroundColor: chatTokens.composerActionBg },
  actionCancelText: { color: chatTokens.accentText, fontSize: 13, fontWeight: '700' },
  actionConfirmText: { color: chatTokens.composerActionText, fontSize: 13, fontWeight: '700' },
  actionStatus: { marginTop: 8, color: chatTokens.accentText, fontSize: 12, fontWeight: '700' },
  actionButtonPressed: { opacity: 0.72 },
  text: { fontSize: 16, lineHeight: 22 },
  textOwn: { color: chatTokens.bubbleOwnText },
  textOther: { color: chatTokens.bubbleOtherText },
  deletedText: { fontStyle: 'italic', opacity: 0.72 },
  photoButton: { alignSelf: 'flex-start' },
  transferOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: 'rgba(0,0,0,0.34)',
  },
  transferControl: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.64)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.58)',
  },
  transferControlPressed: { transform: [{ scale: 0.96 }], opacity: 0.86 },
  transferMark: { color: '#fff', fontSize: 15, lineHeight: 20, fontWeight: '800' },
  transferLabel: { color: '#fff', fontSize: 12, lineHeight: 16, fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 4 },
  metaFloat: { position: 'absolute', right: 10, bottom: 7, flexDirection: 'row', alignItems: 'center' },
  metaFloatBleed: { right: 8, bottom: 6 },
  metaPill: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  metaSpacer: { height: 1 },
  meta: { fontSize: 11 },
  metaSpinner: { width: 13, height: 13, marginRight: 3, transform: [{ scale: 0.66 }] },
  metaOwn: { color: chatTokens.bubbleOwnMetaText },
  metaOther: { color: chatTokens.bubbleOtherMetaText },
  metaOverlay: { color: '#ffffff' },
  metaRead: { fontWeight: '700' },
  retry: { minHeight: 44, justifyContent: 'center', alignItems: 'flex-end' },
  retryPressed: { transform: [{ scale: 0.96 }], opacity: 0.85 },
  retryText: { color: '#b3261e', fontSize: 12, fontWeight: '700' },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  reaction: {
    backgroundColor: chatTokens.reactionBg,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  reactionOwn: {
    borderWidth: 1,
    borderColor: chatTokens.composerActionBg,
    backgroundColor: chatTokens.reactionSelectedBg,
  },
  reactionText: { fontSize: 12, color: chatTokens.textPrimary },
});
