import { keyframes } from '@emotion/react';
import { memo, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded';
import DoneRoundedIcon from '@mui/icons-material/DoneRounded';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded';
import ReplyRoundedIcon from '@mui/icons-material/ReplyRounded';
import { useReducedMotion } from 'framer-motion';

import { AttachmentCard, TaskShareCard } from './ChatCommon';
import MarkdownRenderer from '../hub/MarkdownRenderer';
import {
  detectChatBodyFormat,
  formatFullDate,
  formatShortTime,
  getEmojiOnlyCount,
  getReplyPreviewText,
  hasChatMarkdownTable,
  isImageAttachment,
} from './chatHelpers';

const LONG_PRESS_SCROLL_CANCEL_PX = 30;
const LONG_PRESS_HORIZONTAL_CANCEL_PX = 44;
const VIDEO_ATTACHMENT_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'm4v']);
const joinClasses = (...values) => values.filter(Boolean).join(' ');
const TELEGRAM_CHAT_FONT_FAMILY = [
  '"SF Pro Text"',
  '"SF Pro Display"',
  '"Segoe UI Variable Text"',
  '"Segoe UI"',
  'Roboto',
  'Helvetica',
  'Arial',
  'sans-serif',
].join(', ');
const CHAT_FONT_SIZES = {
  meta: '12px',
  previewTitle: '14px',
  previewBody: '13px',
  sender: '15px',
  body: '17px',
};
const LIGHT_GROUP_SENDER_COLORS = ['#d45246', '#c97a00', '#2f8b44', '#387adf', '#8b4ccf', '#0f9d8a', '#c95d9c', '#468fba'];
const DARK_GROUP_SENDER_COLORS = ['#ff7b73', '#f6c15c', '#7de26f', '#6bb6ff', '#c59bff', '#64e1cf', '#ff99dc', '#7bd7ff'];
export const isMobileMessageLongPress = ({
  mobileInteractionsEnabled = false,
  compactMobile = false,
} = {}) => Boolean(mobileInteractionsEnabled || compactMobile);

export const shouldCancelLongPressMove = ({
  startX = 0,
  startY = 0,
  currentX = 0,
  currentY = 0,
} = {}) => {
  const deltaX = Math.abs(Number(currentX || 0) - Number(startX || 0));
  const deltaY = Math.abs(Number(currentY || 0) - Number(startY || 0));
  if (deltaY >= LONG_PRESS_SCROLL_CANCEL_PX && deltaY > deltaX + 8) return true;
  if (deltaX >= LONG_PRESS_HORIZONTAL_CANCEL_PX && deltaX > deltaY + 16) return true;
  return false;
};

export const shouldSuppressNativeMessageGesture = ({
  mobileInteractionsEnabled = false,
  compactMobile = false,
} = {}) => isMobileMessageLongPress({ mobileInteractionsEnabled, compactMobile });

const MENTION_TEXT_PATTERN = /(@[0-9A-Za-zА-Яа-яЁё_.-]+)/g;

function renderPlainTextWithMentions(value, mentionColor) {
  const text = String(value || '');
  if (!text || !text.includes('@')) return text;
  const parts = [];
  let lastIndex = 0;
  text.replace(MENTION_TEXT_PATTERN, (match, _mention, offset) => {
    if (offset > lastIndex) {
      parts.push(text.slice(lastIndex, offset));
    }
    parts.push(
      <Box
        key={`mention-${offset}-${match}`}
        component="span"
        sx={{
          color: mentionColor,
          fontWeight: 800,
        }}
      >
        {match}
      </Box>,
    );
    lastIndex = offset + match.length;
    return match;
  });
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length > 0 ? parts : text;
}

const messageAppear = keyframes`
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

function normalizeSenderColorKey(sender) {
  if (!sender) return '';
  if (typeof sender === 'string') return String(sender).trim();
  return String(sender?.id || sender?.user_id || '').trim()
    || String(sender?.full_name || sender?.username || sender?.name || '').trim();
}

function hashSenderColorIndex(value, paletteSize) {
  const normalized = String(value || '').trim();
  if (!normalized || paletteSize <= 0) return 0;
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash * 31) + normalized.charCodeAt(index)) >>> 0;
  }
  return hash % paletteSize;
}

function resolveGroupSenderColor(sender, theme, ui) {
  const palette = theme.palette.mode === 'dark' ? DARK_GROUP_SENDER_COLORS : LIGHT_GROUP_SENDER_COLORS;
  const senderKey = normalizeSenderColorKey(sender);
  if (!senderKey) return ui.accentText;
  return palette[hashSenderColorIndex(senderKey, palette.length)] || ui.accentText;
}

function getBubbleRadius(isOwn, groupedWithPrevious, groupedWithNext, compactMobile = false) {
  const outerRadius = compactMobile ? 18 : 14;
  const groupedRadius = compactMobile ? 6 : 5;
  const tailRadius = compactMobile ? 6 : 4;
  if (isOwn) {
    const topRight = groupedWithPrevious ? groupedRadius : outerRadius - 2;
    const bottomRight = groupedWithNext ? groupedRadius : tailRadius;
    return `${outerRadius}px ${topRight}px ${bottomRight}px ${outerRadius}px`;
  }
  const topLeft = groupedWithPrevious ? groupedRadius : tailRadius;
  const bottomLeft = groupedWithNext ? groupedRadius : outerRadius;
  return `${outerRadius}px ${outerRadius}px ${bottomLeft}px ${topLeft}px`;
}

function isShortInlineMessage(body = '') {
  const normalized = String(body || '').trim();
  if (!normalized) return false;
  if (normalized.includes('\n')) return false;
  return normalized.length <= 34;
}

function isVideoAttachment(attachment) {
  const mimeType = String(attachment?.mime_type || '').trim().toLowerCase();
  if (mimeType.startsWith('video/')) return true;
  const fileName = String(attachment?.file_name || '').trim().toLowerCase();
  const extension = fileName.includes('.') ? fileName.split('.').pop() : '';
  return VIDEO_ATTACHMENT_EXTENSIONS.has(extension);
}

function getGalleryAttachmentsForDisplay(attachments) {
  const source = Array.isArray(attachments) ? attachments : [];
  return source.slice(0, Math.min(source.length, 4));
}

function getGalleryTileSx(totalCount, index) {
  if (totalCount === 3 && index === 0) {
    return { gridColumn: '1 / -1' };
  }
  return {};
}

function getGalleryAspectRatio(totalCount, index) {
  if (totalCount === 3 && index === 0) return '16 / 10';
  return '1 / 1';
}

function ReplyPreviewBlock({ replyPreview, theme, ui, isOwn, compactMobile = false }) {
  if (!replyPreview) return null;
  const previewSenderColor = isOwn
    ? (ui.bubbleOwnPreviewText || alpha('#fff', 0.92))
    : resolveGroupSenderColor(replyPreview?.sender_id || replyPreview?.sender_name, theme, ui);
  return (
    <div
      className={joinClasses(
        'mb-2 border-l-[3px] px-3 py-2',
        compactMobile ? 'rounded-[14px]' : 'rounded-[12px]',
      )}
      style={{
        borderLeftColor: isOwn ? (ui.bubbleOwnPreviewBorder || alpha('#fff', 0.72)) : theme.palette.primary.main,
        backgroundColor: isOwn ? (ui.bubbleOwnPreviewBg || alpha('#fff', 0.08)) : alpha(theme.palette.primary.main, 0.08),
      }}
    >
      <p
        className="truncate text-[13px] font-semibold"
        style={{
          color: previewSenderColor,
          fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
          fontSize: CHAT_FONT_SIZES.previewTitle,
          letterSpacing: '-0.01em',
        }}
      >
        {replyPreview.sender_name}
      </p>
      <p
        className="truncate text-[12px]"
        style={{
          color: isOwn ? (ui.bubbleOwnPreviewSubtleText || alpha('#fff', 0.72)) : ui.textSecondary,
          fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
          fontSize: CHAT_FONT_SIZES.previewBody,
        }}
      >
        {getReplyPreviewText(replyPreview)}
      </p>
    </div>
  );
}

function ForwardPreviewBlock({ forwardPreview, theme, ui, isOwn, compactMobile = false }) {
  if (!forwardPreview) return null;
  const senderName = String(forwardPreview?.sender_name || '').trim();
  const previewSenderColor = isOwn
    ? (ui.bubbleOwnPreviewText || alpha('#fff', 0.92))
    : resolveGroupSenderColor(forwardPreview?.sender_id || forwardPreview?.sender_name, theme, ui);
  return (
    <div
      data-testid="chat-forward-preview"
      className={joinClasses(
        'mb-2 border-l-[3px] px-3 py-2',
        compactMobile ? 'rounded-[14px]' : 'rounded-[12px]',
      )}
      style={{
        borderLeftColor: isOwn ? (ui.bubbleOwnPreviewBorder || alpha('#fff', 0.72)) : theme.palette.primary.main,
        backgroundColor: isOwn ? (ui.bubbleOwnPreviewBg || alpha('#fff', 0.08)) : alpha(theme.palette.primary.main, 0.08),
      }}
    >
      <p
        className="truncate text-[13px] font-semibold"
        style={{
          color: previewSenderColor,
          fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
          fontSize: CHAT_FONT_SIZES.previewTitle,
          letterSpacing: '-0.01em',
        }}
      >
        {senderName ? `Переслано от ${senderName}` : 'Переслано'}
      </p>
    </div>
  );
}

function AiActionCard({ actionCard, message, theme, ui, compactMobile, onConfirmAction, onCancelAction, onEditAction }) {
  const [busy, setBusy] = useState('');
  const card = actionCard && typeof actionCard === 'object' ? actionCard : null;
  if (!card) return null;
  const preview = card.preview && typeof card.preview === 'object' ? card.preview : {};
  const status = String(card.status || 'pending').trim().toLowerCase();
  const isPending = status === 'pending';
  const title = String(preview.title || 'Действие ITinvent').trim();
  const summary = String(preview.summary || '').trim();
  const databaseId = String(card.database_id || preview.database_id || '').trim();
  const items = Array.isArray(preview.items) ? preview.items : [];
  const item = preview.item && typeof preview.item === 'object' ? preview.item : null;
  const target = preview.target && typeof preview.target === 'object' ? preview.target : null;
  const mail = preview.mail && typeof preview.mail === 'object' ? preview.mail : null;
  const warnings = Array.isArray(preview.warnings) ? preview.warnings.filter(Boolean) : [];
  const effects = Array.isArray(preview.effects) ? preview.effects.filter(Boolean) : [];
  const isOfficeMail = String(card.action_type || '').startsWith('office.mail.');
  const statusLabel = {
    pending: 'Ожидает подтверждения',
    confirmed: 'Выполнено',
    cancelled: 'Отменено',
    expired: 'Истекло',
    failed: 'Ошибка',
  }[status] || status;
  const runAction = async (kind) => {
    const handler = kind === 'confirm' ? onConfirmAction : onCancelAction;
    if (typeof handler !== 'function' || !card.id) return;
    setBusy(kind);
    try {
      await handler(card, message);
    } finally {
      setBusy('');
    }
  };
  return (
    <Box
      data-testid="chat-ai-action-card"
      sx={{
        mt: 0.85,
        mb: 1.75,
        p: compactMobile ? 1 : 1.15,
        borderRadius: 1.5,
        border: '1px solid',
        borderColor: status === 'failed' ? alpha(theme.palette.error.main, 0.35) : ui.borderSoft,
        bgcolor: alpha(ui.surfaceStrong || theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.24 : 0.7),
      }}
    >
      <Stack spacing={0.7}>
        <Stack direction="row" spacing={0.8} alignItems="flex-start" justifyContent="space-between">
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 14, lineHeight: 1.2, fontWeight: 800, color: 'inherit' }}>
              {title}
            </Typography>
            {summary ? (
              <Typography sx={{ mt: 0.25, fontSize: 13, lineHeight: 1.25, color: ui.textSecondary }}>
                {summary}
              </Typography>
            ) : null}
          </Box>
          <Box
            component="span"
            sx={{
              flexShrink: 0,
              px: 0.75,
              py: 0.25,
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 800,
              color: isPending ? ui.accentText : ui.textSecondary,
              bgcolor: isPending ? alpha(ui.accentText || theme.palette.primary.main, 0.12) : alpha(ui.textSecondary || '#64748b', 0.12),
            }}
          >
            {statusLabel}
          </Box>
        </Stack>
        {databaseId ? (
          <Typography sx={{ fontSize: 12, color: ui.textSecondary }}>
            База: {databaseId}
          </Typography>
        ) : null}
        {items.length > 0 ? (
          <Stack spacing={0.35}>
            {items.slice(0, 4).map((row, index) => (
              <Typography key={`${row?.inv_no || index}`} sx={{ fontSize: 12.5, lineHeight: 1.25, color: 'inherit' }}>
                {`${row?.inv_no || 'без инв. №'}${row?.name ? ` · ${row.name}` : ''}${row?.owner ? ` · ${row.owner}` : ''}`}
              </Typography>
            ))}
            {items.length > 4 ? (
              <Typography sx={{ fontSize: 12, color: ui.textSecondary }}>{`Еще ${items.length - 4} поз.`}</Typography>
            ) : null}
          </Stack>
        ) : item ? (
          <Typography sx={{ fontSize: 12.5, lineHeight: 1.25, color: 'inherit' }}>
            {[item.inv_no, item.model, item.branch, item.location].filter(Boolean).join(' · ')}
            {item.qty_current !== undefined && item.qty_current !== null ? ` · остаток: ${item.qty_current}` : ''}
            {item.qty_next !== undefined && item.qty_next !== null ? ` → ${item.qty_next}` : ''}
          </Typography>
        ) : null}
        {target?.name ? (
          <Typography sx={{ fontSize: 12.5, color: 'inherit' }}>
            Получатель: {target.name}{target.department ? ` · ${target.department}` : ''}
          </Typography>
        ) : null}
        {mail ? (
          <Stack spacing={0.35}>
            <Typography sx={{ fontSize: 12.5, color: 'inherit' }}>
              Кому: {(Array.isArray(mail.to) ? mail.to : []).join(', ') || 'не указано'}
            </Typography>
            {Array.isArray(mail.cc) && mail.cc.length > 0 ? (
              <Typography sx={{ fontSize: 12.5, color: ui.textSecondary }}>
                Копия: {mail.cc.join(', ')}
              </Typography>
            ) : null}
            {Number(mail.bcc_count || 0) > 0 ? (
              <Typography sx={{ fontSize: 12.5, color: ui.textSecondary }}>
                Скрытая копия: {Number(mail.bcc_count || 0)}
              </Typography>
            ) : null}
            <Typography sx={{ fontSize: 12.5, color: 'inherit' }}>
              Тема: {mail.subject || 'без темы'}
            </Typography>
            {mail.body_preview ? (
              <Typography sx={{ fontSize: 12.5, lineHeight: 1.3, color: ui.textSecondary, whiteSpace: 'pre-wrap' }}>
                {mail.body_preview}
              </Typography>
            ) : null}
            {Number(mail.attachment_count || 0) > 0 ? (
              <Typography sx={{ fontSize: 12.5, color: ui.textSecondary }}>
                Вложения: {Number(mail.attachment_count || 0)}
              </Typography>
            ) : null}
          </Stack>
        ) : null}
        {effects.length > 0 ? (
          <Typography sx={{ fontSize: 12, color: ui.textSecondary }}>
            {effects.join(' · ')}
          </Typography>
        ) : null}
        {warnings.length > 0 ? (
          <Stack spacing={0.25}>
            {warnings.map((warning, index) => (
              <Typography key={`${warning}-${index}`} sx={{ fontSize: 12.3, color: theme.palette.warning.main }}>
                {warning}
              </Typography>
            ))}
          </Stack>
        ) : null}
        {card.error_text ? (
          <Typography sx={{ fontSize: 12.5, color: theme.palette.error.main }}>
            {card.error_text}
          </Typography>
        ) : null}
        {isPending ? (
          <Stack direction="row" spacing={0.8} sx={{ pt: 0.35 }}>
            <Button
              size="small"
              variant="contained"
              onClick={() => runAction('confirm')}
              disabled={Boolean(busy)}
              sx={{ borderRadius: 1.2, textTransform: 'none', fontWeight: 800 }}
            >
              {busy === 'confirm' ? 'Выполняю...' : 'Подтвердить'}
            </Button>
            {isOfficeMail ? (
              <Button
                size="small"
                variant="outlined"
                onClick={() => onEditAction?.(card, message)}
                disabled={Boolean(busy)}
                sx={{ borderRadius: 1.2, textTransform: 'none', fontWeight: 800 }}
              >
                Редактировать
              </Button>
            ) : null}
            <Button
              size="small"
              variant="text"
              onClick={() => runAction('cancel')}
              disabled={Boolean(busy)}
              sx={{ borderRadius: 1.2, textTransform: 'none', fontWeight: 800, color: ui.textSecondary }}
            >
              {busy === 'cancel' ? 'Отмена...' : 'Отменить'}
            </Button>
          </Stack>
        ) : null}
      </Stack>
    </Box>
  );
}

const ChatMarkdownBody = memo(function ChatMarkdownBody({
  value,
  bubbleText,
  hasMarkdownTable = false,
}) {
  return (
    <Box
      className="chat-selectable"
      data-testid="chat-markdown-body"
      sx={{
        display: 'block',
        pr: 0.25,
        pb: hasMarkdownTable ? 2.1 : 1.8,
        color: bubbleText,
        fontSize: CHAT_FONT_SIZES.body,
        lineHeight: 1.34,
        userSelect: 'text',
        fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
        '& .MuiBox-root': {
          color: bubbleText,
          fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
        },
      }}
    >
      <MarkdownRenderer value={value} variant="chat" />
    </Box>
  );
});

function ChatBubbleMeta({
  layout = 'bottom',
  message,
  ui,
  receiptColor,
  deliveryStatus,
  isSending,
  isOwnDirect,
  isOwnGroup,
  readByCount,
  compactMobile,
  onOpenReads,
  onReplyMessage,
  showUploadProgress = false,
  bottomOffset,
}) {
  const isInlineLayout = layout === 'inline';
  const isMediaLayout = layout === 'media';
  const uploadProgress = Number(message?.uploadProgress || 0);
  const shouldShowUploadProgress = showUploadProgress
    && isSending
    && Number.isFinite(uploadProgress)
    && uploadProgress > 0
    && uploadProgress < 100;

  return (
    <Stack
      data-testid={isInlineLayout ? 'chat-bubble-meta-inline' : isMediaLayout ? 'chat-bubble-meta-media' : 'chat-bubble-meta-bottom'}
      data-chat-meta-layout={layout}
      direction="row"
      spacing={0.3}
      justifyContent="flex-end"
      alignItems="center"
      sx={{
        position: 'absolute',
        right: isMediaLayout ? 10 : (isInlineLayout ? 10 : 12),
        bottom: bottomOffset ?? (isMediaLayout ? 10 : (isInlineLayout ? 4 : 5)),
        px: isMediaLayout ? 0.8 : 0,
        py: isMediaLayout ? 0.45 : 0,
        borderRadius: isMediaLayout ? 999 : 0,
        bgcolor: isMediaLayout ? 'rgba(2, 6, 23, 0.62)' : 'transparent',
        backdropFilter: isMediaLayout ? 'blur(12px)' : 'none',
        boxShadow: isMediaLayout ? '0 6px 18px rgba(2, 6, 23, 0.24)' : 'none',
        pointerEvents: isInlineLayout ? 'none' : 'auto',
      }}
    >
      {false && !isInlineLayout && !isMediaLayout && isOwnGroup && readByCount > 0 ? (
        <Typography
          component="button"
          type="button"
          onClick={() => onOpenReads?.(message)}
          sx={{
            appearance: 'none',
            border: 'none',
            bgcolor: 'transparent',
            p: 0,
            mr: 0.3,
            cursor: 'pointer',
            fontSize: CHAT_FONT_SIZES.meta,
            fontWeight: 700,
            color: message?.is_own ? alpha('#fff', 0.92) : ui.accentText,
            lineHeight: 1,
            fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
          }}
        >
          {`Просмотрели: ${readByCount}`}
        </Typography>
      ) : null}

      {false && !compactMobile && !isInlineLayout && !isMediaLayout ? (
        <Tooltip title="Ответить">
          <span>
            <IconButton size="small" aria-label="Ответить" onClick={() => onReplyMessage?.(message)} sx={{ p: 0, width: 18, height: 18, color: receiptColor }}>
              <ReplyRoundedIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </span>
        </Tooltip>
      ) : null}

      <Typography variant="caption" title={formatFullDate(message?.created_at)} sx={{ color: receiptColor, fontSize: CHAT_FONT_SIZES.meta, lineHeight: 1, fontFamily: TELEGRAM_CHAT_FONT_FAMILY }}>
        {formatShortTime(message?.created_at)}
      </Typography>

      {shouldShowUploadProgress ? (
        <Typography variant="caption" sx={{ color: receiptColor, fontSize: CHAT_FONT_SIZES.meta, lineHeight: 1, fontWeight: 700, fontFamily: TELEGRAM_CHAT_FONT_FAMILY }}>
          {`${uploadProgress}%`}
        </Typography>
      ) : null}

      {isOwnDirect ? (
        isSending
          ? <CircularProgress size={13} thickness={5} sx={{ color: receiptColor }} />
          : deliveryStatus === 'read'
            ? <DoneAllRoundedIcon sx={{ fontSize: 15, color: receiptColor }} />
            : <DoneRoundedIcon sx={{ fontSize: 15, color: receiptColor }} />
      ) : null}
    </Stack>
  );
}

export function ChatBubble({
  conversationKind,
  message,
  navigate,
  theme,
  ui,
  onOpenReads,
  onOpenAttachmentPreview,
  onReplyMessage,
  onOpenMessageMenu,
  onConfirmAction,
  onCancelAction,
  onEditAction,
  highlighted = false,
  selectionMode = false,
  selected = false,
  onToggleMessageSelection,
  onStartMessageSelection,
  groupedWithPrevious = false,
  groupedWithNext = false,
  compactMobile = false,
  mobileInteractionsEnabled = false,
  readTargetRef,
}) {
  const task = message?.kind === 'task_share' ? message?.task_preview : null;
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  const attachmentCaption = attachments.length > 0 ? String(message?.body || '').trim() : '';
  const body = String(message?.body || '').trim();
  const isMarkdownBody = String(message?.body_format || '').trim() === 'markdown'
    || (message?.kind === 'text' && attachments.length === 0 && detectChatBodyFormat(body) === 'markdown');
  const hasMarkdownTable = isMarkdownBody && hasChatMarkdownTable(body);
  const emojiOnlyCount = !task && attachments.length === 0 ? getEmojiOnlyCount(message?.body) : 0;
  const showSender = !message?.is_own && conversationKind !== 'direct' && !groupedWithPrevious;
  const isOwnDirect = Boolean(message?.is_own) && conversationKind === 'direct';
  const isOwnGroup = Boolean(message?.is_own) && conversationKind !== 'direct';
  const readByCount = Number(message?.read_by_count || 0);
  const deliveryStatus = String(message?.delivery_status || '').trim();
  const isSending = deliveryStatus === 'sending' || message?.optimisticStatus === 'sending';
  const hasReplyPreview = Boolean(message?.reply_preview);
  const hasForwardPreview = Boolean(message?.forward_preview);
  const ownMetaColor = ui.bubbleOwnMetaText || '#ffffff';
  const senderAccentColor = showSender ? resolveGroupSenderColor(message?.sender, theme, ui) : ui.accentText;
  const inlineMeta = !task
    && attachments.length === 0
    && emojiOnlyCount === 0
    && !isMarkdownBody
    && !hasReplyPreview
    && !hasForwardPreview
    && isShortInlineMessage(body);
  const receiptColor = message?.is_own
    ? (deliveryStatus === 'read' && !isSending
      ? (ui.statusReadText || alpha(ownMetaColor, 0.96))
      : alpha(ownMetaColor, isSending ? 0.72 : 0.86))
    : alpha(ui.textSecondary, 0.9);
  const bubbleBg = message?.is_own ? ui.bubbleOwnBg : ui.bubbleOtherBg;
  const bubbleText = message?.is_own ? ui.bubbleOwnText : ui.bubbleOtherText;
  const longPressTimerRef = useRef(null);
  const longPressStartRef = useRef({ x: 0, y: 0 });
  const longPressGestureRef = useRef({ source: '', pointerId: null, handled: false });
  const prefersReducedMotion = useReducedMotion();
  const canToggleSelection = typeof onToggleMessageSelection === 'function';
  const mobileMessageInteractionsEnabled = isMobileMessageLongPress({
    mobileInteractionsEnabled,
    compactMobile,
  });
  const suppressNativeMessageGesture = shouldSuppressNativeMessageGesture({
    mobileInteractionsEnabled,
    compactMobile,
  });
  const showQuickActions = !selectionMode && !compactMobile && emojiOnlyCount === 0 && typeof onOpenMessageMenu === 'function';

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressGestureRef.current = { source: '', pointerId: null, handled: longPressGestureRef.current.handled };
  };

  const resetLongPressGesture = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressGestureRef.current = { source: '', pointerId: null, handled: false };
  };

  const toggleSelection = () => {
    if (!message?.id || !canToggleSelection) return;
    onToggleMessageSelection(message);
  };

  const handleClickCapture = (event) => {
    if (longPressGestureRef.current.handled) {
      event.preventDefault();
      event.stopPropagation();
      longPressGestureRef.current = { source: '', pointerId: null, handled: false };
      return;
    }
    if (!selectionMode) return;
    event.preventDefault();
    event.stopPropagation();
    toggleSelection();
  };

  const runLongPressAction = (target) => {
    if (selectionMode && canToggleSelection) {
      toggleSelection();
      return;
    }
    if (typeof onStartMessageSelection === 'function') {
      onStartMessageSelection(message);
      return;
    }
    if (typeof onOpenMessageMenu === 'function') {
      onOpenMessageMenu(message, target);
      return;
    }
    onReplyMessage?.(message);
  };

  const scheduleLongPress = ({ x = 0, y = 0, target = null, pointerId = null, source = 'touch' } = {}) => {
    if (!mobileMessageInteractionsEnabled) return;
    if (longPressTimerRef.current) return;
    if (longPressGestureRef.current.source && longPressGestureRef.current.source !== source) return;
    longPressStartRef.current = {
      x: Number(x || 0),
      y: Number(y || 0),
    };
    longPressGestureRef.current = { source, pointerId, handled: false };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressGestureRef.current = { ...longPressGestureRef.current, handled: true };
      runLongPressAction(target);
    }, 420);
  };

  const startLongPress = (event) => {
    if (!mobileMessageInteractionsEnabled) return;
    if (suppressNativeMessageGesture && event?.cancelable) {
      event.preventDefault();
    }
    const touch = event?.touches?.[0] || null;
    scheduleLongPress({
      x: Number(touch?.clientX || 0),
      y: Number(touch?.clientY || 0),
      target: event?.currentTarget || null,
      source: 'touch',
    });
  };

  const startPointerLongPress = (event) => {
    if (!mobileMessageInteractionsEnabled) return;
    if (event?.pointerType && event.pointerType !== 'touch') return;
    if (suppressNativeMessageGesture && event?.cancelable) {
      event.preventDefault();
    }
    scheduleLongPress({
      x: Number(event?.clientX || 0),
      y: Number(event?.clientY || 0),
      target: event?.currentTarget || null,
      pointerId: event?.pointerId ?? null,
      source: 'pointer',
    });
  };

  const handleLongPressMove = (event) => {
    if (!longPressTimerRef.current) return;
    const touch = event?.touches?.[0] || null;
    if (!touch) {
      resetLongPressGesture();
      return;
    }
    if (shouldCancelLongPressMove({
      startX: longPressStartRef.current.x,
      startY: longPressStartRef.current.y,
      currentX: Number(touch.clientX || 0),
      currentY: Number(touch.clientY || 0),
    })) {
      resetLongPressGesture();
    }
  };

  const handlePointerLongPressMove = (event) => {
    if (!longPressTimerRef.current) return;
    if (event?.pointerType && event.pointerType !== 'touch') return;
    if (longPressGestureRef.current.pointerId !== null && event?.pointerId !== longPressGestureRef.current.pointerId) return;
    if (shouldCancelLongPressMove({
      startX: longPressStartRef.current.x,
      startY: longPressStartRef.current.y,
      currentX: Number(event?.clientX || 0),
      currentY: Number(event?.clientY || 0),
    })) {
      resetLongPressGesture();
    }
  };

  const handleTouchCancel = () => {
    if (!mobileMessageInteractionsEnabled) {
      resetLongPressGesture();
    }
  };

  const handlePointerCancel = () => {
    if (!mobileMessageInteractionsEnabled) {
      resetLongPressGesture();
    }
  };

  const handleContextMenu = (event) => {
    if (mobileMessageInteractionsEnabled) {
      event.preventDefault();
      event.stopPropagation();
      if (!longPressTimerRef.current && !longPressGestureRef.current.handled) {
        longPressGestureRef.current = { source: 'contextmenu', pointerId: null, handled: true };
        runLongPressAction(event.currentTarget);
      }
      return;
    }
    if (selectionMode && canToggleSelection) {
      event.preventDefault();
      event.stopPropagation();
      toggleSelection();
      return;
    }
    if (typeof onOpenMessageMenu !== 'function') return;
    event.preventDefault();
    event.stopPropagation();
    onOpenMessageMenu(message, {
      anchorEl: event.currentTarget,
      anchorPosition: {
        top: Math.round(Number(event.clientY || 0)),
        left: Math.round(Number(event.clientX || 0)),
      },
      anchorReference: 'anchorPosition',
    });
  };

  useEffect(() => () => {
    clearLongPress();
  }, []);

  const mediaOnlyAttachments = attachments.length > 0
    && attachments.every((attachment) => isImageAttachment(attachment) || isVideoAttachment(attachment));
  const imageOnlyGallery = attachments.length > 1 && attachments.every((attachment) => isImageAttachment(attachment));
  const showMediaMetaOverlay = mediaOnlyAttachments && !attachmentCaption;
  const pureMediaBubble = mediaOnlyAttachments && !attachmentCaption;
  const mediaPreviewMaxWidth = compactMobile ? 216 : 276;
  const mediaPreviewMaxHeight = compactMobile ? 176 : 216;
  const mediaPreviewMinWidth = compactMobile ? 148 : 164;
  const galleryPreviewMaxWidth = compactMobile ? 196 : 248;
  const displayedGalleryAttachments = imageOnlyGallery ? getGalleryAttachmentsForDisplay(attachments) : [];
  const galleryHiddenCount = imageOnlyGallery && attachments.length > displayedGalleryAttachments.length
    ? attachments.length - displayedGalleryAttachments.length
    : 0;
  const mediaFrameSx = imageOnlyGallery
    ? { width: galleryPreviewMaxWidth, maxWidth: '100%' }
    : mediaOnlyAttachments
      ? { width: 'fit-content', maxWidth: mediaPreviewMaxWidth }
      : { width: '100%', maxWidth: '100%' };
  const bubbleMaxWidth = hasMarkdownTable
    ? { xs: 'calc(100vw - 22px)', md: 'min(92%, 900px)' }
    : { xs: emojiOnlyCount ? '100%' : '85vw', md: emojiOnlyCount ? '100%' : '65%' };
  const bubbleWidth = hasMarkdownTable ? { xs: 'calc(100vw - 22px)', md: 'auto' } : 'auto';

  const renderMessageMeta = (layout = 'bottom') => (
    <ChatBubbleMeta
      layout={layout}
      message={message}
      ui={ui}
      receiptColor={receiptColor}
      deliveryStatus={deliveryStatus}
      isSending={isSending}
      isOwnDirect={isOwnDirect}
      isOwnGroup={isOwnGroup}
      readByCount={readByCount}
      compactMobile={compactMobile}
      onOpenReads={onOpenReads}
      onReplyMessage={onReplyMessage}
      showUploadProgress
    />
  );

  return (
    <Box
      ref={readTargetRef}
      data-chat-message-id={message?.id}
      data-chat-selected={selected ? 'true' : undefined}
      onClickCapture={handleClickCapture}
      onDoubleClick={(event) => {
        if (selectionMode) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onReplyMessage?.(message);
      }}
      className={joinClasses('relative flex flex-col', message?.is_own ? 'items-end' : 'items-start')}
      sx={{
        width: '100%',
        pt: showSender ? 0.28 : groupedWithPrevious ? '1px' : 0.65,
        pb: groupedWithNext ? '1px' : 0.28,
        pl: 0,
        pr: 0,
        mx: 0,
        borderRadius: 0,
        bgcolor: selected && !compactMobile ? alpha(ui.accentText || theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.12) : 'transparent',
        cursor: selectionMode ? 'pointer' : 'default',
        animation: prefersReducedMotion || (compactMobile && !message?.isOptimistic) ? 'none' : `${messageAppear} 150ms ease-out`,
        overflowAnchor: 'none',
        transition: 'background-color 120ms ease',
        ...(mobileMessageInteractionsEnabled ? {
          WebkitTouchCallout: 'none',
          WebkitUserSelect: 'none',
          userSelect: 'none',
          touchAction: 'pan-y',
          '& .chat-selectable, & .chat-selectable *': {
            WebkitUserSelect: 'none',
            userSelect: 'none',
          },
        } : {}),
      }}
    >
      {selectionMode ? (
        <Box
          component="button"
          type="button"
          data-testid={`chat-message-select-${message?.id}`}
          aria-label={selected ? 'Снять выделение' : 'Выделить сообщение'}
          aria-pressed={selected}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleSelection();
          }}
          sx={{
            position: 'absolute',
            left: { xs: 6, md: 10 },
            top: '50%',
            transform: 'translateY(-50%)',
            width: compactMobile ? 28 : 26,
            height: compactMobile ? 28 : 26,
            p: 0,
            border: 'none',
            borderRadius: 999,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: selected ? (ui.accentText || theme.palette.primary.main) : alpha(ui.textSecondary || theme.palette.text.secondary, 0.82),
            bgcolor: compactMobile
              ? 'transparent'
              : selected ? alpha(ui.accentText || theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.1) : alpha(ui.surfaceStrong || '#ffffff', theme.palette.mode === 'dark' ? 0.32 : 0.78),
            boxShadow: compactMobile
              ? 'none'
              : selected ? `0 0 0 2px ${alpha(ui.accentText || theme.palette.primary.main, 0.16)}` : ui.shadowSoft,
            cursor: 'pointer',
            outline: 'none',
            '&:focus, &:focus-visible': {
              outline: 'none',
            },
          }}
        >
          {selected ? <CheckCircleRoundedIcon sx={{ fontSize: compactMobile ? 21 : 20 }} /> : <RadioButtonUncheckedRoundedIcon sx={{ fontSize: compactMobile ? 21 : 20 }} />}
        </Box>
      ) : null}

      {showSender ? (
        <Typography
          variant="caption"
          className="px-3 pb-1 text-[14px] font-medium leading-[1.15]"
          sx={{
            color: senderAccentColor,
            fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
            fontSize: CHAT_FONT_SIZES.sender,
            ml: selectionMode && !message?.is_own ? { xs: 5, md: 4.2 } : 0,
          }}
        >
          {message?.sender?.full_name || message?.sender?.username || 'Пользователь'}
        </Typography>
      ) : null}

      <Box
        data-chat-bubble-surface="true"
        data-chat-table-layout={hasMarkdownTable ? 'wide' : undefined}
        onContextMenu={handleContextMenu}
        onPointerDown={startPointerLongPress}
        onPointerMove={handlePointerLongPressMove}
        onPointerUp={clearLongPress}
        onPointerCancel={handlePointerCancel}
        onTouchStart={startLongPress}
        onTouchEnd={clearLongPress}
        onTouchCancel={handleTouchCancel}
        onTouchMove={handleLongPressMove}
        className={joinClasses('relative transition duration-100', compactMobile ? 'active:opacity-90' : '')}
        sx={{
          width: bubbleWidth,
          maxWidth: bubbleMaxWidth,
          ml: selectionMode && !message?.is_own ? { xs: 5, md: 4.2 } : 0,
          px: task ? 0.62 : pureMediaBubble ? 0.14 : attachments.length > 0 ? 0.62 : emojiOnlyCount ? 0.18 : 1.18,
          py: task ? 0.62 : pureMediaBubble ? 0.14 : attachments.length > 0 ? 0.62 : emojiOnlyCount ? 0.08 : 0.82,
          borderRadius: emojiOnlyCount ? 0 : getBubbleRadius(Boolean(message?.is_own), groupedWithPrevious, groupedWithNext, compactMobile),
          bgcolor: emojiOnlyCount || pureMediaBubble ? 'transparent' : bubbleBg,
          color: bubbleText,
          boxShadow: emojiOnlyCount || pureMediaBubble
            ? 'none'
            : (
              compactMobile
                ? (theme.palette.mode === 'dark' ? '0 1px 0 rgba(255,255,255,0.02), 0 8px 18px rgba(3, 8, 15, 0.12)' : '0 8px 20px rgba(70, 92, 114, 0.12)')
                : ui.shadowSoft
            ),
          outline: highlighted ? `2px solid ${alpha(theme.palette.primary.main, 0.42)}` : 'none',
          outlineOffset: highlighted ? 2 : 0,
          border: 'none',
          userSelect: 'none',
          '&:focus, &:focus-visible': {
            outline: highlighted ? `2px solid ${alpha(theme.palette.primary.main, 0.42)}` : 'none',
          },
          transition: 'background-color 120ms ease, box-shadow 120ms ease, transform 120ms ease, outline-color 120ms ease',
          '&:hover .chat-bubble-actions': {
            opacity: 1,
            transform: 'translateY(0)',
            pointerEvents: 'auto',
          },
          '&::after': (!emojiOnlyCount && !pureMediaBubble && !groupedWithNext) ? {
            content: '""',
            position: 'absolute',
            bottom: 0,
            width: 12,
            height: 16,
            backgroundColor: bubbleBg,
            boxShadow: ui.bubbleTailShadow || 'none',
            ...(message?.is_own ? {
              right: -5,
              clipPath: 'polygon(0 0, 100% 100%, 0 100%)',
            } : {
              left: -5,
              clipPath: 'polygon(100% 0, 100% 100%, 0 100%)',
            }),
          } : undefined,
        }}
      >
        {showQuickActions ? (
          <Stack
            className="chat-bubble-actions"
            direction="row"
            spacing={0.35}
            sx={{
              position: 'absolute',
              top: -17,
              zIndex: 3,
              opacity: 0,
              pointerEvents: 'none',
              transform: 'translateY(3px)',
              transition: 'opacity 120ms ease, transform 120ms ease',
              ...(message?.is_own ? { right: 4 } : { left: 4 }),
            }}
          >
            <Tooltip title="Ответить">
              <button
                type="button"
                aria-label="Ответить"
                onClick={(event) => {
                  event.stopPropagation();
                  onReplyMessage?.(message);
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full transition duration-100 active:scale-[0.96]"
                style={{
                  color: ui.textPrimary,
                  backgroundColor: alpha(ui.surfaceStrong || '#ffffff', theme.palette.mode === 'dark' ? 0.92 : 0.96),
                  boxShadow: ui.shadowSoft,
                  border: `1px solid ${ui.borderSoft}`,
                }}
              >
                <ReplyRoundedIcon sx={{ fontSize: 15 }} />
              </button>
            </Tooltip>
            <Tooltip title="Действия">
              <button
                type="button"
                aria-label="Действия"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenMessageMenu?.(message, event.currentTarget);
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full transition duration-100 active:scale-[0.96]"
                style={{
                  color: ui.textPrimary,
                  backgroundColor: alpha(ui.surfaceStrong || '#ffffff', theme.palette.mode === 'dark' ? 0.92 : 0.96),
                  boxShadow: ui.shadowSoft,
                  border: `1px solid ${ui.borderSoft}`,
                }}
              >
                <MoreHorizRoundedIcon sx={{ fontSize: 16 }} />
              </button>
            </Tooltip>
          </Stack>
        ) : null}
        <ForwardPreviewBlock
          forwardPreview={message?.forward_preview}
          theme={theme}
          ui={ui}
          isOwn={Boolean(message?.is_own)}
          compactMobile={compactMobile}
        />
        <ReplyPreviewBlock replyPreview={message?.reply_preview} theme={theme} ui={ui} isOwn={Boolean(message?.is_own)} compactMobile={compactMobile} />

        {task ? (
          <TaskShareCard task={task} navigate={navigate} ui={ui} theme={theme} />
        ) : attachments.length > 0 ? (
          <Stack spacing={0.9}>
            <Box
              sx={{
                position: 'relative',
                ...mediaFrameSx,
              }}
            >
              {imageOnlyGallery ? (
                <Box
                  data-testid="chat-attachment-gallery"
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: '6px',
                  }}
                >
                  {displayedGalleryAttachments.map((attachment, index) => (
                    <Box
                      key={attachment.id}
                      sx={{
                        position: 'relative',
                        minWidth: 0,
                        ...getGalleryTileSx(displayedGalleryAttachments.length, index),
                      }}
                    >
                      <AttachmentCard
                        messageId={message.id}
                        attachment={{
                          ...attachment,
                          mediaMaxWidth: '100%',
                          forcedAspectRatio: getGalleryAspectRatio(displayedGalleryAttachments.length, index),
                        }}
                        theme={theme}
                        ui={ui}
                        onOpenPreview={onOpenAttachmentPreview}
                        isOwn={Boolean(message?.is_own)}
                      />
                      {galleryHiddenCount > 0 && index === (displayedGalleryAttachments.length - 1) ? (
                        <Box
                          aria-hidden="true"
                          sx={{
                            position: 'absolute',
                            inset: 0,
                            borderRadius: 3,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            bgcolor: 'rgba(2, 6, 23, 0.54)',
                            backdropFilter: 'blur(3px)',
                            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
                            color: '#fff',
                            fontSize: compactMobile ? '1.15rem' : '1.25rem',
                            fontWeight: 800,
                            letterSpacing: '-0.02em',
                          }}
                        >
                          {`+${galleryHiddenCount}`}
                        </Box>
                      ) : null}
                    </Box>
                  ))}
                </Box>
              ) : (
                <Stack spacing={0.75}>
                  {attachments.map((attachment) => (
                    <AttachmentCard
                      key={attachment.id}
                      messageId={message.id}
                      attachment={
                        isImageAttachment(attachment) || isVideoAttachment(attachment)
                          ? {
                            ...attachment,
                            mediaMaxWidth: mediaPreviewMaxWidth,
                            mediaMaxHeight: mediaPreviewMaxHeight,
                            mediaMinWidth: mediaPreviewMinWidth,
                          }
                          : attachment
                      }
                      theme={theme}
                      ui={ui}
                      onOpenPreview={onOpenAttachmentPreview}
                      isOwn={Boolean(message?.is_own)}
                    />
                  ))}
                </Stack>
              )}
              {showMediaMetaOverlay ? renderMessageMeta('media') : null}
            </Box>
            {attachmentCaption ? (
              <Typography
                variant="body2"
                className="chat-selectable"
                sx={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  lineHeight: 1.34,
                  fontSize: CHAT_FONT_SIZES.body,
                  color: bubbleText,
                  userSelect: 'text',
                  fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
                  letterSpacing: '-0.01em',
                }}
              >
                {attachmentCaption}
              </Typography>
            ) : null}
          </Stack>
        ) : isMarkdownBody ? (
          <ChatMarkdownBody
            value={message?.body}
            bubbleText={bubbleText}
            hasMarkdownTable={hasMarkdownTable}
          />
        ) : (
          <Typography
            variant="body1"
            className="chat-selectable"
            sx={{
              display: 'block',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              pr: inlineMeta ? 0 : 0.25,
              pb: inlineMeta ? 0 : 1.8,
              lineHeight: emojiOnlyCount ? 1.08 : 1.34,
              fontSize: emojiOnlyCount ? (emojiOnlyCount === 1 ? '3.2rem' : '2.6rem') : CHAT_FONT_SIZES.body,
              color: bubbleText,
              userSelect: 'text',
              fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
              letterSpacing: emojiOnlyCount ? undefined : '-0.01em',
              '&::after': inlineMeta ? {
                content: '""',
                display: 'inline-block',
                width: isOwnDirect ? (compactMobile ? '4.15rem' : '3.9rem') : (compactMobile ? '2.8rem' : '2.5rem'),
                height: '0.9em',
              } : undefined,
            }}
          >
            {renderPlainTextWithMentions(message?.body, ui.accentText || theme.palette.primary.main)}
          </Typography>
        )}

        <AiActionCard
          actionCard={message?.action_card}
          message={message}
          theme={theme}
          ui={ui}
          compactMobile={compactMobile}
          onConfirmAction={onConfirmAction}
          onCancelAction={onCancelAction}
          onEditAction={onEditAction}
        />

        {!showMediaMetaOverlay ? (
          <ChatBubbleMeta
            layout={inlineMeta ? 'inline' : 'bottom'}
            message={message}
            ui={ui}
            receiptColor={receiptColor}
            deliveryStatus={deliveryStatus}
            isSending={isSending}
            isOwnDirect={isOwnDirect}
            isOwnGroup={isOwnGroup}
            readByCount={readByCount}
            compactMobile={compactMobile}
            onOpenReads={onOpenReads}
            onReplyMessage={onReplyMessage}
            bottomOffset={7}
          />
        ) : null}
      </Box>
    </Box>
  );
}

export const MemoChatBubble = memo(ChatBubble);
