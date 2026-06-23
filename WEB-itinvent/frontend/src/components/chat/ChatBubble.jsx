import { keyframes } from '@emotion/react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
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
import AddReactionRoundedIcon from '@mui/icons-material/AddReactionRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded';
import DoneRoundedIcon from '@mui/icons-material/DoneRounded';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded';
import ReplyRoundedIcon from '@mui/icons-material/ReplyRounded';
import { useReducedMotion } from 'framer-motion';

import { AttachmentCard, TaskShareCard } from './ChatCommon';
import ChatLinkPreview, { extractFirstUrl } from './ChatLinkPreview';
import { renderChatPlainTextBody } from './chatPlainText';
import {
  buildChatMessageBodySurfaceSx,
  CHAT_DEFAULT_FONT_SIZES,
  CHAT_FONT_FAMILY,
  getChatBubbleBodyFontSize,
  getChatBubbleBodyLineHeight,
  resolveChatBubbleLinkColors,
} from './chatUiTokens';
import MarkdownRenderer from '../hub/MarkdownRenderer';
import {
  detectChatBodyFormat,
  formatFullDate,
  formatMessageMetaLabel,
  getEmojiOnlyCount,
  getReplyPreviewText,
  hasChatMarkdownTable,
  isAudioAttachment,
  isImageAttachment,
  isVideoAttachment,
} from './chatHelpers';

const LONG_PRESS_SCROLL_CANCEL_PX = 30;
const LONG_PRESS_HORIZONTAL_CANCEL_PX = 44;
const joinClasses = (...values) => values.filter(Boolean).join(' ');
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

export const shouldAnimateChatBubble = ({
  prefersReducedMotion = false,
  compactMobile = false,
  isOwn = false,
  isOptimistic = false,
  isSending = false,
} = {}) => {
  if (prefersReducedMotion) return false;
  if (isOwn) return false;
  if (compactMobile && !isOptimistic) return false;
  return true;
};

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

function isShortInlineMessage(body = '', { compactMobile = false } = {}) {
  const normalized = String(body || '').trim();
  if (!normalized) return false;
  if (normalized.includes('\n')) return false;
  const inlineLimit = compactMobile ? 34 : 24;
  return normalized.length <= inlineLimit;
}

function getInlineMetaReserveWidth({
  compactMobile = false,
  isOwnDirect = false,
  edited = false,
} = {}) {
  const base = isOwnDirect
    ? (compactMobile ? 4.15 : 3.9)
    : (compactMobile ? 2.8 : 2.5);
  const editedExtra = edited ? (compactMobile ? 1.45 : 1.25) : 0;
  return `${base + editedExtra}rem`;
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

function ReplyPreviewBlock({ replyPreview, theme, ui, isOwn, compactMobile = false, onScrollToMessage }) {
  if (!replyPreview) return null;
  const density = ui.density || {};
  const previewSenderColor = isOwn
    ? (ui.bubbleOwnPreviewText || alpha('#fff', 0.92))
    : resolveGroupSenderColor(replyPreview?.sender_id || replyPreview?.sender_name, theme, ui);
  const replyMessageId = String(replyPreview?.message_id || replyPreview?.id || '').trim();
  const handleClick = (event) => {
    if (!replyMessageId || typeof onScrollToMessage !== 'function') return;
    event.stopPropagation();
    onScrollToMessage(replyMessageId);
  };
  return (
    <div
      role={replyMessageId ? 'button' : undefined}
      tabIndex={replyMessageId ? 0 : undefined}
      onClick={handleClick}
      className={joinClasses(
        'mb-2 border-l-[3px] px-3 py-2',
        compactMobile ? 'rounded-[14px]' : 'rounded-[12px]',
      )}
      style={{
        borderLeftColor: isOwn ? (ui.bubbleOwnPreviewBorder || alpha('#fff', 0.72)) : theme.palette.primary.main,
        backgroundColor: isOwn ? (ui.bubbleOwnPreviewBg || alpha('#fff', 0.08)) : alpha(theme.palette.primary.main, 0.08),
        cursor: replyMessageId ? 'pointer' : 'default',
      }}
    >
      <p
        className="truncate text-[13px] font-semibold"
        style={{
          color: previewSenderColor,
          fontFamily: CHAT_FONT_FAMILY,
          fontSize: density.bubblePreviewTitleFontSize || CHAT_DEFAULT_FONT_SIZES.previewTitle,
          letterSpacing: '-0.01em',
        }}
      >
        {replyPreview.sender_name}
      </p>
      <p
        className="truncate text-[12px]"
        style={{
          color: isOwn ? (ui.bubbleOwnPreviewSubtleText || alpha('#fff', 0.72)) : ui.textSecondary,
          fontFamily: CHAT_FONT_FAMILY,
          fontSize: density.bubblePreviewBodyFontSize || CHAT_DEFAULT_FONT_SIZES.previewBody,
        }}
      >
        {getReplyPreviewText(replyPreview)}
      </p>
    </div>
  );
}

function ForwardPreviewBlock({ forwardPreview, theme, ui, isOwn, compactMobile = false }) {
  if (!forwardPreview) return null;
  const density = ui.density || {};
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
          fontFamily: CHAT_FONT_FAMILY,
          fontSize: density.bubblePreviewTitleFontSize || CHAT_DEFAULT_FONT_SIZES.previewTitle,
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
  const actionType = String(card.action_type || '').trim();
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
  const isOfficeMail = actionType.startsWith('office.mail.');
  const isReportFormatChoice = actionType === 'ai.report.format_choice';
  const report = preview.report && typeof preview.report === 'object' ? preview.report : null;
  const reportFormats = (Array.isArray(preview.formats) ? preview.formats : ['xlsx', 'pdf', 'docx', 'csv'])
    .map((format) => String(format || '').trim().toLowerCase())
    .filter((format) => ['xlsx', 'pdf', 'docx', 'csv'].includes(format));
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
  const runReportFormat = async (format) => {
    if (typeof onConfirmAction !== 'function' || !card.id || !format) return;
    const busyKey = `format:${format}`;
    setBusy(busyKey);
    try {
      await onConfirmAction(card, message, { format });
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
        {report ? (
          <Typography sx={{ fontSize: 12, color: ui.textSecondary }}>
            {`Tables: ${Number(report.table_count || 0)} · Rows: ${Number(report.row_count || 0)}${report.source ? ` · Source: ${report.source}` : ''}`}
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
          <Stack direction="row" spacing={0.8} useFlexGap flexWrap="wrap" sx={{ pt: 0.35 }}>
            {isReportFormatChoice ? (
              reportFormats.map((format) => (
                <Button
                  key={format}
                  size="small"
                  variant="contained"
                  onClick={() => runReportFormat(format)}
                  disabled={Boolean(busy)}
                  sx={{ borderRadius: 1.2, textTransform: 'uppercase', fontWeight: 800, minWidth: 68 }}
                >
                  {busy === `format:${format}` ? '...' : format}
                </Button>
              ))
            ) : (
            <Button
              size="small"
              variant="contained"
              onClick={() => runAction('confirm')}
              disabled={Boolean(busy)}
              sx={{ borderRadius: 1.2, textTransform: 'none', fontWeight: 800 }}
            >
              {busy === 'confirm' ? 'Выполняю...' : 'Подтвердить'}
            </Button>
            )}
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
  linkColor,
  hasMarkdownTable = false,
  compactMobile = false,
  ui,
}) {
  const messageBodyFontSize = getChatBubbleBodyFontSize(ui, compactMobile);
  const messageBodyLineHeight = getChatBubbleBodyLineHeight(ui, compactMobile);
  return (
    <Box
      className="chat-selectable"
      data-testid="chat-markdown-body"
      data-chat-message-body="true"
      style={{ fontSize: messageBodyFontSize }}
      sx={{
        display: 'block',
        pr: 0.25,
        pb: hasMarkdownTable ? 2.1 : 1.8,
        color: bubbleText,
        ...buildChatMessageBodySurfaceSx(messageBodyFontSize, messageBodyLineHeight),
        userSelect: 'text',
        fontFamily: CHAT_FONT_FAMILY,
        '& .MuiBox-root': {
          color: bubbleText,
          fontFamily: CHAT_FONT_FAMILY,
        },
      }}
    >
      <MarkdownRenderer value={value} variant="chat" linkColor={linkColor} />
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
  inFlow = false,
  dense = false,
}) {
  const isInlineLayout = layout === 'inline';
  const isMediaLayout = layout === 'media';
  const density = ui.density || {};
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
        position: inFlow ? 'relative' : 'absolute',
        right: inFlow ? 'auto' : (isMediaLayout ? 10 : (isInlineLayout ? 10 : 12)),
        bottom: inFlow ? 'auto' : (bottomOffset ?? (isMediaLayout ? 10 : (isInlineLayout ? 4 : 5))),
        mt: inFlow ? (dense ? 0 : '2px') : 0,
        mb: inFlow ? (dense ? 0 : '4px') : 0,
        pr: inFlow ? (dense ? 0 : '10px') : 0,
        px: isMediaLayout ? 0.8 : 0,
        py: isMediaLayout ? 0.45 : 0,
        borderRadius: isMediaLayout ? 999 : 0,
        bgcolor: isMediaLayout ? 'rgba(2, 6, 23, 0.62)' : 'transparent',
        backdropFilter: isMediaLayout ? 'blur(12px)' : 'none',
        boxShadow: isMediaLayout ? '0 6px 18px rgba(2, 6, 23, 0.24)' : 'none',
        pointerEvents: isInlineLayout ? 'none' : 'auto',
      }}
    >
      <Typography
        variant="caption"
        title={message?.edited_at
          ? `${formatFullDate(message?.created_at)} · изменено ${formatFullDate(message?.edited_at)}`
          : formatFullDate(message?.created_at)}
        sx={{ color: receiptColor, fontSize: density.bubbleMetaFontSize || CHAT_DEFAULT_FONT_SIZES.meta, lineHeight: 1, fontFamily: CHAT_FONT_FAMILY, whiteSpace: 'nowrap' }}
      >
        {formatMessageMetaLabel(message)}
      </Typography>

      {shouldShowUploadProgress ? (
        <Typography variant="caption" sx={{ color: receiptColor, fontSize: density.bubbleMetaFontSize || CHAT_DEFAULT_FONT_SIZES.meta, lineHeight: 1, fontWeight: 700, fontFamily: CHAT_FONT_FAMILY }}>
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

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

function ReactionPill({ r, reacted, onToggleReaction, ui, theme, compact, isOwn }) {
  const accentColor = ui.accentText || theme.palette.primary.main;
  const isDark = theme.palette.mode === 'dark';
  const count = Number(r?.count || 0);
  const showCount = !compact || count > 1;
  const idleBg = isOwn
    ? alpha('#0f2538', isDark ? 0.7 : 0.28)
    : alpha('#020617', isDark ? 0.46 : 0.1);
  const compactEmojiSize = 13;
  const regularEmojiSize = reacted ? 18 : 17;
  return (
    <Box
      component="button"
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggleReaction?.(r.emoji); }}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: compact ? '1px' : '4px',
        px: compact ? '1px' : '8px',
        py: compact ? 0 : '3px',
        minWidth: compact ? 14 : 'auto',
        minHeight: compact ? 16 : 25,
        borderRadius: 999,
        border: compact
          ? 'none'
          : reacted ? `1px solid ${alpha(accentColor, 0.56)}` : `1px solid ${alpha(isDark ? '#fff' : '#000', 0.1)}`,
        bgcolor: compact
          ? 'transparent'
          : reacted ? alpha(accentColor, isDark ? 0.24 : 0.12) : idleBg,
        cursor: 'pointer',
        fontSize: compact ? `${compactEmojiSize}px` : `${regularEmojiSize}px`,
        fontFamily: 'inherit',
        lineHeight: 1,
        boxShadow: compact
          ? 'none'
          : reacted ? `0 3px 10px ${alpha(accentColor, 0.16)}` : '0 2px 7px rgba(2, 6, 23, 0.14)',
        transition: 'background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease, transform 80ms ease',
        '&:hover': {
          bgcolor: compact
            ? 'transparent'
            : reacted ? alpha(accentColor, isDark ? 0.28 : 0.16) : alpha(isDark ? '#fff' : '#000', isDark ? 0.16 : 0.09),
        },
        '&:active': { transform: 'scale(0.95)' },
      }}
    >
      <span
        data-testid="chat-reaction-emoji"
        style={{
          display: 'inline-block',
          lineHeight: 1,
          fontSize: compact ? `${compactEmojiSize}px` : `${regularEmojiSize}px`,
          fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
          filter: 'drop-shadow(0 1px 1px rgba(2, 6, 23, 0.24))',
          transform: reacted ? 'translateY(-0.5px)' : 'none',
        }}
      >
        {r.emoji}
      </span>
      {showCount ? (
        <Typography component="span" sx={{ fontSize: compact ? '11px' : '12px', fontWeight: 700, color: reacted ? accentColor : (isDark ? alpha('#fff', 0.78) : alpha('#000', 0.55)), lineHeight: 1, minWidth: '7px', textAlign: 'center' }}>
          {r.count}
        </Typography>
      ) : null}
    </Box>
  );
}

function ReactionsBar({ reactions, currentUserId, onToggleReaction, ui, theme, compactMobile, isOwn }) {
  const items = Array.isArray(reactions) ? reactions : [];
  if (items.length === 0) return null;
  return (
    <Stack
      data-testid="chat-reactions-bar"
      direction="row"
      flexWrap="wrap"
      sx={{
        alignItems: 'center',
        pt: compactMobile ? '2px' : 0,
        pb: compactMobile ? '2px' : 0,
        px: compactMobile ? '5px' : 0,
        gap: compactMobile ? '1px' : '3px',
        justifyContent: 'flex-start',
        minWidth: 0,
        width: 'fit-content',
        mr: 'auto',
        borderRadius: compactMobile ? 999 : 0,
        bgcolor: compactMobile
          ? (isOwn ? alpha('#0b1724', theme.palette.mode === 'dark' ? 0.46 : 0.2) : alpha('#020617', theme.palette.mode === 'dark' ? 0.42 : 0.09))
          : 'transparent',
        backgroundImage: compactMobile
          ? `linear-gradient(180deg, ${alpha('#fff', theme.palette.mode === 'dark' ? 0.08 : 0.3)}, ${alpha('#fff', 0)})`
          : 'none',
        border: compactMobile ? `1px solid ${alpha(theme.palette.mode === 'dark' ? '#fff' : '#000', theme.palette.mode === 'dark' ? 0.1 : 0.06)}` : 'none',
        boxShadow: compactMobile
          ? '0 2px 7px rgba(2, 6, 23, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.08)'
          : 'none',
        backdropFilter: compactMobile ? 'blur(6px)' : 'none',
      }}
    >
      {items.map((r) => {
        const reacted = Array.isArray(r.user_ids) && r.user_ids.includes(currentUserId);
        return (
          <Tooltip key={r.emoji} title={`${r.emoji} ${r.count}`} placement="top">
            <span>
              <ReactionPill r={r} reacted={reacted} onToggleReaction={onToggleReaction} ui={ui} theme={theme} compact={compactMobile} isOwn={isOwn} />
            </span>
          </Tooltip>
        );
      })}
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
  onToggleReaction,
  onToggleReactionRaw,
  onScrollToMessage,
  currentUserId,
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
  const bodyFormat = String(message?.body_format || '').trim();
  const hasExplicitBodyFormat = bodyFormat === 'plain' || bodyFormat === 'markdown';
  const isMarkdownBody = bodyFormat === 'markdown'
    || (!hasExplicitBodyFormat && message?.kind === 'text' && attachments.length === 0 && detectChatBodyFormat(body) === 'markdown');
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
  const density = ui.density || {};
  const senderAccentColor = showSender ? resolveGroupSenderColor(message?.sender, theme, ui) : ui.accentText;
  const messageBodyFontSize = getChatBubbleBodyFontSize(ui, compactMobile);
  const messageBodyLineHeight = getChatBubbleBodyLineHeight(ui, compactMobile);
  const bubbleBodyBottomPadding = density.bubbleBodyBottomPadding ?? 1.8;
  const bubbleReactionBodyBottomPadding = density.bubbleReactionBodyBottomPadding ?? 0.35;
  const inlineMeta = !task
    && attachments.length === 0
    && emojiOnlyCount === 0
    && !isMarkdownBody
    && !hasReplyPreview
    && !hasForwardPreview
    && isShortInlineMessage(body, { compactMobile });
  const receiptColor = message?.is_own
    ? (deliveryStatus === 'read' && !isSending
      ? (ui.statusReadText || alpha(ownMetaColor, 0.96))
      : alpha(ownMetaColor, isSending ? 0.72 : 0.86))
    : alpha(ui.textSecondary, 0.9);
  const bubbleBg = message?.is_own ? ui.bubbleOwnBg : ui.bubbleOtherBg;
  const bubbleText = message?.is_own ? ui.bubbleOwnText : ui.bubbleOtherText;
  const linkColors = resolveChatBubbleLinkColors(ui, Boolean(message?.is_own));
  const linkColor = linkColors.text || ui.accentText || theme.palette.primary.main;
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
  const resolvedMessageId = String(message?.id || '').trim();
  const handleToggleReaction = useCallback((emoji) => {
    if (onToggleReaction) return onToggleReaction(emoji);
    if (onToggleReactionRaw) return onToggleReactionRaw(resolvedMessageId, emoji);
  }, [onToggleReaction, onToggleReactionRaw, resolvedMessageId]);
  const effectiveToggleReaction = onToggleReaction || (onToggleReactionRaw && resolvedMessageId) ? handleToggleReaction : undefined;
  const showQuickActions = !selectionMode && !compactMobile && emojiOnlyCount === 0 && (typeof onOpenMessageMenu === 'function' || typeof effectiveToggleReaction === 'function');
  const shouldAnimateBubble = shouldAnimateChatBubble({
    prefersReducedMotion,
    compactMobile,
    isOwn: Boolean(message?.is_own),
    isOptimistic: Boolean(message?.isOptimistic),
    isSending,
  });
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const reactionPickerRef = useRef(null);
  const swipeRef = useRef({ startX: 0, startY: 0, active: false, triggered: false });
  const [swipeDx, setSwipeDx] = useState(0);
  const SWIPE_TRIGGER = 38;
  const SWIPE_MAX = 52;
  useEffect(() => {
    if (!reactionPickerOpen) return undefined;
    const handleOutside = (e) => {
      if (reactionPickerRef.current && !reactionPickerRef.current.contains(e.target)) {
        setReactionPickerOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutside, true);
    return () => window.removeEventListener('mousedown', handleOutside, true);
  }, [reactionPickerOpen]);

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
    const hasAttachments = attachments.length > 0 || pureMediaBubble;
    if (compactMobile && hasAttachments) {
      if (typeof onStartMessageSelection === 'function') {
        onStartMessageSelection(message);
      }
      if (typeof onOpenMessageMenu === 'function') {
        onOpenMessageMenu(message, target);
      }
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
    if (compactMobile && touch) {
      swipeRef.current = { startX: touch.clientX, startY: touch.clientY, active: true, triggered: false };
    }
    scheduleLongPress({
      x: Number(touch?.clientX || 0),
      y: Number(touch?.clientY || 0),
      target: event?.currentTarget || null,
      source: 'touch',
    });
  };  const handleSwipeMove = (event) => {
    if (!compactMobile || !swipeRef.current.active) return;
    const touch = event?.touches?.[0];
    if (!touch) return;
    const dx = touch.clientX - swipeRef.current.startX;
    const dy = Math.abs(touch.clientY - swipeRef.current.startY);
    if (dy > 20) { swipeRef.current.active = false; setSwipeDx(0); return; }
    if (dx < 0) {
      const clamped = Math.min(Math.abs(dx), SWIPE_MAX);
      setSwipeDx(clamped);
      if (clamped >= SWIPE_TRIGGER && !swipeRef.current.triggered) {
        swipeRef.current.triggered = true;
        if (navigator.vibrate) navigator.vibrate(30);
      }
    }
  };
  const handleSwipeEnd = () => {
    if (!compactMobile) return;
    if (swipeRef.current.triggered) {
      onReplyMessage?.(message);
    }
    swipeRef.current = { startX: 0, startY: 0, active: false, triggered: false };
    setSwipeDx(0);
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

  const hasAudioAttachments = attachments.length > 0
    && attachments.some((attachment) => isAudioAttachment(attachment));
  const mediaOnlyAttachments = attachments.length > 0
    && !hasAudioAttachments
    && attachments.every((attachment) => isImageAttachment(attachment) || isVideoAttachment(attachment));
  const imageOnlyGallery = attachments.length > 1 && attachments.every((attachment) => isImageAttachment(attachment));
  const showMediaMetaOverlay = mediaOnlyAttachments && !attachmentCaption;
  const pureMediaBubble = mediaOnlyAttachments && !attachmentCaption;
  const hasReactions = Array.isArray(message?.reactions) && message.reactions.length > 0;
  const reactionFooter = hasReactions && !showMediaMetaOverlay;
  const textMetaInFlow = !compactMobile
    && !inlineMeta
    && !task
    && attachments.length === 0
    && emojiOnlyCount === 0
    && Boolean(body)
    && !showMediaMetaOverlay;
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
        pt: showSender ? (density.bubbleSenderRowPt ?? 0.35) : groupedWithPrevious ? '2px' : (density.bubbleRowPt ?? 1.1),
        pb: groupedWithNext ? '2px' : 0.42,
        pl: 0,
        pr: 0,
        mx: 0,
        borderRadius: 0,
        bgcolor: selected && !compactMobile ? alpha(ui.accentText || theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.12) : 'transparent',
        cursor: selectionMode ? 'pointer' : 'default',
        animation: shouldAnimateBubble ? `${messageAppear} 150ms ease-out` : 'none',
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
            width: compactMobile ? 44 : 26,
            height: compactMobile ? 44 : 26,
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

      {compactMobile && swipeDx > 8 ? (
        <Box sx={{
          position: 'absolute',
          right: -36,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 28,
          height: 28,
          borderRadius: '50%',
          bgcolor: alpha(ui.accentText || theme.palette.primary.main, 0.15),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: Math.min(swipeDx / SWIPE_TRIGGER, 1),
          transition: 'opacity 80ms ease',
          pointerEvents: 'none',
        }}>
          <ReplyRoundedIcon sx={{ fontSize: 16, color: ui.accentText || theme.palette.primary.main }} />
        </Box>
      ) : null}

      {showSender ? (
        <Typography
          variant="caption"
          className="px-3 pb-1 text-[14px] font-medium leading-[1.15]"
          sx={{
            color: senderAccentColor,
            fontFamily: CHAT_FONT_FAMILY,
            fontSize: density.bubbleSenderFontSize || CHAT_DEFAULT_FONT_SIZES.sender,
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
        onClick={compactMobile && !selectionMode && !pureMediaBubble && attachments.length === 0 && typeof onOpenMessageMenu === 'function' ? (event) => {
          if (longPressGestureRef.current.handled) return;
          onOpenMessageMenu(message, event.currentTarget);
        } : undefined}
        onPointerDown={startPointerLongPress}
        onPointerMove={handlePointerLongPressMove}
        onPointerUp={clearLongPress}
        onPointerCancel={handlePointerCancel}
        onTouchStart={startLongPress}
        onTouchEnd={(e) => { clearLongPress(e); handleSwipeEnd(); }}
        onTouchCancel={(e) => { handleTouchCancel(e); handleSwipeEnd(); }}
        onTouchMove={(e) => { handleLongPressMove(e); handleSwipeMove(e); }}
        className={joinClasses('relative transition duration-100', compactMobile ? 'active:opacity-90' : '', reactionPickerOpen ? 'reaction-picker-open' : '')}
        sx={{
          width: hasAudioAttachments ? { xs: '72vw', md: '340px' } : bubbleWidth,
          maxWidth: bubbleMaxWidth,
          ml: selectionMode && !message?.is_own ? { xs: 5, md: 4.2 } : 0,
          transform: swipeDx > 0 ? `translateX(-${swipeDx}px)` : undefined,
          px: task ? 0.62 : pureMediaBubble ? 0.14 : attachments.length > 0 ? 0.62 : emojiOnlyCount ? 0.18 : (density.bubblePx || 1.18),
          py: task ? 0.62 : pureMediaBubble ? 0.14 : attachments.length > 0 ? 0.62 : emojiOnlyCount ? 0.08 : (density.bubblePy || 0.82),
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
          transition: swipeDx > 0 ? 'none' : 'background-color 120ms ease, box-shadow 120ms ease, transform 120ms ease, outline-color 120ms ease',
          '&:hover .chat-bubble-actions, &.reaction-picker-open .chat-bubble-actions': {
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
            {typeof effectiveToggleReaction === 'function' ? (
              <Box ref={reactionPickerRef} sx={{ position: 'relative' }}>
                <Tooltip title="Реакция">
                  <button
                    type="button"
                    aria-label="Реакция"
                    onClick={(event) => { event.stopPropagation(); setReactionPickerOpen((v) => !v); }}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full transition duration-100 active:scale-[0.96]"
                    style={{
                      color: ui.textPrimary,
                      backgroundColor: alpha(ui.surfaceStrong || '#ffffff', theme.palette.mode === 'dark' ? 0.92 : 0.96),
                      boxShadow: ui.shadowSoft,
                      border: `1px solid ${ui.borderSoft}`,
                    }}
                  >
                    <AddReactionRoundedIcon sx={{ fontSize: 15 }} />
                  </button>
                </Tooltip>
                {reactionPickerOpen ? (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: -44,
                      ...(message?.is_own ? { right: 0 } : { left: 0 }),
                      zIndex: 10,
                      display: 'flex',
                      gap: '4px',
                      bgcolor: alpha(ui.surfaceStrong || '#fff', theme.palette.mode === 'dark' ? 0.96 : 0.98),
                      borderRadius: 999,
                      px: 1,
                      py: 0.5,
                      boxShadow: ui.shadowSoft,
                      border: `1px solid ${ui.borderSoft}`,
                    }}
                  >
                    {QUICK_REACTIONS.map((emoji) => (
                      <Box
                        key={emoji}
                        component="button"
                        type="button"
                        onClick={(e) => { e.stopPropagation(); effectiveToggleReaction(emoji); setReactionPickerOpen(false); }}
                        sx={{ fontSize: '20px', lineHeight: 1, cursor: 'pointer', border: 'none', bgcolor: 'transparent', px: '2px', borderRadius: 1, '&:hover': { transform: 'scale(1.25)' }, transition: 'transform 100ms ease' }}
                      >
                        {emoji}
                      </Box>
                    ))}
                  </Box>
                ) : null}
              </Box>
            ) : null}
            {!compactMobile ? (
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
            ) : null}
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
        <ReplyPreviewBlock replyPreview={message?.reply_preview} theme={theme} ui={ui} isOwn={Boolean(message?.is_own)} compactMobile={compactMobile} onScrollToMessage={onScrollToMessage} />

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
                        isSending={isSending}
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
                      isSending={isSending}
                    />
                  ))}
                </Stack>
              )}
              {showMediaMetaOverlay ? (
                <Box
                  data-testid="chat-media-meta-hover"
                  sx={{
                    position: 'absolute',
                    right: 2,
                    bottom: 2,
                    opacity: { xs: 1, md: 0 },
                    transition: 'opacity 180ms ease',
                    '[data-chat-bubble-surface]:hover &': { opacity: 1 },
                    pointerEvents: 'none',
                  }}
                >
                  {renderMessageMeta('media')}
                </Box>
              ) : null}
            </Box>
            {attachmentCaption ? (
              <Box
                component="p"
                className="chat-selectable"
                data-chat-message-body="true"
                style={{ fontSize: messageBodyFontSize }}
                sx={{
                  m: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  ...buildChatMessageBodySurfaceSx(messageBodyFontSize, messageBodyLineHeight),
                  color: bubbleText,
                  userSelect: 'text',
                  fontFamily: CHAT_FONT_FAMILY,
                  letterSpacing: '-0.01em',
                }}
              >
                {attachmentCaption}
              </Box>
            ) : null}
          </Stack>
        ) : isMarkdownBody ? (
          <ChatMarkdownBody
            value={message?.body}
            bubbleText={bubbleText}
            linkColor={linkColor}
            hasMarkdownTable={hasMarkdownTable}
            compactMobile={compactMobile}
            ui={ui}
          />
        ) : (
          <Box
            component="p"
            className="chat-selectable"
            data-chat-message-body="true"
            data-chat-emoji-only={emojiOnlyCount ? 'true' : undefined}
            style={{ fontSize: emojiOnlyCount ? undefined : messageBodyFontSize }}
            sx={{
              m: 0,
              display: 'block',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              pr: inlineMeta ? 0 : 0.25,
              pb: inlineMeta ? 0 : textMetaInFlow ? 0.25 : (reactionFooter ? bubbleReactionBodyBottomPadding : bubbleBodyBottomPadding),
              ...(emojiOnlyCount
                ? { lineHeight: 1.08, fontSize: emojiOnlyCount === 1 ? '3.2rem' : '2.6rem' }
                : buildChatMessageBodySurfaceSx(messageBodyFontSize, messageBodyLineHeight)),
              color: bubbleText,
              userSelect: 'text',
              fontFamily: CHAT_FONT_FAMILY,
              letterSpacing: emojiOnlyCount ? undefined : '-0.01em',
              '&::after': inlineMeta ? {
                content: '""',
                display: 'inline-block',
                width: getInlineMetaReserveWidth({
                  compactMobile,
                  isOwnDirect,
                  edited: Boolean(String(message?.edited_at || '').trim()),
                }),
                height: '0.9em',
              } : undefined,
            }}
          >
            {renderChatPlainTextBody(message?.body, {
              mentionColor: ui.accentText || theme.palette.primary.main,
              linkColor,
            })}
          </Box>
        )}

        {!task && attachments.length === 0 && emojiOnlyCount === 0 && body && extractFirstUrl(body) ? (
          <ChatLinkPreview
            url={extractFirstUrl(body)}
            theme={theme}
            ui={ui}
            isOwn={Boolean(message?.is_own)}
          />
        ) : null}

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

        {(() => {
          const reactionBar = (
            <ReactionsBar
              reactions={message?.reactions}
              currentUserId={currentUserId}
              onToggleReaction={effectiveToggleReaction}
              ui={ui}
              theme={theme}
              compactMobile={compactMobile}
              isOwn={message?.is_own}
            />
          );

          const bubbleMeta = !showMediaMetaOverlay ? (
            <ChatBubbleMeta
              layout={reactionFooter ? 'bottom' : inlineMeta ? 'inline' : 'bottom'}
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
              inFlow={reactionFooter || textMetaInFlow || (attachments.length > 0 && !showMediaMetaOverlay)}
              dense={reactionFooter || textMetaInFlow}
            />
          ) : null;

          if (reactionFooter) {
            return (
              <Stack
                data-testid="chat-bubble-reaction-footer"
                direction="row"
                alignItems="flex-end"
                sx={{
                  mt: compactMobile ? '2px' : '3px',
                  minHeight: compactMobile ? 18 : 22,
                  gap: 0.75,
                }}
              >
                {reactionBar}
                {bubbleMeta}
              </Stack>
            );
          }

          return (
            <>
              {reactionBar}
              {bubbleMeta}
            </>
          );
        })()}
      </Box>
    </Box>
  );
}

export const MemoChatBubble = memo(ChatBubble);
