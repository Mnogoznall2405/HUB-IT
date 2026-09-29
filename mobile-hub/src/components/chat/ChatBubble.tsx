import React, { memo, useMemo, useRef } from 'react';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { ChatAttachment, ChatMessage, ChatUserSummary } from '../../api/types';
import { ChatDeliveryStatus } from './ChatDeliveryStatus';
import { ChatReactionButton } from './ChatReactionButton';
import { ChatBubblePhoto } from './ChatBubblePhoto';
import { ChatAuthenticatedImage } from './ChatAuthenticatedImage';
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
  resolveChatPhotoMaxHeight,
  resolveChatPhotoWidth,
  shouldBleedBubbleMedia,
  shouldShowSenderAvatar,
  type ChatBubbleGroupPosition,
} from '../../chat/chatBubbleLayout';
import { shouldRenderChatMarkdown, stripChatMarkdownPreview } from '../../chat/chatMarkdown';
import { isVideoChatAttachment, pickChatAttachmentPreviewUrl } from '../../chat/chatMedia';
import { extractFirstChatUrl } from '../../chat/chatLinkPreview';
import { isStickerChatAttachment, stickerFromChatAttachment } from '../../chat/chatStickers';
import {
  buildGeoIntentUrl,
  parseContactBody,
  parseLocationBody,
  parsePollBody,
} from '../../chat/chatStructuredMessage';
import { useChatAttachmentTransfer } from '../../chat/nativeChatAttachmentTransfers';
import {
  CHAT_BUBBLE_LONG_PRESS_MS,
  DEFAULT_CHAT_QUICK_REACTION,
  isAudioChatAttachment,
  formatVoiceDuration,
  resolveChatBubbleTapAction,
} from '../../chat/chatVoice';
import { type ChatTokens, useChatTokens } from '../../theme/chatTokens';
import type { ChatMediaAlbum, ChatMediaAlbumEntry } from '../../chat/chatMediaAlbum';
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
    message.is_deleted
      ? 'Сообщение удалено'
      : message.kind === 'location'
        ? 'Геопозиция'
        : message.kind === 'contact'
          ? `Контакт ${parseContactBody(message.body_text || message.body)?.name || ''}`.trim()
          : message.kind === 'poll'
            ? `Опрос: ${message.poll?.question || parsePollBody(message.body_text || message.body)?.question || ''}`.trim()
            : message.body_text,
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
  onPollVote,
  onPollClose,
  onReactionLongPress,
  album,
  onAlbumAttachmentPress,
  onConfirmAction,
  onCancelAction,
  onSenderPress,
  groupPosition = 'single',
  showSenderAvatars = false,
  awaitingConnection = false,
  offline = false,
}: {
  message: ChatMessage;
  isOwn: boolean;
  selected?: boolean;
  highlighted?: boolean;
  showSenderAvatars?: boolean;
  awaitingConnection?: boolean;
  offline?: boolean;
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
  onPollVote?: (optionIndex: number) => void;
  onPollClose?: () => void;
  /** F-REACTORS: long-press a reaction chip → "who reacted" list. */
  onReactionLongPress?: (emoji: string, userIds: number[]) => void;
  /** DEV-MEDIA-1: photo album rendered as one grid instead of N bubbles. */
  album?: ChatMediaAlbum;
  onAlbumAttachmentPress?: (entry: ChatMediaAlbumEntry) => void;
  onConfirmAction?: (actionId: string) => void;
  onCancelAction?: (actionId: string) => void;
  groupPosition?: ChatBubbleGroupPosition;
}) {
  const chatTokens = useChatTokens();
  const styles = useMemo(() => createStyles(chatTokens), [chatTokens]);
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const reactions = message.reactions || [];
  const isDeleted = Boolean(message.is_deleted);
  const attachments = isDeleted ? [] : message.attachments || [];
  const pending = message.local_status === 'sending'
    || (message.local_status === 'failed' && awaitingConnection);
  const failed = !pending && (message.local_status === 'failed' || message.local_status === 'cancelled');
  const accessibilityLabel = buildChatMessageAccessibilityLabel(
    pending ? { ...message, local_status: offline ? 'failed' : 'sending' } : message,
    isOwn,
    { awaitingConnection: pending && offline },
  );
  const actionCard = message.action_card as {
    id?: string;
    status?: string;
    preview?: { title?: string; summary?: string; warnings?: string[]; effects?: string[] };
  } | null | undefined;

  const showSenderName = Boolean(
    !isOwn && message.sender && (groupPosition === 'single' || groupPosition === 'first'),
  );
  const stickerOnly = isStickerOnlyMessage(message);
  // F-GEO / F-CONTACT: structured bodies are JSON cards, not text.
  const locationPayload = !isDeleted && message.kind === 'location'
    ? parseLocationBody(message.body_text || message.body)
    : null;
  const contactPayload = !isDeleted && message.kind === 'contact'
    ? parseContactBody(message.body_text || message.body)
    : null;
  const pollPayload = !isDeleted && message.kind === 'poll'
    ? (message.poll || parsePollBody(message.body_text || message.body))
    : null;
  const pollClosed = Boolean(pollPayload?.closed);
  const pollVotable = Boolean(onPollVote) && !pollClosed;
  const structuredCard = Boolean(locationPayload || contactPayload || pollPayload);
  const photoAttachments = attachments.filter((attachment) => isPhotoChatAttachment(attachment));
  const hasDocumentAttachments = attachments.some((attachment) => (
    !isStickerChatAttachment(attachment)
    && !isAudioChatAttachment(attachment)
    && !isPhotoChatAttachment(attachment)
  ));
  const lastPhotoId = photoAttachments.length
    ? photoAttachments[photoAttachments.length - 1].id
    : null;
  const hasText = Boolean(message.body_text) && !structuredCard;
  const markdownBody = Boolean(
    message.body_text && !stickerOnly && !structuredCard && shouldRenderChatMarkdown(message),
  );
  const hasTrailingBlock = Boolean(
    actionCard?.id
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
  // DEV-MEDIA-2: cap by screen height, not photoWidth/1.35 — portraits were
  // rendered ~114–150×184 dp, far smaller than Telegram's portrait frames.
  const photoMaxHeight = resolveChatPhotoMaxHeight(windowHeight);
  // DEV-MEDIA-1: 2-column mosaic; square cover cells keep the grid uniform.
  const albumCellSize = Math.round((photoWidth - 4) / 2);
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
      sending={pending}
      failed={failed}
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
        {/* The tail is absolutely positioned to the row edge; the inserted
            selection mark shifts the bubble, so the tail would visually detach
            — hide it while selected (DEV-TAIL-1). */}
        {groupPosition === 'last' && !selected ? (
          <View
            style={[styles.tail, isOwn
              ? styles.tailOwn
              : [styles.tailOther, !showSenderAvatars && styles.tailOtherFlush]]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
          />
        ) : null}
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
        {locationPayload ? (
          <Pressable
            style={styles.structuredCard}
            onPress={(event) => {
              event.stopPropagation();
              void Linking.openURL(buildGeoIntentUrl(locationPayload)).catch(() => undefined);
            }}
            accessibilityRole="button"
            accessibilityLabel="Открыть геопозицию на карте"
          >
            <MaterialCommunityIcons name="map-marker-radius-outline" size={34} color={chatTokens.composerActionBg} />
            <View style={styles.structuredCardBody}>
              <Text style={styles.structuredCardTitle}>
                {locationPayload.title || 'Геопозиция'}
              </Text>
              <Text style={styles.structuredCardMeta} numberOfLines={2}>
                {locationPayload.address
                  || `${locationPayload.latitude.toFixed(5)}, ${locationPayload.longitude.toFixed(5)}`}
              </Text>
            </View>
          </Pressable>
        ) : null}
        {contactPayload ? (
          <Pressable
            style={styles.structuredCard}
            onPress={(event) => {
              event.stopPropagation();
              if (contactPayload.phone) {
                void Linking.openURL(`tel:${contactPayload.phone}`).catch(() => undefined);
              }
            }}
            disabled={!contactPayload.phone}
            accessibilityRole={contactPayload.phone ? 'button' : undefined}
            accessibilityLabel={`Контакт ${contactPayload.name}`}
          >
            <MaterialCommunityIcons name="account-circle-outline" size={34} color={chatTokens.composerActionBg} />
            <View style={styles.structuredCardBody}>
              <Text style={styles.structuredCardTitle} numberOfLines={1}>
                {contactPayload.name}
              </Text>
              <Text style={styles.structuredCardMeta} numberOfLines={2}>
                {[contactPayload.phone, contactPayload.organization].filter(Boolean).join(' · ') || 'Контакт'}
              </Text>
            </View>
          </Pressable>
        ) : null}
        {contactPayload ? (
          <View style={styles.contactActions}>
            <Pressable
              style={styles.contactAction}
              disabled={!contactPayload.phone}
              onPress={(event) => {
                event.stopPropagation();
                if (contactPayload.phone) {
                  void Linking.openURL(`sms:${contactPayload.phone}`).catch(() => undefined);
                }
              }}
              accessibilityRole="button"
              accessibilityLabel={`Написать ${contactPayload.name}`}
            >
              <MaterialCommunityIcons name="message-text-outline" size={16} color={chatTokens.composerActionBg} />
              <Text style={styles.contactActionText}>Написать</Text>
            </Pressable>
            <Pressable
              style={styles.contactAction}
              onPress={(event) => {
                event.stopPropagation();
                // Native "create contact" form — user confirms in the system UI,
                // so WRITE_CONTACTS is not needed.
                void import('expo-contacts').then((Contacts) => Contacts.Contact.presentCreateForm({
                  givenName: contactPayload.name,
                  phones: contactPayload.phone ? [{ label: 'mobile', number: contactPayload.phone }] : undefined,
                })).catch(() => undefined);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Сохранить ${contactPayload.name} в контакты`}
            >
              <MaterialCommunityIcons name="account-plus-outline" size={16} color={chatTokens.composerActionBg} />
              <Text style={styles.contactActionText}>Сохранить</Text>
            </Pressable>
          </View>
        ) : null}
        {pollPayload ? (
          <View
            style={styles.pollCard}
            accessibilityLabel={`Опрос: ${pollPayload.question}, голосов ${pollPayload.total_voters}`}
          >
            <Text style={styles.pollQuestion}>{pollPayload.question}</Text>
            {pollPayload.options.map((option, optionIndex) => {
              const isMine = pollPayload.my_option_index === optionIndex;
              const share = pollPayload.total_voters > 0
                ? Math.round((option.votes / pollPayload.total_voters) * 100)
                : 0;
              return (
                <Pressable
                  key={optionIndex}
                  style={styles.pollOption}
                  onPress={(event) => {
                    event.stopPropagation();
                    onPollVote?.(optionIndex);
                  }}
                  disabled={!pollVotable}
                  accessibilityRole={pollVotable ? 'button' : undefined}
                  accessibilityLabel={`Вариант ${option.text}, голосов ${option.votes}`}
                  accessibilityState={{ selected: isMine }}
                >
                  <View style={[styles.pollOptionFill, { width: `${Math.min(100, share)}%` }]} />
                  <MaterialCommunityIcons
                    name={isMine ? 'check-circle' : 'circle-outline'}
                    size={18}
                    color={isMine ? chatTokens.composerActionBg : chatTokens.textSecondary}
                  />
                  <Text style={styles.pollOptionText} numberOfLines={2}>{option.text}</Text>
                  <Text style={styles.pollOptionMeta}>
                    {option.votes > 0 ? `${share}% · ${option.votes}` : ''}
                  </Text>
                </Pressable>
              );
            })}
            <Text style={styles.pollFooter}>
              {pollClosed
                ? `Опрос завершён · голосов: ${pollPayload.total_voters}`
                : pollPayload.total_voters > 0 ? `Голосов: ${pollPayload.total_voters}` : 'Пока нет голосов'}
            </Text>
            {isOwn && !pollClosed && onPollClose ? (
              <Pressable
                style={styles.pollCloseButton}
                onPress={(event) => {
                  event.stopPropagation();
                  onPollClose();
                }}
                accessibilityRole="button"
                accessibilityLabel="Завершить опрос"
              >
                <Text style={styles.pollCloseText}>Завершить опрос</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {message.body_text && !stickerOnly && !structuredCard ? (
          markdownBody ? (
            <ChatMarkdownBody value={message.body_text} isOwn={isOwn} deleted={isDeleted} />
          ) : (
            <Text style={[styles.text, isOwn ? styles.textOwn : styles.textOther, isDeleted && styles.deletedText]}>
              {message.body_text}
              {metaMode === 'inline' ? (
                <View style={[styles.metaSpacer, { width: estimateChatMetaWidth(metaPlainText, fontScale) }]} />
              ) : null}
            </Text>
          )
        ) : null}
        {!isDeleted && message.body_text && !stickerOnly && !structuredCard ? (
          <ChatLinkPreviewCard text={message.body_text} isOwn={isOwn} />
        ) : null}
        {album ? (
          <View style={styles.albumWrap} testID="chat-media-album">
            <View style={styles.albumGrid}>
              {album.entries.map((entry, entryIndex) => {
                const albumPreview = resolveAttachmentUrl(pickChatAttachmentPreviewUrl(entry.attachment))
                  || String(entry.attachment.local_uri || '').trim();
                if (!albumPreview) return null;
                const albumVideo = isVideoChatAttachment(entry.attachment);
                return (
                  <Pressable
                    key={`${entry.message.id}:${entry.attachment.id || entryIndex}`}
                    onPress={(event) => {
                      event.stopPropagation();
                      onAlbumAttachmentPress?.(entry);
                    }}
                    disabled={!onAlbumAttachmentPress || Boolean(entry.message.local_status)}
                    accessibilityRole={onAlbumAttachmentPress ? 'button' : undefined}
                    accessibilityLabel={(albumVideo
                      ? `Воспроизвести видео ${entry.attachment.file_name || ''}`
                      : `Открыть фото ${entry.attachment.file_name || ''}`).trim()}
                    accessibilityHint="Открывает полноэкранный просмотр"
                    style={[styles.albumCell, { width: albumCellSize, height: albumCellSize }]}
                  >
                    <ChatAuthenticatedImage
                      uri={albumPreview}
                      style={styles.albumImage}
                      resizeMode="cover"
                      accessible={false}
                    />
                    {albumVideo ? (
                      <View pointerEvents="none" style={styles.albumVideoBadge}>
                        <Text style={styles.albumVideoIcon}>▶</Text>
                        {entry.attachment.duration_seconds
                          ? <Text style={styles.albumVideoDuration}>{formatVoiceDuration(entry.attachment.duration_seconds)}</Text>
                          : null}
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
              {!album.caption ? overlayMeta : null}
            </View>
            {album.caption ? (
              <Text style={[styles.text, styles.albumCaption, isOwn ? styles.textOwn : styles.textOther]}>{album.caption}</Text>
            ) : null}
            {album.caption ? <View style={[styles.metaRow, styles.albumCaption]}>{meta}</View> : null}
          </View>
        ) : attachments.map((attachment, attachmentIndex) => {
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
          if (isVideoChatAttachment(attachment)) {
            return (
              <Pressable
                key={attachmentIndex}
                testID="chat-video-preview"
                onPress={(event) => { event.stopPropagation(); onAttachmentPress?.(attachment); }}
                disabled={!onAttachmentPress || Boolean(message.local_status)}
                accessibilityRole="button"
                accessibilityLabel={`Воспроизвести видео ${attachment.file_name || ''}`.trim()}
                accessibilityHint="Открывает полноэкранный просмотр"
                style={[styles.videoPreview, { width: photoWidth, height: Math.min(photoMaxHeight, photoWidth * 9 / 16) }]}
              >
                {previewUrl ? <ChatAuthenticatedImage uri={previewUrl} style={StyleSheet.absoluteFill}
                  resizeMode="cover" accessible={false} /> : null}
                <View pointerEvents="none" style={styles.videoPlay}><Text style={styles.videoPlayIcon}>▶</Text></View>
                <Text numberOfLines={1} style={styles.videoCaption}>
                  {attachment.duration_seconds ? formatVoiceDuration(attachment.duration_seconds) : 'Видео'}
                </Text>
                {resolvedTransfer ? <AttachmentTransferOverlay
                  attachmentId={attachment.id} transfer={resolvedTransfer} fileName={attachment.file_name || 'видео'}
                  onCancel={onAttachmentTransferCancel ? () => onAttachmentTransferCancel(attachment) : undefined}
                  onRetry={onAttachmentTransferRetry ? () => onAttachmentTransferRetry(attachment) : undefined}
                /> : null}
              </Pressable>
            );
          }
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
                    attachmentId={attachment.id}
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
        {failed ? (
          <Pressable
            onPress={handlePress}
            disabled={!pressHandler}
            hitSlop={8}
            style={({ pressed }) => [styles.errorBadge, pressed && styles.errorBadgePressed]}
            accessibilityRole="button"
            accessibilityLabel={message.local_status === 'cancelled'
              ? 'Отправка отменена, нажмите, чтобы повторить'
              : 'Не отправлено, нажмите, чтобы повторить'}
            accessibilityHint="Открывает действия сообщения"
          >
            <MaterialCommunityIcons name="alert-circle" size={22} color={chatTokens.dangerText} />
          </Pressable>
        ) : null}
      </View>
      {!isDeleted && reactions.length > 0 ? (
        <View style={styles.reactions}>
          {reactions.map((reaction) => (
            <ChatReactionButton
              key={reaction.emoji}
              onPress={onReactionPress ? () => onReactionPress(reaction.emoji) : undefined}
              onLongPress={onReactionLongPress
                ? () => onReactionLongPress(reaction.emoji, reaction.user_ids || [])
                : undefined}
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
  attachmentId,
  transfer,
  fileName,
  onCancel,
  onRetry,
}: {
  attachmentId: string;
  transfer: ChatAttachmentTransfer;
  fileName: string;
  onCancel?: () => void;
  onRetry?: () => void;
}) {
  const chatTokens = useChatTokens();
  const styles = useMemo(() => createStyles(chatTokens), [chatTokens]);
  // Progress ticks come through the external store so the parent list is
  // not rerendered on every upload/download frame.
  const effective = useChatAttachmentTransfer(attachmentId) || transfer;
  const status = effective.status || 'active';
  const progress = effective.progress == null || effective.progress <= 0
    ? null
    : Math.max(1, Math.min(100, Math.round(Math.min(1, effective.progress) * 100)));
  const active = status === 'active';
  const action = active && effective.cancellable && onCancel
    ? { label: `Отменить отправку ${fileName}`, icon: 'close' as const, onPress: onCancel }
    : !active && onRetry
      ? { label: `Повторить отправку ${fileName}`, icon: 'refresh' as const, onPress: onRetry }
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
        {action?.icon ? (
          <MaterialCommunityIcons name={action.icon} size={18} color="#fff" />
        ) : progress != null ? (
          <Text style={styles.transferMark}>{progress}%</Text>
        ) : active ? (
          <ActivityIndicator testID="chat-transfer-indeterminate" size="small" color="#fff" />
        ) : (
          <Text style={styles.transferMark}>…</Text>
        )}
      </Pressable>
      <Text style={styles.transferLabel}>{stateLabel}{active ? (progress != null ? ` ${progress}%` : '…') : ''}</Text>
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
  const statusColor = tone === 'overlay'
    ? '#ffffff'
    : tone === 'own' ? chatTokens.bubbleOwnMetaText : chatTokens.bubbleOtherMetaText;
  return (
    <>
      <Text style={[styles.meta, toneStyle]}>{timeLabel}</Text>
      {edited ? <Text style={[styles.meta, toneStyle]}> · изм.</Text> : null}
      {own ? <ChatDeliveryStatus status={sending ? 'sending' : failed ? 'failed' : read ? 'read' : 'sent'} color={statusColor} /> : null}
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
  groupLastOwn: { borderTopRightRadius: 5, borderBottomRightRadius: 0 },
  groupFirstOther: { borderBottomLeftRadius: 5 },
  groupMiddleOther: { borderTopLeftRadius: 5, borderBottomLeftRadius: 5 },
  groupLastOther: { borderTopLeftRadius: 5, borderBottomLeftRadius: 0 },
  tail: {
    position: 'absolute',
    bottom: 0,
    width: 0,
    height: 0,
    borderTopWidth: 0,
    borderBottomWidth: 12,
    borderStyle: 'solid',
  },
  tailOwn: {
    right: -4,
    borderLeftWidth: 0,
    borderRightWidth: 10,
    borderRightColor: 'transparent',
    borderBottomColor: chatTokens.bubbleOwnBg,
  },
  tailOther: {
    left: -4 + CHAT_SENDER_AVATAR_SIZE + 6,
    borderRightWidth: 0,
    borderLeftWidth: 10,
    borderLeftColor: 'transparent',
    borderBottomColor: chatTokens.bubbleOtherBg,
  },
  tailOtherFlush: { left: -4 },
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
  structuredCard: {
    minWidth: 200,
    marginBottom: 5,
    padding: 10,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: chatTokens.sidebarRowSoftActive,
    borderLeftWidth: 3,
    borderLeftColor: chatTokens.composerActionBg,
  },
  structuredCardBody: { flex: 1 },
  structuredCardTitle: { color: chatTokens.textPrimary, fontSize: 15, fontWeight: '700' },
  structuredCardMeta: { marginTop: 3, color: chatTokens.textSecondary, fontSize: 12 },
  contactActions: { flexDirection: 'row', gap: 16, marginTop: 6, paddingHorizontal: 4 },
  contactAction: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },
  contactActionText: { color: chatTokens.composerActionBg, fontSize: 13, fontWeight: '600' },
  pollCard: {
    minWidth: 210,
    marginBottom: 5,
    padding: 10,
    borderRadius: 12,
    backgroundColor: chatTokens.sidebarRowSoftActive,
    borderLeftWidth: 3,
    borderLeftColor: chatTokens.composerActionBg,
  },
  pollQuestion: { color: chatTokens.textPrimary, fontSize: 15, fontWeight: '700', marginBottom: 8 },
  pollOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginTop: 4,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  pollOptionFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(90,140,255,0.18)',
  },
  pollOptionText: { flex: 1, color: chatTokens.textPrimary, fontSize: 14 },
  pollOptionMeta: { color: chatTokens.textSecondary, fontSize: 11 },
  pollFooter: { marginTop: 8, color: chatTokens.textSecondary, fontSize: 12 },
  pollCloseButton: { marginTop: 6, paddingVertical: 8, alignItems: 'center' },
  pollCloseText: { color: chatTokens.composerActionBg, fontSize: 14, fontWeight: '600' },
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
  // DEV-MEDIA-1/3: album mosaic — uniform square cells, photoWidth total,
  // optional caption + meta row under the grid, video cells get a ▶ badge.
  albumWrap: { gap: 4 },
  albumGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  albumCell: { borderRadius: 8, overflow: 'hidden', backgroundColor: chatTokens.sidebarSearchBg },
  albumImage: { width: '100%', height: '100%' },
  albumVideoBadge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  // Caption/meta sit inside the bleed-padded bubble, so restore padding.
  albumCaption: { paddingHorizontal: 10 },
  albumVideoIcon: { color: '#fff', fontSize: 11, fontWeight: '700' },
  albumVideoDuration: { color: '#fff', fontSize: 11, fontWeight: '700' },
  videoPreview: { alignSelf: 'flex-start', borderRadius: 10, overflow: 'hidden', backgroundColor: '#182229', alignItems: 'center', justifyContent: 'center' },
  videoPlay: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  videoPlayIcon: { color: '#fff', fontSize: 25, marginLeft: 3 },
  videoCaption: { position: 'absolute', left: 8, bottom: 8, color: '#fff', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, fontSize: 12 },
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
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 8 },
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
  metaOwn: { color: chatTokens.bubbleOwnMetaText },
  metaOther: { color: chatTokens.bubbleOtherMetaText },
  metaOverlay: { color: '#ffffff' },
  metaRead: { fontWeight: '700' },
  errorBadge: { marginHorizontal: 5, marginBottom: 4, alignItems: 'center', justifyContent: 'center' },
  errorBadgePressed: { transform: [{ scale: 0.92 }], opacity: 0.8 },
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
