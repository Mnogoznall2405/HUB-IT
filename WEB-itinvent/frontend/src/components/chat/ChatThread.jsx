import { keyframes } from '@emotion/react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Badge,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import TextareaAutosize from '@mui/material/TextareaAutosize';
import { alpha } from '@mui/material/styles';
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded';
import DoneRoundedIcon from '@mui/icons-material/DoneRounded';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import ForwardRoundedIcon from '@mui/icons-material/ForwardRounded';
import InsertEmoticonRoundedIcon from '@mui/icons-material/InsertEmoticonRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded';
import ReplyRoundedIcon from '@mui/icons-material/ReplyRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import { AttachmentCard, PresenceAvatar, TaskShareCard } from './ChatCommon';
import ChatFileUploadPanel from './ChatFileUploadPanel';
import { useMainLayoutShell } from '../layout/MainLayoutShellContext';
import MarkdownRenderer from '../hub/MarkdownRenderer';
import {
  buildTimelineItems,
  CHAT_THREAD_NEAR_BOTTOM_DISTANCE_PX,
  formatFullDate,
  formatFileSize,
  formatShortTime,
  detectChatBodyFormat,
  getEmojiOnlyCount,
  getDateDividerLabel,
  getReplyPreviewText,
  getSearchResultPreview,
  getPersonStatusLine,
  hasChatMarkdownTable,
  isImageAttachment,
} from './chatHelpers';

const GROUP_WINDOW_MS = 10 * 60 * 1000;
const COMPOSER_STICK_DISTANCE_PX = CHAT_THREAD_NEAR_BOTTOM_DISTANCE_PX;
const BLUR_SCROLL_DELTA_PX = 12;
const LONG_PRESS_SCROLL_CANCEL_PX = 30;
const LONG_PRESS_HORIZONTAL_CANCEL_PX = 44;
const BACK_SWIPE_EDGE_PX = 28;
const BACK_SWIPE_START_PX = 14;
const BACK_SWIPE_TRIGGER_PX = 84;
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
  previewLabel: '12px',
  previewTitle: '14px',
  previewBody: '13px',
  sender: '15px',
  body: '17px',
  headerTitleMobile: '17.5px',
  headerSubtitleMobile: '13px',
  composer: '17px',
  composerAux: '13px',
};
const LIGHT_GROUP_SENDER_COLORS = ['#d45246', '#c97a00', '#2f8b44', '#387adf', '#8b4ccf', '#0f9d8a', '#c95d9c', '#468fba'];
const DARK_GROUP_SENDER_COLORS = ['#ff7b73', '#f6c15c', '#7de26f', '#6bb6ff', '#c59bff', '#64e1cf', '#ff99dc', '#7bd7ff'];

export const getChatKeyboardBottomSpacer = ({ compactMobile = false, keyboardInset = 0, composerHeight = 0 } = {}) => {
  if (!compactMobile || Number(keyboardInset || 0) <= 0) return 0;
  const measuredComposerHeight = Number(composerHeight || 0);
  const baseGap = Number.isFinite(measuredComposerHeight) && measuredComposerHeight > 0
    ? Math.round(measuredComposerHeight * 0.18)
    : 12;
  return Math.max(16, Math.min(32, baseGap));
};

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

const MENTION_QUERY_LIMIT = 32;
const MENTION_RESULT_LIMIT = 8;
const MENTION_TEXT_PATTERN = /(@[0-9A-Za-zА-Яа-яЁё_.-]+)/g;

function getPersonDisplayName(person) {
  return String(person?.full_name || person?.name || person?.username || '').trim();
}

function getPersonMentionHandle(person) {
  const username = String(person?.username || '').trim().replace(/^@+/, '');
  if (username) return username;
  return getPersonDisplayName(person)
    .replace(/\s+/g, '_')
    .replace(/[^0-9A-Za-zА-Яа-яЁё_.-]+/g, '')
    .slice(0, 48);
}

function getPersonInitials(person) {
  const name = getPersonDisplayName(person);
  if (!name) return '@';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function normalizeMentionSearch(value) {
  return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

function filterMentionCandidates(candidates, query, limit = MENTION_RESULT_LIMIT) {
  const normalizedQuery = normalizeMentionSearch(query);
  const seen = new Set();
  const result = [];
  (Array.isArray(candidates) ? candidates : []).forEach((candidate) => {
    const person = candidate?.user || candidate;
    const id = Number(person?.id || 0);
    const handle = getPersonMentionHandle(person);
    const displayName = getPersonDisplayName(person);
    if (!handle && !displayName) return;
    const key = id > 0 ? `id:${id}` : `handle:${handle.toLowerCase()}`;
    if (seen.has(key)) return;
    const haystack = `${handle} ${displayName}`.toLowerCase();
    if (normalizedQuery && !haystack.includes(normalizedQuery)) return;
    seen.add(key);
    result.push(person);
  });
  return result.slice(0, limit);
}

export function getComposerMentionTrigger(value, caretPosition) {
  const text = String(value || '');
  const caret = Math.max(0, Math.min(Number(caretPosition ?? text.length), text.length));
  const beforeCaret = text.slice(0, caret);
  const atIndex = beforeCaret.lastIndexOf('@');
  if (atIndex < 0) return null;
  const charBeforeAt = atIndex > 0 ? beforeCaret[atIndex - 1] : '';
  if (charBeforeAt && !/\s/.test(charBeforeAt)) return null;
  const query = beforeCaret.slice(atIndex + 1);
  if (query.length > MENTION_QUERY_LIMIT || /\s/.test(query)) return null;
  return {
    start: atIndex,
    end: caret,
    query,
  };
}

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

function ChatSkeleton({ width = '100%', height = 16, radius = 999, sx = {} }) {
  return (
    <Skeleton
      variant="rounded"
      animation="wave"
      width={width}
      height={height}
      sx={{
        borderRadius: radius,
        bgcolor: 'var(--chat-skeleton-base, rgba(148,163,184,0.16))',
        '&::after': {
          background: 'linear-gradient(90deg, transparent, var(--chat-skeleton-wave, rgba(255,255,255,0.36)), transparent)',
        },
        ...sx,
      }}
    />
  );
}

function ThreadLoadingSkeleton({ compactMobile = false }) {
  const rows = compactMobile
    ? [
      { side: 'left', width: '64%', lines: [0.72, 0.42] },
      { side: 'right', width: '74%', lines: [0.88, 0.58] },
      { side: 'left', width: '48%', lines: [0.56] },
      { side: 'right', width: '68%', lines: [0.78, 0.36] },
    ]
    : [
      { side: 'left', width: '42%', lines: [0.7, 0.54] },
      { side: 'right', width: '48%', lines: [0.92, 0.62] },
      { side: 'left', width: '35%', lines: [0.58] },
      { side: 'right', width: '44%', lines: [0.78, 0.4] },
    ];

  return (
    <Stack spacing={1.2} sx={{ px: { xs: 1, md: 3 }, py: 3 }}>
      <Stack alignItems="center" sx={{ py: 0.5 }}>
        <ChatSkeleton width={94} height={24} radius={999} />
      </Stack>
      {rows.map((row, index) => (
        <Stack key={`${row.side}-${index}`} alignItems={row.side === 'right' ? 'flex-end' : 'flex-start'}>
          <Box
            sx={{
              width: row.width,
              maxWidth: compactMobile ? '82vw' : 440,
              px: 1.4,
              py: 1.15,
              borderRadius: row.side === 'right' ? '18px 18px 5px 18px' : '18px 18px 18px 5px',
              bgcolor: row.side === 'right' ? 'var(--chat-skeleton-own-bg, rgba(217,253,211,0.54))' : 'var(--chat-skeleton-other-bg, rgba(255,255,255,0.62))',
              boxShadow: 'var(--chat-skeleton-shadow, none)',
            }}
          >
            <Stack spacing={0.8}>
              {row.lines.map((lineWidth, lineIndex) => (
                <ChatSkeleton
                  key={lineIndex}
                  width={`${Math.round(lineWidth * 100)}%`}
                  height={lineIndex === 0 ? 15 : 13}
                  radius={8}
                />
              ))}
              <Stack alignItems="flex-end">
                <ChatSkeleton width={42} height={10} radius={999} />
              </Stack>
            </Stack>
          </Box>
        </Stack>
      ))}
    </Stack>
  );
}

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

function shouldGroupMessages(previousMessage, nextMessage) {
  if (!previousMessage || !nextMessage) return false;
  if (Boolean(previousMessage?.is_own) !== Boolean(nextMessage?.is_own)) return false;
  if (String(previousMessage?.kind || '') !== String(nextMessage?.kind || '')) return false;
  const previousSenderId = String(previousMessage?.sender?.id || previousMessage?.sender_id || '').trim();
  const nextSenderId = String(nextMessage?.sender?.id || nextMessage?.sender_id || '').trim();
  if ((previousSenderId || nextSenderId) && previousSenderId !== nextSenderId) return false;
  const previousDate = new Date(previousMessage?.created_at || '');
  const nextDate = new Date(nextMessage?.created_at || '');
  if (Number.isNaN(previousDate.getTime()) || Number.isNaN(nextDate.getTime())) return false;
  if (previousDate.toDateString() !== nextDate.toDateString()) return false;
  return (nextDate.getTime() - previousDate.getTime()) <= GROUP_WINDOW_MS;
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

function formatSelectedMessageCount(count = 0) {
  const normalizedCount = Math.max(0, Number(count || 0));
  const mod100 = normalizedCount % 100;
  const mod10 = normalizedCount % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${normalizedCount} сообщений`;
  if (mod10 === 1) return `${normalizedCount} сообщение`;
  if (mod10 >= 2 && mod10 <= 4) return `${normalizedCount} сообщения`;
  return `${normalizedCount} сообщений`;
}

function HeaderAction({ title, children, onClick, active = false, compactMobile = false, hidden = false, disabled = false }) {
  if (hidden) return null;
  return (
    <Tooltip title={title}>
      <span>
        <IconButton
          size="small"
          aria-label={title}
          onClick={onClick}
          disabled={disabled}
          sx={{
            width: compactMobile ? 32 : 34,
            height: compactMobile ? 32 : 34,
            borderRadius: 0,
            color: active ? 'var(--chat-action-active-text)' : 'inherit',
            bgcolor: 'transparent',
            transition: 'opacity 100ms ease, background-color 120ms ease, transform 120ms ease',
            ...(compactMobile ? {
              '&:active': {
                opacity: 0.62,
                transform: 'scale(0.96)',
              },
            } : {
              '&:hover': {
                bgcolor: active ? 'var(--chat-action-active-bg)' : 'var(--chat-action-hover-bg)',
              },
            }),
            '&.Mui-disabled': {
              opacity: 0.36,
              color: 'inherit',
            },
          }}
        >
          {children}
        </IconButton>
      </span>
    </Tooltip>
  );
}

function TimelineMarker({ label, tone, stickyOffset = 0, dataTestId, isDateMarker = false, compactMobile = false }) {
  // На мобильном date-маркеры в потоке — не sticky (sticky только одна наверху)
  if (isDateMarker && compactMobile) {
    return (
      <div
        data-testid={dataTestId}
        data-date-marker
        data-date-label={label}
        className="flex justify-center py-1.5"
      >
        <div
          className="rounded-full border px-2 py-0.5 text-[11px] font-semibold backdrop-blur-xl"
          style={{
            backgroundColor: tone.bg,
            color: tone.text,
            boxShadow: tone.shadow,
            borderColor: tone.border || 'transparent',
            minWidth: '70px',
            textAlign: 'center',
          }}
        >
          {label}
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid={dataTestId}
      className="pointer-events-none sticky z-50 flex justify-center py-1.5"
      style={{ top: stickyOffset }}
    >
      <div
        className="rounded-full border px-2 py-0.5 text-[11px] font-semibold backdrop-blur-xl"
        style={{
          backgroundColor: tone.bg,
          color: tone.text,
          boxShadow: tone.shadow,
          borderColor: tone.border || 'transparent',
          minWidth: '70px',
          textAlign: 'center',
        }}
      >
        {label}
      </div>
    </div>
  );
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

function AiRunStatusBanner({ aiStatus, theme, ui, compactMobile = false }) {
  const status = String(aiStatus?.status || '').trim();
  if (!status || status === 'completed') return null;
  const label = status === 'queued'
    ? 'AI поставлен в очередь'
    : status === 'running'
      ? 'AI анализирует запрос и файлы'
      : 'AI не смог обработать запрос';
  const tone = status === 'failed'
    ? {
      bg: alpha(theme.palette.error.main, theme.palette.mode === 'dark' ? 0.16 : 0.1),
      border: alpha(theme.palette.error.main, 0.22),
      text: theme.palette.error.main,
    }
    : {
      bg: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.1),
      border: alpha(theme.palette.primary.main, 0.22),
      text: ui.accentText,
    };
  return (
    <Box
      sx={{
        px: compactMobile ? 1.5 : 2,
        py: 1.1,
        borderBottom: `1px solid ${ui.borderSoft}`,
        backgroundColor: tone.bg,
      }}
    >
      <Typography sx={{ fontSize: compactMobile ? 13 : 13.5, fontWeight: 700, color: tone.text, fontFamily: TELEGRAM_CHAT_FONT_FAMILY }}>
        {label}
      </Typography>
      {status === 'failed' && aiStatus?.error_text ? (
        <Typography sx={{ mt: 0.4, fontSize: 12.5, color: ui.textSecondary, fontFamily: TELEGRAM_CHAT_FONT_FAMILY }}>
          {aiStatus.error_text}
        </Typography>
      ) : null}
    </Box>
  );
}

function AiInteractiveStatusBanner({ aiStatusDisplay, theme, ui, compactMobile = false }) {
  if (!aiStatusDisplay?.visible) return null;
  const tone = aiStatusDisplay.tone === 'error'
    ? {
      bg: alpha(theme.palette.error.main, theme.palette.mode === 'dark' ? 0.16 : 0.1),
      border: alpha(theme.palette.error.main, 0.22),
      text: theme.palette.error.main,
    }
    : {
      bg: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.1),
      border: alpha(theme.palette.primary.main, 0.22),
      text: ui.accentText,
    };
  return (
    <motion.div
      key={`${aiStatusDisplay.status}:${aiStatusDisplay.stage}:${aiStatusDisplay.primaryText}`}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      <Box
        sx={{
          px: compactMobile ? 1.5 : 2,
          py: 1.1,
          borderBottom: `1px solid ${ui.borderSoft}`,
          backgroundColor: tone.bg,
        }}
      >
        <Stack direction="row" spacing={1.1} alignItems="flex-start">
          {aiStatusDisplay.showSpinner ? (
            <CircularProgress
              size={compactMobile ? 15 : 16}
              thickness={5}
              sx={{ mt: 0.15, color: tone.text, flexShrink: 0 }}
            />
          ) : (
            <SmartToyOutlinedIcon sx={{ mt: 0.05, fontSize: 17, color: tone.text, flexShrink: 0 }} />
          )}
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: compactMobile ? 13 : 13.5, fontWeight: 700, color: tone.text, fontFamily: TELEGRAM_CHAT_FONT_FAMILY }}>
              {aiStatusDisplay.primaryText}
            </Typography>
            {aiStatusDisplay.secondaryText ? (
              <Typography sx={{ mt: 0.4, fontSize: 12.5, color: ui.textSecondary, fontFamily: TELEGRAM_CHAT_FONT_FAMILY }}>
                {aiStatusDisplay.secondaryText}
              </Typography>
            ) : null}
          </Box>
        </Stack>
      </Box>
    </motion.div>
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

  const renderMessageMeta = (layout = 'bottom') => {
    const isInlineLayout = layout === 'inline';
    const isMediaLayout = layout === 'media';
    const uploadProgress = Number(message?.uploadProgress || 0);
    const showUploadProgress = isSending && Number.isFinite(uploadProgress) && uploadProgress > 0 && uploadProgress < 100;
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
          bottom: isMediaLayout ? 10 : (isInlineLayout ? 4 : 5),
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

        {showUploadProgress ? (
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
  };

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
        <Stack
          data-testid={inlineMeta ? 'chat-bubble-meta-inline' : 'chat-bubble-meta-bottom'}
          data-chat-meta-layout={inlineMeta ? 'inline' : 'bottom'}
          direction="row"
          spacing={0.3}
          justifyContent="flex-end"
          alignItems="center"
          sx={{
            position: 'absolute',
            right: inlineMeta ? 10 : 12,
            bottom: 7,
            pointerEvents: inlineMeta ? 'none' : 'auto',
          }}
        >
          {false && !inlineMeta && isOwnGroup && readByCount > 0 ? (
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

          {false && !compactMobile && !inlineMeta ? (
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

          {isOwnDirect ? (
            isSending
              ? <CircularProgress size={13} thickness={5} sx={{ color: receiptColor }} />
              : deliveryStatus === 'read'
                ? <DoneAllRoundedIcon sx={{ fontSize: 15, color: receiptColor }} />
                : <DoneRoundedIcon sx={{ fontSize: 15, color: receiptColor }} />
          ) : null}
        </Stack>
        ) : null}
      </Box>
    </Box>
  );
}

const MemoChatBubble = memo(ChatBubble);

const ChatThreadHeader = memo(function ChatThreadHeader({
  theme,
  ui,
  isMobile,
  compactMobile,
  activeConversation,
  headerSubtitle,
  typingLine,
  contextPanelOpen,
  onBack,
  onOpenDrawer,
  onOpenInfo,
  onOpenSearch,
  onOpenMenu,
  selectionMode = false,
  selectedMessageCount = 0,
  canCopySelectedMessages = false,
  onClearMessageSelection,
  onCopySelectedMessages,
  onForwardSelectedMessages,
}) {
  const headerShellSx = {
    px: { xs: compactMobile ? 0.65 : 1.15, md: 1.6 },
    pb: compactMobile ? 0.45 : 0.78,
    bgcolor: ui.threadTopbarBg,
    backdropFilter: 'blur(16px)',
    position: 'sticky',
    top: 0,
    zIndex: 5,
    boxShadow: theme.palette.mode === 'dark' ? 'none' : `0 1px 0 ${ui.borderSoft}, 0 6px 14px ${alpha('#000', 0.06)}`,
    borderBottom: theme.palette.mode === 'dark' ? `0.5px solid ${ui.borderSoft}` : 'none',
  };
  const headerContentSx = {
    maxWidth: compactMobile ? '100%' : `${Number(ui.contentMaxWidth || 980) + 56}px`,
    mx: 'auto',
    width: '100%',
  };

  if (selectionMode && compactMobile) {
    const selectionIconButtonSx = {
      width: 38,
      height: 38,
      borderRadius: 0,
      color: alpha('#ffffff', 0.96),
      bgcolor: 'transparent',
      transition: 'opacity 120ms ease, transform 120ms ease',
      '&:active': {
        opacity: 0.62,
        transform: 'scale(0.96)',
      },
      '&:disabled': {
        opacity: 0.34,
      },
    };

    return (
      <Box
        className="chat-safe-top chat-no-select"
        data-testid="chat-selection-toolbar"
        sx={{
          ...headerShellSx,
          px: 0.65,
          pb: 0.3,
          bgcolor: alpha(ui.threadTopbarBg || '#202434', 0.98),
          backdropFilter: 'blur(18px) saturate(1.06)',
          borderBottom: `1px solid ${alpha('#ffffff', 0.06)}`,
          boxShadow: 'none',
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{
            ...headerContentSx,
            minHeight: 44,
          }}
        >
          <Stack direction="row" spacing={0.9} alignItems="center" sx={{ minWidth: 0 }}>
            <IconButton
              data-testid="chat-selection-clear"
              aria-label="Отменить выделение"
              onClick={onClearMessageSelection}
              sx={selectionIconButtonSx}
            >
              <CloseRoundedIcon sx={{ fontSize: 28 }} />
            </IconButton>
            <Typography
              data-testid="chat-selection-count-badge"
              sx={{
                color: alpha('#ffffff', 0.96),
                fontSize: 21,
                fontWeight: 700,
                lineHeight: 1,
                fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
              }}
            >
              {selectedMessageCount}
            </Typography>
          </Stack>

          <Stack direction="row" spacing={0.65} alignItems="center">
            <IconButton
              data-testid="chat-selection-copy-action"
              aria-label="Копировать"
              disabled={!canCopySelectedMessages || selectedMessageCount <= 0 || typeof onCopySelectedMessages !== 'function'}
              onClick={onCopySelectedMessages}
              sx={selectionIconButtonSx}
            >
              <ContentCopyRoundedIcon sx={{ fontSize: 25 }} />
            </IconButton>
            <IconButton
              data-testid="chat-selection-header-forward-action"
              aria-label="Переслать"
              disabled={selectedMessageCount <= 0 || typeof onForwardSelectedMessages !== 'function'}
              onClick={onForwardSelectedMessages}
              sx={selectionIconButtonSx}
            >
              <ForwardRoundedIcon sx={{ fontSize: 27 }} />
            </IconButton>
          </Stack>
        </Stack>
      </Box>
    );
  }

  if (selectionMode) {
    return (
      <Box className="chat-safe-top chat-no-select" data-testid="chat-selection-toolbar" sx={headerShellSx}>
        <Stack
          direction="row"
          spacing={compactMobile ? 0.85 : 1.05}
          alignItems="center"
          justifyContent="space-between"
          sx={headerContentSx}
        >
          <Stack direction="row" spacing={compactMobile ? 0.75 : 1} alignItems="center" sx={{ minWidth: 0 }}>
            {isMobile ? (
              <IconButton
                size="small"
                onClick={onBack}
                aria-label="Назад к чатам"
                sx={{
                  ml: -0.2,
                  width: compactMobile ? 34 : 38,
                  height: compactMobile ? 34 : 38,
                  borderRadius: 0,
                  bgcolor: 'transparent',
                }}
              >
                <ArrowBackRoundedIcon />
              </IconButton>
            ) : null}
            <Box
              data-testid="chat-selection-count-badge"
              sx={{
                width: compactMobile ? 34 : 36,
                height: compactMobile ? 34 : 36,
                borderRadius: 999,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                bgcolor: ui.accentText || theme.palette.primary.main,
                color: theme.palette.primary.contrastText,
                fontWeight: 850,
                fontSize: compactMobile ? 16 : 17,
                fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
              }}
            >
              {selectedMessageCount}
            </Box>
            <Box
              component="button"
              type="button"
              onClick={onOpenInfo}
              aria-label="Информация о чате"
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: compactMobile ? '10px' : '12px',
                p: 0,
                border: 'none',
                bgcolor: 'transparent',
                color: theme.palette.text.primary,
                textAlign: 'left',
                cursor: 'pointer',
                minWidth: 0,
              }}
            >
              <PresenceAvatar
                item={activeConversation.kind === 'direct' ? (activeConversation.direct_peer || activeConversation) : activeConversation}
                online={Boolean(activeConversation?.kind === 'direct' && activeConversation?.direct_peer?.presence?.is_online)}
                size={compactMobile ? 40 : 42}
              />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.1, color: theme.palette.text.primary, fontSize: compactMobile ? CHAT_FONT_SIZES.headerTitleMobile : '1.02rem', letterSpacing: '-0.01em', fontFamily: TELEGRAM_CHAT_FONT_FAMILY }} noWrap>
                  {activeConversation.title}
                </Typography>
                <Typography variant="caption" sx={{ color: ui.textSecondary, fontSize: compactMobile ? CHAT_FONT_SIZES.previewBody : '0.82rem', lineHeight: 1.12, fontFamily: TELEGRAM_CHAT_FONT_FAMILY }} noWrap>
                  {typingLine || headerSubtitle}
                </Typography>
              </Box>
            </Box>
          </Stack>

          <HeaderAction
            title="Действия чата"
            onClick={onOpenMenu}
            active={contextPanelOpen}
            compactMobile={compactMobile}
          >
            <MoreVertRoundedIcon fontSize="small" />
          </HeaderAction>
        </Stack>
      </Box>
    );
  }

  return (
    <Box
      className="chat-safe-top chat-no-select"
      sx={headerShellSx}
    >
      <Stack
        direction="row"
        spacing={compactMobile ? 0.85 : 1.05}
        alignItems="center"
        justifyContent="space-between"
        sx={{
          ...headerContentSx,
        }}
      >
        <Stack direction="row" spacing={compactMobile ? 0.75 : 1} alignItems="center" sx={{ minWidth: 0 }}>
          {isMobile ? (
            <IconButton
              size="small"
              onClick={onBack}
              aria-label="Назад к чатам"
              sx={{
                ml: -0.2,
                width: compactMobile ? 34 : 38,
                height: compactMobile ? 34 : 38,
                borderRadius: 0,
                bgcolor: 'transparent',
                '&:active': compactMobile ? {
                  opacity: 0.62,
                  transform: 'scale(0.96)',
                } : undefined,
              }}
            >
              <ArrowBackRoundedIcon />
            </IconButton>
          ) : null}

          <Box
            component="button"
            type="button"
            onClick={onOpenInfo}
            aria-label="Информация о чате"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: compactMobile ? '10px' : '12px',
              p: 0,
              border: 'none',
              bgcolor: 'transparent',
              color: theme.palette.text.primary,
              textAlign: 'left',
              cursor: 'pointer',
              minWidth: 0,
              '&:active': compactMobile ? {
                opacity: 0.72,
              } : undefined,
            }}
          >
            <PresenceAvatar
              item={activeConversation.kind === 'direct' ? (activeConversation.direct_peer || activeConversation) : activeConversation}
              online={Boolean(activeConversation?.kind === 'direct' && activeConversation?.direct_peer?.presence?.is_online)}
              size={compactMobile ? 40 : 42}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.1, color: theme.palette.text.primary, fontSize: compactMobile ? CHAT_FONT_SIZES.headerTitleMobile : '1.02rem', letterSpacing: '-0.01em', fontFamily: TELEGRAM_CHAT_FONT_FAMILY }} noWrap>
                {activeConversation.title}
              </Typography>
              <Typography variant="caption" sx={{ color: ui.textSecondary, fontSize: compactMobile ? CHAT_FONT_SIZES.previewBody : '0.82rem', lineHeight: 1.12, fontFamily: TELEGRAM_CHAT_FONT_FAMILY }} noWrap>
                {typingLine || headerSubtitle}
              </Typography>
            </Box>
          </Box>
        </Stack>

        <Stack direction="row" spacing={0.1} alignItems="center">
          <HeaderAction title="Поиск по сообщениям" onClick={onOpenSearch} compactMobile={compactMobile} hidden={compactMobile}>
            <SearchRoundedIcon fontSize="small" />
          </HeaderAction>
          <HeaderAction
            title="Действия чата"
            onClick={onOpenMenu}
            active={contextPanelOpen}
            compactMobile={compactMobile}
          >
            <MoreVertRoundedIcon fontSize="small" />
          </HeaderAction>
        </Stack>
      </Stack>
    </Box>
  );
});

const PinnedMessageBar = memo(function PinnedMessageBar({
  theme,
  ui,
  compactMobile,
  pinnedMessage,
  onOpenPinnedMessage,
  onUnpinPinnedMessage,
}) {
  if (!pinnedMessage?.id) return null;

  const previewText = String(pinnedMessage?.preview || '').trim() || 'Сообщение';
  const senderName = String(pinnedMessage?.senderName || '').trim();

  return (
    <Box
      sx={{
        px: { xs: compactMobile ? 0.75 : 1.35, md: 1.8 },
        py: compactMobile ? 0.48 : 0.62,
        bgcolor: ui.threadTopbarBg,
        backdropFilter: 'blur(18px)',
        borderBottom: `1px solid ${alpha(ui.borderSoft, 0.8)}`,
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{
          maxWidth: compactMobile ? '100%' : `${Number(ui.contentMaxWidth || 980) + 56}px`,
          mx: 'auto',
          width: '100%',
        }}
      >
        <Box
          component="button"
          type="button"
          data-testid="chat-pinned-message-open"
          aria-label="Открыть закрепленное сообщение"
          onClick={() => void onOpenPinnedMessage?.()}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.1,
            flex: 1,
            minWidth: 0,
            textAlign: 'left',
            border: 'none',
            bgcolor: ui.surfaceMuted || (compactMobile ? alpha(theme.palette.common.white, 0.03) : alpha(theme.palette.common.white, 0.02)),
            color: theme.palette.text.primary,
            borderRadius: compactMobile ? 2.5 : 1.5,
            px: compactMobile ? 1.1 : 1.2,
            py: compactMobile ? 0.8 : 0.75,
            transition: 'background-color 120ms ease, opacity 100ms ease',
            cursor: 'pointer',
            '&:hover': compactMobile ? undefined : {
              bgcolor: ui.surfaceHover || alpha(theme.palette.common.white, 0.05),
            },
            '&:active': {
              opacity: 0.74,
            },
          }}
        >
          <Box
            sx={{
              width: 30,
              height: 30,
              borderRadius: compactMobile ? 2 : 1.25,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: ui.accentSoft,
              color: ui.accentText,
              flexShrink: 0,
            }}
          >
            <PushPinOutlinedIcon sx={{ fontSize: 16 }} />
          </Box>

          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="caption" sx={{ color: ui.accentText, fontWeight: 800, lineHeight: 1.1 }} noWrap>
              Закрепленное сообщение
            </Typography>
            <Typography variant="body2" sx={{ color: ui.textSecondary, lineHeight: 1.25 }} noWrap>
              {senderName ? `${senderName}: ${previewText}` : previewText}
            </Typography>
          </Box>
        </Box>

        <IconButton
          size="small"
          data-testid="chat-pinned-message-close"
          aria-label="Снять закрепленное сообщение"
          onClick={() => onUnpinPinnedMessage?.()}
          sx={{
            width: compactMobile ? 34 : 32,
            height: compactMobile ? 34 : 32,
            borderRadius: compactMobile ? 999 : 1.5,
            color: ui.textSecondary,
            bgcolor: ui.surfaceMuted || alpha(theme.palette.common.white, 0.03),
            '&:hover': compactMobile ? undefined : {
              bgcolor: ui.surfaceHover || alpha(theme.palette.common.white, 0.06),
            },
            '&:active': {
              opacity: 0.62,
            },
          }}
        >
          <CloseRoundedIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Stack>
    </Box>
  );
});

const ChatMessageList = memo(function ChatMessageList({
  theme,
  ui,
  compactMobile,
  mobileInteractionsEnabled = false,
  activeConversation,
  navigate,
  threadWallpaperSx,
  messages,
  messagesLoading,
  effectiveLastReadMessageId,
  messagesHasMore,
  loadingOlder,
  onLoadOlder,
  threadScrollRef,
  threadContentRef,
  onThreadScroll,
  bottomRef,
  onOpenReads,
  onOpenAttachmentPreview,
  onReplyMessage,
  onOpenMessageMenu,
  onConfirmAction,
  onCancelAction,
  onEditAction,
  selectedMessageIds = [],
  onToggleMessageSelection,
  onStartMessageSelection,
  highlightedMessageId,
  showJumpToLatest,
  onJumpToLatest,
  onComposerDrop,
  onComposerDragOver,
  onComposerDragLeave,
  isFileDragActive,
  composerHeight,
  keyboardInset,
  getReadTargetRef,
}) {
  const timelineItems = useMemo(
    () => buildTimelineItems(messages, effectiveLastReadMessageId),
    [effectiveLastReadMessageId, messages],
  );
  const servicePillBg = ui.servicePillBg || alpha(ui.composerDockBg || ui.panelBg || theme.palette.background.paper, 0.78);
  const servicePillText = ui.servicePillText || ui.textSecondary;
  const jumpPillBg = ui.jumpPillBg || theme.palette.primary.main;
  const jumpPillText = ui.jumpPillText || theme.palette.primary.contrastText;
  const contentMaxWidth = Number(ui.contentMaxWidth || 980);
  const keyboardBottomSpacer = getChatKeyboardBottomSpacer({
    compactMobile,
    keyboardInset,
    composerHeight,
  });
  const scrollBottomPadding = compactMobile ? 8 + keyboardBottomSpacer : 8;
  const selectedMessageIdSet = useMemo(
    () => new Set((Array.isArray(selectedMessageIds) ? selectedMessageIds : []).map((value) => String(value || '').trim()).filter(Boolean)),
    [selectedMessageIds],
  );
  const selectionMode = selectedMessageIdSet.size > 0;

  const groupedMetaById = useMemo(() => {
    const entries = new Map();
    messages.forEach((message, index) => {
      entries.set(message.id, {
        groupedWithPrevious: shouldGroupMessages(messages[index - 1], message),
        groupedWithNext: shouldGroupMessages(message, messages[index + 1]),
      });
    });
    return entries;
  }, [messages]);

  // Одна sticky-плашка даты наверху (как в Telegram)
  const [stickyDateLabel, setStickyDateLabel] = useState('');
  const stickyDateLabelRef = useRef('');
  const stickyDateFrameRef = useRef(null);
  const stickyDateAnchorsRef = useRef([]);

  useLayoutEffect(() => {
    if (!compactMobile || !threadScrollRef.current) return undefined;
    const container = threadScrollRef.current;
    if (!container) return undefined;

    const refreshStickyDateAnchors = () => {
      stickyDateAnchorsRef.current = Array.from(container.querySelectorAll('[data-message-date]'))
        .map((el) => ({
          top: Number(el.offsetTop || 0),
          label: String(el.dataset.messageDate || '').trim(),
        }))
        .filter((item) => item.label);
    };

    // Находим все сообщения с датами и отслеживаем какое вверху
    const updateVisibleDateNow = () => {
      stickyDateFrameRef.current = null;
      const messageElements = stickyDateAnchorsRef.current;
      let currentLabel = '';
      const thresholdTop = Number(container.scrollTop || 0) + 100;
      messageElements.forEach((el) => {
        const elementTop = Number(el.top || 0);
        // Если сообщение в видимой области (выше центра)
        if (elementTop <= thresholdTop) {
          currentLabel = el.label || currentLabel;
        }
      });
      if (currentLabel && currentLabel !== stickyDateLabelRef.current) {
        stickyDateLabelRef.current = currentLabel;
        setStickyDateLabel(currentLabel);
      }
    };

    // Инициализация
    const scheduleVisibleDateUpdate = () => {
      if (stickyDateFrameRef.current !== null) return;
      stickyDateFrameRef.current = window.requestAnimationFrame(updateVisibleDateNow);
    };

    refreshStickyDateAnchors();
    scheduleVisibleDateUpdate();
    const resizeTarget = threadContentRef?.current || container;
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
        refreshStickyDateAnchors();
        scheduleVisibleDateUpdate();
      })
      : null;
    resizeObserver?.observe?.(resizeTarget);

    container.addEventListener('scroll', scheduleVisibleDateUpdate, { passive: true });
    return () => {
      container.removeEventListener('scroll', scheduleVisibleDateUpdate);
      resizeObserver?.disconnect?.();
      if (stickyDateFrameRef.current !== null) {
        window.cancelAnimationFrame(stickyDateFrameRef.current);
        stickyDateFrameRef.current = null;
      }
    };
  }, [compactMobile, messages.length, threadContentRef, threadScrollRef]);

  return (
    <>
      <Box
        ref={threadScrollRef}
        data-testid="chat-thread-scroll"
        className="chat-scroll-hidden chat-native-shell"
        onScroll={onThreadScroll}
        onDrop={onComposerDrop}
        onDragOver={onComposerDragOver}
        onDragLeave={onComposerDragLeave}
        sx={{
          ...threadWallpaperSx,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowAnchor: 'none',
          overscrollBehaviorY: compactMobile ? 'none' : 'contain',
          px: { xs: compactMobile ? 0.7 : 1.1, md: 2.2 },
          pt: { xs: 0.5, md: 1.8 },
          pb: {
            xs: `${scrollBottomPadding}px`,
            md: '18px',
          },
          scrollPaddingBottom: {
            xs: `${Math.max(24, scrollBottomPadding + 16)}px`,
            md: '28px',
          },
          position: 'relative',
          userSelect: 'none',
        }}
      >
        <Box sx={{ maxWidth: { xs: '100%', md: `${contentMaxWidth}px` }, mx: 'auto', width: '100%' }}>
          {/* Одна sticky-плашка даты наверху (как в Telegram) */}
          {compactMobile && stickyDateLabel && (
            <div
              className="pointer-events-none sticky z-50 flex h-0 justify-center"
              style={{ top: 4 }}
            >
              <div
                className="rounded-full border px-2 py-0.5 text-[11px] font-semibold backdrop-blur-xl"
                style={{
                  backgroundColor: servicePillBg,
                  color: servicePillText,
                  borderColor: ui.borderSoft,
                  minWidth: '70px',
                  textAlign: 'center',
                  transform: 'translateY(4px)',
                }}
              >
                {stickyDateLabel}
              </div>
            </div>
          )}

          {isFileDragActive ? (
            <Box
              sx={{
                position: 'sticky',
                top: 12,
                zIndex: 6,
                mx: 'auto',
                mb: 1.5,
                display: 'flex',
                justifyContent: 'center',
                pointerEvents: 'none',
              }}
            >
              <ChatFileUploadPanel
                mode="drop"
                files={[]}
                showActions={false}
                showCaption={false}
                theme={theme}
                ui={ui}
              />
            </Box>
          ) : null}

          {messagesLoading ? (
            <ThreadLoadingSkeleton compactMobile={compactMobile} />
          ) : messages.length === 0 ? (
            <Stack alignItems="center" justifyContent="center" sx={{ minHeight: '100%', textAlign: 'center', px: 2 }}>
              <Avatar sx={{ width: 64, height: 64, mb: 2, bgcolor: ui.accentSoft, color: ui.accentText }}>
                <ForumOutlinedIcon />
              </Avatar>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                Здесь пока тихо
              </Typography>
              <Typography variant="body2" sx={{ mt: 1, maxWidth: 420, color: ui.textSecondary }}>
                Отправьте первое сообщение, задачу или вложение. Диалог уже готов к работе.
              </Typography>
            </Stack>
          ) : (
            <Stack ref={threadContentRef} data-testid="chat-thread-content" spacing={0} sx={{ overflowAnchor: 'none' }}>
              {messagesHasMore ? (
                <Stack alignItems="center" sx={{ pb: 0.8 }}>
                  <Button
                    variant="text"
                    size="small"
                    onClick={onLoadOlder}
                    disabled={loadingOlder}
                    sx={{
                      color: ui.accentText,
                      textTransform: 'none',
                      borderRadius: compactMobile ? 999 : 1.5,
                      px: 1.5,
                      py: 0.4,
                      bgcolor: alpha(servicePillBg, 0.96),
                      border: '1px solid',
                      borderColor: ui.borderSoft,
                    }}
                  >
                    {loadingOlder ? 'Загрузка истории...' : 'Показать более ранние сообщения'}
                  </Button>
                </Stack>
              ) : null}

              {timelineItems.map((item) => {
              // На мобильном date-маркеры не рендерим — только одна sticky-плашка наверху
              if (item.type === 'date') {
                if (compactMobile) return null;
                return (
                  <TimelineMarker
                    key={item.key}
                    label={item.label}
                    stickyOffset={10}
                    tone={{
                      bg: servicePillBg,
                      text: servicePillText,
                      border: ui.borderSoft,
                      shadow: 'none',
                    }}
                  />
                );
              }

              if (item.type === 'unread') {
                return (
                  <TimelineMarker
                    key={item.key}
                    label={item.label}
                    dataTestId="chat-unread-separator"
                    stickyOffset={48}
                    tone={{
                      bg: alpha(theme.palette.primary.main, 0.14),
                      text: theme.palette.primary.light,
                      border: alpha(theme.palette.primary.main, 0.2),
                      shadow: 'none',
                    }}
                  />
                );
              }

              const groupedMeta = groupedMetaById.get(item.message?.id) || {};
              const messageId = String(item.message?.id || '').trim();
              const selected = Boolean(messageId && selectedMessageIdSet.has(messageId));
              return (
                <div key={item.key} data-message-date={getDateDividerLabel(item.message?.created_at)}>
                  <MemoChatBubble
                    conversationKind={activeConversation.kind}
                    message={item.message}
                    navigate={navigate}
                    theme={theme}
                    ui={ui}
                    onOpenReads={onOpenReads}
                    onOpenAttachmentPreview={onOpenAttachmentPreview}
                    onReplyMessage={onReplyMessage}
                    onOpenMessageMenu={onOpenMessageMenu}
                    onConfirmAction={onConfirmAction}
                    onCancelAction={onCancelAction}
                    onEditAction={onEditAction}
                    selectionMode={selectionMode}
                    selected={selected}
                    onToggleMessageSelection={onToggleMessageSelection}
                    onStartMessageSelection={onStartMessageSelection}
                    highlighted={highlightedMessageId === item.message?.id}
                    groupedWithPrevious={Boolean(groupedMeta.groupedWithPrevious)}
                    groupedWithNext={Boolean(groupedMeta.groupedWithNext)}
                    compactMobile={compactMobile}
                    mobileInteractionsEnabled={mobileInteractionsEnabled}
                    readTargetRef={getReadTargetRef?.(item.message?.id)}
                  />
                </div>
              );
              })}
              <Box ref={bottomRef} />
            </Stack>
          )}
        </Box>
      </Box>

      <AnimatePresence initial={false}>{showJumpToLatest ? (
      <Box
        component={motion.div}
        initial={{ opacity: 0, y: 10, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.96 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        sx={{
          position: 'absolute',
          right: { xs: 12, md: 22 },
          bottom: {
            xs: `${Math.max(12, keyboardInset + (selectionMode ? 92 : 10))}px`,
            md: selectionMode ? '96px' : '20px',
          },
          zIndex: 4,
        }}
      >
        <Badge
          badgeContent={Number(activeConversation?.unread_count || 0)}
          color="primary"
          invisible={Number(activeConversation?.unread_count || 0) <= 0}
        >
          <Button
            variant="contained"
            size="small"
            onClick={onJumpToLatest}
            endIcon={<KeyboardArrowDownRoundedIcon />}
            sx={{
                borderRadius: compactMobile ? 999 : 1.35,
                boxShadow: compactMobile ? '0 6px 14px rgba(6, 18, 32, 0.14)' : ui.shadowStrong,
                textTransform: 'none',
                px: compactMobile ? 0.95 : 1.15,
                minWidth: compactMobile ? 0 : undefined,
                bgcolor: jumpPillBg,
                color: jumpPillText,
                minHeight: compactMobile ? 30 : 34,
                fontSize: compactMobile ? '12px' : '0.78rem',
                fontWeight: 700,
                '&:active': compactMobile ? {
                  opacity: 0.62,
                } : undefined,
              }}
            >
              К последним
            </Button>
          </Badge>
        </Box>
      ) : null}</AnimatePresence>
    </>
  );
});

const ChatComposer = memo(function ChatComposer({
  theme,
  ui,
  compactMobile,
  activeConversationId,
  selectedFiles,
  fileCaption,
  onOpenFileDialog,
  onClearSelectedFiles,
  preparingFiles,
  sendingFiles,
  fileUploadProgress,
  selectedFilesSummary,
  replyMessage,
  onClearReply,
  onOpenComposerMenu,
  composerRef,
  messageText,
  onMessageTextChange,
  onComposerKeyDown,
  onComposerSelectionSync,
  onOpenEmojiPicker,
  onSendMessage,
  onComposerPaste,
  onComposerDrop,
  onComposerDragOver,
  onComposerDragLeave,
  onComposerFocusChange,
  mentionCandidates = [],
  onSearchMentionPeople,
  composerDockRef,
  keyboardInset = 0,
}) {
  const contentMaxWidth = Number(ui.contentMaxWidth || 980);
  const composerBg = ui.composerBg || (theme.palette.mode === 'dark' ? '#1c1c1e' : '#ffffff');
  const composerActionBg = ui.composerActionBg || theme.palette.primary.main;
  const composerActionText = ui.composerActionText || theme.palette.primary.contrastText;
  const composerAuxColor = ui.textSecondary || theme.palette.text.secondary;
  const composerPrimaryText = ui.textPrimary || theme.palette.text.primary;
  const composerIconColor = theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.55)' : composerAuxColor;
  const composerDismissColor = theme.palette.mode === 'dark' ? alpha('#ffffff', 0.6) : composerAuxColor;
  const canSendComposerMessage = Boolean(String(messageText || '').trim());
  const filesBusy = preparingFiles || sendingFiles;
  const [mentionTrigger, setMentionTrigger] = useState(null);
  const mentionTriggerRef = useRef(null);
  const [remoteMentionPeople, setRemoteMentionPeople] = useState([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const selectedFilesTotalLabel = useMemo(() => {
    const finalBytes = Number(selectedFilesSummary?.finalTotalBytes || 0);
    const originalBytes = Number(selectedFilesSummary?.originalTotalBytes || finalBytes);
    if (originalBytes > finalBytes && finalBytes > 0) {
      return `${formatFileSize(originalBytes)} -> ${formatFileSize(finalBytes)}`;
    }
    return finalBytes > 0 ? formatFileSize(finalBytes) : '';
  }, [selectedFilesSummary]);

  const updateMentionTriggerFromTextarea = useCallback((node) => {
    if (!node) {
      mentionTriggerRef.current = null;
      setMentionTrigger(null);
      return;
    }
    const nextTrigger = getComposerMentionTrigger(node.value, node.selectionStart);
    const previousTrigger = mentionTriggerRef.current;
    const unchanged = Boolean(previousTrigger) === Boolean(nextTrigger)
      && String(previousTrigger?.query || '') === String(nextTrigger?.query || '')
      && Number(previousTrigger?.start ?? -1) === Number(nextTrigger?.start ?? -1)
      && Number(previousTrigger?.end ?? -1) === Number(nextTrigger?.end ?? -1);
    mentionTriggerRef.current = nextTrigger;
    if (!unchanged) {
      setMentionTrigger(nextTrigger);
      setActiveMentionIndex(0);
    }
  }, []);

  const localMentionPeople = useMemo(
    () => filterMentionCandidates(mentionCandidates, mentionTrigger?.query, MENTION_RESULT_LIMIT),
    [mentionCandidates, mentionTrigger?.query],
  );

  useEffect(() => {
    const query = String(mentionTrigger?.query || '').trim();
    if (!mentionTrigger || query.length < 1 || typeof onSearchMentionPeople !== 'function') {
      setRemoteMentionPeople([]);
      setMentionLoading(false);
      return undefined;
    }
    let cancelled = false;
    setMentionLoading(true);
    const timeoutId = window.setTimeout(async () => {
      try {
        const people = await onSearchMentionPeople(query);
        if (cancelled) return;
        setRemoteMentionPeople(Array.isArray(people) ? people : []);
      } catch {
        if (!cancelled) setRemoteMentionPeople([]);
      } finally {
        if (!cancelled) setMentionLoading(false);
      }
    }, 140);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [mentionTrigger, onSearchMentionPeople]);

  const mentionOptions = useMemo(
    () => filterMentionCandidates([...localMentionPeople, ...remoteMentionPeople], mentionTrigger?.query, MENTION_RESULT_LIMIT),
    [localMentionPeople, mentionTrigger?.query, remoteMentionPeople],
  );
  const mentionOpen = Boolean(mentionTrigger) && (mentionOptions.length > 0 || mentionLoading);

  const closeMentions = useCallback(() => {
    mentionTriggerRef.current = null;
    setMentionTrigger(null);
    setRemoteMentionPeople([]);
    setMentionLoading(false);
    setActiveMentionIndex(0);
  }, []);

  const insertMention = useCallback((person) => {
    const trigger = mentionTriggerRef.current || mentionTrigger;
    const handle = getPersonMentionHandle(person);
    if (!trigger || !handle) return;
    const currentValue = String(messageText || '');
    const insertText = `@${handle} `;
    const nextValue = `${currentValue.slice(0, trigger.start)}${insertText}${currentValue.slice(trigger.end)}`;
    const nextCaret = trigger.start + insertText.length;
    onMessageTextChange?.(nextValue);
    closeMentions();
    window.requestAnimationFrame(() => {
      const node = composerRef?.current;
      node?.focus?.();
      node?.setSelectionRange?.(nextCaret, nextCaret);
      updateMentionTriggerFromTextarea(node);
    });
  }, [closeMentions, composerRef, mentionTrigger, messageText, onMessageTextChange, updateMentionTriggerFromTextarea]);

  const handleFocus = useCallback((event) => {
    onComposerFocusChange?.(true);
    onComposerSelectionSync?.(event);
    updateMentionTriggerFromTextarea(event.currentTarget);
  }, [onComposerFocusChange, onComposerSelectionSync, updateMentionTriggerFromTextarea]);

  const handleBlur = useCallback(() => {
    onComposerFocusChange?.(false);
  }, [onComposerFocusChange]);

  const handleComposerChange = useCallback((event) => {
    onMessageTextChange?.(event.target.value);
    updateMentionTriggerFromTextarea(event.target);
  }, [onMessageTextChange, updateMentionTriggerFromTextarea]);

  const handleComposerSelection = useCallback((event) => {
    onComposerSelectionSync?.(event);
    updateMentionTriggerFromTextarea(event.currentTarget);
  }, [onComposerSelectionSync, updateMentionTriggerFromTextarea]);

  const handleComposerKeyDown = useCallback((event) => {
    if (mentionOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveMentionIndex((current) => (mentionOptions.length > 0 ? (current + 1) % mentionOptions.length : 0));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveMentionIndex((current) => (mentionOptions.length > 0 ? (current - 1 + mentionOptions.length) % mentionOptions.length : 0));
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && mentionOptions.length > 0) {
        event.preventDefault();
        insertMention(mentionOptions[Math.max(0, Math.min(activeMentionIndex, mentionOptions.length - 1))]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMentions();
        return;
      }
    }
    onComposerKeyDown?.(event);
  }, [activeMentionIndex, closeMentions, insertMention, mentionOpen, mentionOptions, onComposerKeyDown]);

  const preserveComposerKeyboard = useCallback((event) => {
    if (!compactMobile) return;
    event.preventDefault();
  }, [compactMobile]);

  return (
    <Box
      ref={composerDockRef}
      data-testid="chat-composer-dock"
      className="chat-safe-bottom chat-native-shell chat-no-select"
      sx={{
        px: { xs: compactMobile ? 0.8 : 1.1, md: 1.6 },
        pt: compactMobile ? 0.55 : 0.95,
        bgcolor: composerBg,
        backdropFilter: 'blur(22px) saturate(1.08)',
        position: 'sticky',
        bottom: 0,
        zIndex: 5,
        borderTop: theme.palette.mode === 'dark' ? `0.5px solid ${ui.borderSoft}` : 'none',
        boxShadow: theme.palette.mode === 'dark'
          ? '0 -1px 0 rgba(255,255,255,0.04)'
          : `0 -1px 0 ${ui.borderSoft}, 0 -14px 26px rgba(80,104,128,0.08)`,
        fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
      }}
    >
      <Box sx={{ maxWidth: { xs: '100%', md: `${contentMaxWidth}px` }, mx: 'auto', width: '100%' }}>
        {selectedFiles.length > 0 || preparingFiles ? (
          <div
            className={joinClasses(
              'mb-3 border px-4 py-3',
              compactMobile ? 'rounded-[20px]' : 'rounded-[14px]',
            )}
            style={{
              backgroundColor: alpha(ui.composerDockBg, 0.94),
              borderColor: ui.borderSoft,
              borderLeft: `3px solid ${ui.accentText}`,
              boxShadow: ui.shadowSoft,
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold" style={{ color: ui.accentText, fontFamily: TELEGRAM_CHAT_FONT_FAMILY, fontSize: CHAT_FONT_SIZES.composerAux }}>
                  {preparingFiles ? 'Подготовка фото...' : sendingFiles ? 'Загрузка файлов...' : 'Вложения готовы к отправке'}
                </p>
                <p className="mt-0.5 text-[12px]" style={{ color: ui.textSecondary, fontFamily: TELEGRAM_CHAT_FONT_FAMILY, fontSize: CHAT_FONT_SIZES.composerAux }}>
                  {selectedFiles.length > 0
                    ? `${selectedFiles.length} ${selectedFiles.length === 1 ? 'файл' : selectedFiles.length < 5 ? 'файла' : 'файлов'}`
                    : 'Готовим выбранные изображения перед отправкой'}
                  {selectedFilesTotalLabel ? ` | ${selectedFilesTotalLabel}` : ''}
                  {sendingFiles ? ` | ${Math.max(0, Math.min(100, Math.round(Number(fileUploadProgress || 0))))}%` : ''}
                  {fileCaption ? ' | есть подпись' : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={onOpenFileDialog} disabled={filesBusy} className="text-[12px] font-medium disabled:opacity-50" style={{ color: ui.accentText, fontFamily: TELEGRAM_CHAT_FONT_FAMILY, fontSize: CHAT_FONT_SIZES.composerAux }}>
                  Изменить
                </button>
                <button type="button" onClick={onClearSelectedFiles} disabled={filesBusy} className="text-[12px] font-medium disabled:opacity-50" style={{ color: composerAuxColor, fontFamily: TELEGRAM_CHAT_FONT_FAMILY, fontSize: CHAT_FONT_SIZES.composerAux }}>
                  Очистить
                </button>
              </div>
            </div>
            {selectedFiles.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
              {selectedFiles.slice(0, 3).map((file) => (
                <span
                  key={`${file.name}-${file.size}`}
                  className="inline-flex max-w-full rounded-full px-3 py-1 text-[12px] font-medium"
                  style={{ backgroundColor: ui.composerInputBg, color: composerPrimaryText }}
                >
                  <span className="truncate">{file.name}</span>
                </span>
              ))}
              {selectedFiles.length > 3 ? (
                <span className="inline-flex rounded-full px-3 py-1 text-[12px] font-medium" style={{ backgroundColor: ui.composerInputBg, color: composerPrimaryText }}>
                  +{selectedFiles.length - 3}
                </span>
              ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {replyMessage ? (
          <div
            className={joinClasses(
              'mb-3 flex items-start justify-between gap-3 border px-4 py-3',
              compactMobile ? 'rounded-[20px]' : 'rounded-[14px]',
            )}
            style={{
              backgroundColor: alpha(ui.composerDockBg, 0.94),
              borderColor: ui.borderSoft,
              borderLeft: `3px solid ${ui.accentText}`,
              boxShadow: ui.shadowSoft,
            }}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold" style={{ color: ui.accentText, fontFamily: TELEGRAM_CHAT_FONT_FAMILY, fontSize: CHAT_FONT_SIZES.composerAux }}>
                {replyMessage?.sender?.full_name || replyMessage?.sender?.username || 'Сообщение'}
              </p>
              <p className="truncate text-[12px]" style={{ color: ui.textSecondary, fontFamily: TELEGRAM_CHAT_FONT_FAMILY, fontSize: CHAT_FONT_SIZES.composerAux }}>
                {getSearchResultPreview(replyMessage)}
              </p>
            </div>
            <button
              type="button"
              aria-label="Отменить ответ"
              onClick={onClearReply}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full transition duration-100 active:scale-[0.96] active:opacity-60"
              style={{ color: composerDismissColor }}
            >
              <CloseRoundedIcon sx={{ fontSize: 16 }} />
            </button>
          </div>
        ) : null}

        {mentionOpen ? (
          <Box
            data-testid="chat-mention-suggestions"
            sx={{
              mb: 0.75,
              overflow: 'hidden',
              borderRadius: compactMobile ? 3 : 2,
              border: '1px solid',
              borderColor: ui.borderSoft,
              bgcolor: alpha(ui.composerDockBg || composerBg, theme.palette.mode === 'dark' ? 0.98 : 0.96),
              boxShadow: theme.palette.mode === 'dark'
                ? '0 14px 32px rgba(0,0,0,0.28)'
                : '0 14px 32px rgba(15,23,42,0.14)',
            }}
          >
            {mentionOptions.map((person, index) => {
              const handle = getPersonMentionHandle(person);
              const displayName = getPersonDisplayName(person) || handle;
              const selected = index === activeMentionIndex;
              return (
                <Box
                  key={`${person?.id || handle}-${index}`}
                  component="button"
                  type="button"
                  data-testid={`chat-mention-option-${handle}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onPointerDown={(event) => {
                    if (!compactMobile) return;
                    event.preventDefault();
                    insertMention(person);
                  }}
                  onClick={() => insertMention(person)}
                  sx={{
                    width: '100%',
                    minHeight: compactMobile ? 50 : 48,
                    px: 1.1,
                    py: 0.65,
                    border: 'none',
                    bgcolor: selected ? alpha(ui.accentText || theme.palette.primary.main, 0.13) : 'transparent',
                    color: composerPrimaryText,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    textAlign: 'left',
                    cursor: 'pointer',
                    '&:hover': {
                      bgcolor: alpha(ui.accentText || theme.palette.primary.main, 0.1),
                    },
                  }}
                >
                  <Avatar
                    sx={{
                      width: 34,
                      height: 34,
                      fontSize: 13,
                      fontWeight: 850,
                      bgcolor: alpha(ui.accentText || theme.palette.primary.main, 0.18),
                      color: ui.accentText || theme.palette.primary.main,
                    }}
                  >
                    {getPersonInitials(person)}
                  </Avatar>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography noWrap sx={{ color: composerPrimaryText, fontSize: 14.5, fontWeight: 800, lineHeight: 1.15 }}>
                      {displayName}
                    </Typography>
                    <Typography noWrap sx={{ color: composerAuxColor, fontSize: 12.5, lineHeight: 1.25 }}>
                      @{handle}{person?.presence ? ` · ${getPersonStatusLine(person)}` : ''}
                    </Typography>
                  </Box>
                </Box>
              );
            })}
            {mentionLoading && mentionOptions.length === 0 ? (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.25, py: 1, color: composerAuxColor }}>
                <CircularProgress size={16} />
                <Typography sx={{ fontSize: 13, color: composerAuxColor }}>Ищем людей...</Typography>
              </Stack>
            ) : null}
          </Box>
        ) : null}

        <div className="flex items-end gap-2">
          <Box
            data-testid="chat-composer-capsule"
            onDrop={onComposerDrop}
            onDragOver={onComposerDragOver}
            onDragLeave={onComposerDragLeave}
            className={joinClasses(
              'flex flex-1 items-end gap-1 border px-2.5 py-0.5',
              compactMobile ? 'rounded-[23px]' : 'rounded-[20px]',
            )}
            sx={{
              minHeight: compactMobile ? 46 : 48,
              bgcolor: alpha(ui.composerInputBg, 0.94),
              borderColor: theme.palette.mode === 'dark' ? alpha('#ffffff', 0.08) : ui.borderSoft,
              boxShadow: 'none',
              transition: 'border-color 140ms ease, box-shadow 140ms ease, background-color 140ms ease',
              '&:focus-within': {
                borderColor: ui.accentText || alpha(theme.palette.primary.main, 0.36),
                boxShadow: `0 0 0 3px ${ui.focusRing || alpha(ui.accentText || '#3390ec', theme.palette.mode === 'dark' ? 0.18 : 0.14)}`,
              },
            }}
          >
            <Tooltip disableHoverListener={compactMobile} disableFocusListener={compactMobile} disableTouchListener={compactMobile} title="Emoji">
              <span>
                <button
                  type="button"
                  data-testid="chat-composer-emoji-button"
                  aria-label="Emoji"
                  onClick={onOpenEmojiPicker}
                  onMouseDown={preserveComposerKeyboard}
                  onPointerDown={preserveComposerKeyboard}
                  disabled={!activeConversationId}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition duration-100 active:scale-[0.96] active:opacity-60 disabled:opacity-40"
                  style={{
                    backgroundColor: 'transparent',
                    color: composerIconColor,
                    transform: compactMobile ? undefined : 'translateY(-4px)',
                  }}
                  onMouseEnter={(event) => {
                    if (!compactMobile) event.currentTarget.style.backgroundColor = alpha(ui.accentText, 0.08);
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <InsertEmoticonRoundedIcon sx={{ fontSize: 21 }} />
                </button>
              </span>
            </Tooltip>

            <Box
              className="flex min-w-0 flex-1 items-end py-[11px]"
              sx={{ minHeight: 38 }}
            >
              <TextareaAutosize
                ref={composerRef}
                data-testid="chat-composer-textarea"
                minRows={1}
                maxRows={6}
                aria-label="Message"
                placeholder="Message"
                value={messageText}
                onChange={handleComposerChange}
                onKeyDown={handleComposerKeyDown}
                onSelect={handleComposerSelection}
                onClick={handleComposerSelection}
                onKeyUp={handleComposerSelection}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onPaste={onComposerPaste}
                style={{
                  width: '100%',
                  resize: 'none',
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  color: theme.palette.text.primary,
                  fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
                  fontSize: compactMobile ? '16px' : CHAT_FONT_SIZES.composer,
                  lineHeight: '1.34',
                  padding: 0,
                  margin: 0,
                  overflowY: 'auto',
                  maxHeight: '120px',
                  minHeight: compactMobile ? '18px' : '19px',
                }}
              />
            </Box>

            <Tooltip title="Меню вложений">
              <span>
                <button
                  type="button"
                  aria-label="Меню вложений"
                  data-testid="chat-composer-menu-button"
                  onClick={onOpenComposerMenu}
                  onMouseDown={preserveComposerKeyboard}
                  onPointerDown={preserveComposerKeyboard}
                  disabled={!activeConversationId}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition duration-100 active:scale-[0.96] active:opacity-60 disabled:opacity-40"
                  style={{
                    backgroundColor: 'transparent',
                    color: composerIconColor,
                    transform: compactMobile ? undefined : 'translateY(-4px)',
                  }}
                  onMouseEnter={(event) => {
                    if (!compactMobile) event.currentTarget.style.backgroundColor = alpha(ui.accentText, 0.08);
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <AttachFileRoundedIcon sx={{ fontSize: 21 }} />
                </button>
              </span>
            </Tooltip>
          </Box>

          <Tooltip title="Отправить">
            <span>
              <button
                type="button"
                aria-label="Отправить"
                onClick={() => void onSendMessage()}
                onMouseDown={preserveComposerKeyboard}
                onPointerDown={preserveComposerKeyboard}
                // A pending forward without extra text is still a valid send action.
                disabled={!canSendComposerMessage}
                data-testid="chat-composer-send-button"
                className="inline-flex h-[46px] w-[46px] items-center justify-center rounded-full transition duration-100 active:scale-[0.96] active:opacity-60 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: !canSendComposerMessage ? alpha(composerActionBg, 0.34) : composerActionBg,
                  color: composerActionText,
                  boxShadow: !canSendComposerMessage ? 'none' : `0 6px 16px ${alpha(composerActionBg, 0.24)}`,
                  transform: compactMobile ? undefined : 'translateY(-2px)',
                }}
              >
                <SendRoundedIcon sx={{ fontSize: 20 }} />
              </button>
            </span>
          </Tooltip>
        </div>
      </Box>
    </Box>
  );
});

const SelectionActionDock = memo(function SelectionActionDock({
  theme,
  ui,
  compactMobile,
  selectedMessageCount = 0,
  canReplySelectedMessage = false,
  canDeleteSelectedMessages = false,
  onClearMessageSelection,
  onReplySelectedMessage,
  onForwardSelectedMessages,
  onDeleteSelectedMessages,
}) {
  const actionButtonSx = {
    minWidth: 0,
    height: compactMobile ? 48 : 52,
    border: 'none',
    bgcolor: 'transparent',
    color: ui.textPrimary || theme.palette.text.primary,
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: compactMobile ? 0.45 : 0.8,
    px: compactMobile ? 0.7 : 1.6,
    py: 0.8,
    borderRadius: 999,
    cursor: 'pointer',
    transition: 'background-color 120ms ease, opacity 100ms ease, transform 100ms ease',
    '&:active': {
      transform: 'scale(0.96)',
      opacity: 0.72,
    },
    '&:disabled': {
      opacity: 0.36,
      cursor: 'not-allowed',
    },
  };

  if (compactMobile) {
    const mobilePillSx = {
      flex: '1 1 0',
      minWidth: 0,
      height: 48,
      border: `1px solid ${alpha('#ffffff', 0.07)}`,
      bgcolor: alpha(ui.composerBg || '#202434', 0.98),
      color: alpha('#ffffff', 0.78),
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 0.65,
      px: 0.95,
      borderRadius: 999,
      boxShadow: '0 9px 24px rgba(0,0,0,0.3)',
      backdropFilter: 'blur(18px) saturate(1.06)',
      cursor: 'pointer',
      transition: 'opacity 120ms ease, transform 120ms ease, background-color 120ms ease',
      '&:active': {
        transform: 'scale(0.97)',
        opacity: 0.72,
      },
      '&:disabled': {
        opacity: 0.36,
        cursor: 'not-allowed',
      },
    };
    const mobileLabelSx = {
      fontSize: 17,
      fontWeight: 780,
      lineHeight: 1,
      fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
      whiteSpace: 'nowrap',
    };

    return (
      <Box
        data-testid="chat-selection-action-dock"
        sx={{
          flexShrink: 0,
          px: 0.72,
          pt: 0.45,
          pb: 'max(env(safe-area-inset-bottom), 8px)',
          bgcolor: 'transparent',
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          spacing={0.65}
          sx={{
            width: '100%',
            mx: 'auto',
          }}
        >
          <Box
            component="button"
            type="button"
            data-testid="chat-selection-reply-action"
            aria-label="Ответить"
            disabled={!canReplySelectedMessage || selectedMessageCount !== 1 || typeof onReplySelectedMessage !== 'function'}
            onClick={onReplySelectedMessage}
            sx={mobilePillSx}
          >
            <Typography sx={mobileLabelSx}>Ответить</Typography>
            <ReplyRoundedIcon sx={{ fontSize: 23 }} />
          </Box>
          <Box
            component="button"
            type="button"
            data-testid="chat-selection-forward-action"
            aria-label="Переслать"
            disabled={selectedMessageCount <= 0 || typeof onForwardSelectedMessages !== 'function'}
            onClick={onForwardSelectedMessages}
            sx={mobilePillSx}
          >
            <ForwardRoundedIcon sx={{ fontSize: 23 }} />
            <Typography sx={mobileLabelSx}>Переслать</Typography>
          </Box>
        </Stack>
      </Box>
    );
  }

  return (
    <Box
      data-testid="chat-selection-action-dock"
      sx={{
        flexShrink: 0,
        px: compactMobile ? 1.05 : 1.6,
        pt: compactMobile ? 0.75 : 1,
        pb: compactMobile ? 'max(env(safe-area-inset-bottom), 10px)' : 1.1,
        bgcolor: 'transparent',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={compactMobile ? 0.35 : 1.1}
        sx={{
          maxWidth: 760,
          mx: 'auto',
          minHeight: compactMobile ? 70 : 72,
          px: compactMobile ? 0.75 : 1.5,
          py: compactMobile ? 0.65 : 0.8,
          borderRadius: compactMobile ? 4 : 3,
          bgcolor: alpha(ui.composerBg || theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.96 : 0.94),
          border: `1px solid ${ui.borderSoft}`,
          boxShadow: theme.palette.mode === 'dark' ? '0 14px 36px rgba(0,0,0,0.32)' : '0 14px 34px rgba(15, 23, 42, 0.16)',
          backdropFilter: 'blur(22px) saturate(1.08)',
        }}
      >
        <Box
          component="button"
          type="button"
          data-testid="chat-selection-clear"
          aria-label="Отменить выделение"
          onClick={onClearMessageSelection}
          sx={{
            ...actionButtonSx,
            width: compactMobile ? 44 : 50,
            px: 0,
            flexShrink: 0,
          }}
        >
          <CloseRoundedIcon sx={{ fontSize: compactMobile ? 27 : 30 }} />
        </Box>
        <Typography
          data-testid="chat-selection-count-label"
          sx={{
            flex: '1 1 88px',
            minWidth: 0,
            color: ui.textPrimary || theme.palette.text.primary,
            fontSize: compactMobile ? 16.5 : 19,
            fontWeight: 850,
            lineHeight: 1.1,
            fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
            whiteSpace: 'nowrap',
          }}
        >
          {formatSelectedMessageCount(selectedMessageCount)}
        </Typography>
        <Box
          component="button"
          type="button"
          data-testid="chat-selection-forward-action"
          aria-label="Переслать выбранные сообщения"
          disabled={selectedMessageCount <= 0}
          onClick={onForwardSelectedMessages}
          sx={{
            ...actionButtonSx,
            color: ui.accentText || theme.palette.primary.main,
            flex: '0 0 auto',
          }}
        >
          <ForwardRoundedIcon sx={{ fontSize: compactMobile ? 24 : 28 }} />
          <Typography sx={{ fontSize: compactMobile ? 15.5 : 18, fontWeight: 850, lineHeight: 1, fontFamily: TELEGRAM_CHAT_FONT_FAMILY }}>
            Переслать
          </Typography>
        </Box>
        <Box
          component="button"
          type="button"
          data-testid="chat-selection-delete-action"
          aria-label="Удалить выбранные сообщения"
          disabled={!canDeleteSelectedMessages || selectedMessageCount <= 0 || typeof onDeleteSelectedMessages !== 'function'}
          onClick={onDeleteSelectedMessages}
          sx={{
            ...actionButtonSx,
            color: theme.palette.error.main,
            flex: '0 0 auto',
          }}
        >
          <DeleteRoundedIcon sx={{ fontSize: compactMobile ? 24 : 28 }} />
          <Typography sx={{ fontSize: compactMobile ? 15.5 : 18, fontWeight: 850, lineHeight: 1, fontFamily: TELEGRAM_CHAT_FONT_FAMILY }}>
            Удалить
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
});

export default function ChatThread({
  theme,
  ui,
  isMobile,
  compactMobile = false,
  mobileInteractionsEnabled = false,
  activeConversation,
  activeConversationId,
  navigate,
  threadWallpaperSx,
  messages,
  messagesLoading,
  effectiveLastReadMessageId,
  messagesHasMore,
  loadingOlder,
  onLoadOlder,
  threadScrollRef,
  threadContentRef,
  onThreadScroll,
  bottomRef,
  onBack,
  onOpenInfo,
  onOpenSearch,
  onOpenMenu,
  onOpenReads,
  onOpenAttachmentPreview,
  onReplyMessage,
  onOpenMessageMenu,
  onConfirmAction,
  onCancelAction,
  onEditAction,
  selectedMessageIds = [],
  selectedMessageCount = 0,
  canReplySelectedMessage = false,
  canCopySelectedMessages = false,
  canDeleteSelectedMessages = false,
  onToggleMessageSelection,
  onStartMessageSelection,
  onClearMessageSelection,
  onReplySelectedMessage,
  onCopySelectedMessages,
  onForwardSelectedMessages,
  onDeleteSelectedMessages,
  onOpenComposerMenu,
  composerRef,
  messageText,
  onMessageTextChange,
  onComposerKeyDown,
  onComposerSelectionSync,
  onOpenEmojiPicker,
  onSendMessage,
  onComposerPaste,
  onComposerDrop,
  onComposerDragOver,
  onComposerDragLeave,
  isFileDragActive,
  mentionCandidates = [],
  onSearchMentionPeople,
  showJumpToLatest,
  onJumpToLatest,
  replyMessage,
  onClearReply,
  aiStatus,
  aiStatusDisplay,
  pinnedMessage,
  onOpenPinnedMessage,
  onUnpinPinnedMessage,
  highlightedMessageId,
  headerSubtitle,
  typingLine,
  contextPanelOpen,
  selectedFiles,
  fileCaption,
  onOpenFileDialog,
  onClearSelectedFiles,
  preparingFiles,
  sendingFiles,
  fileUploadProgress,
  selectedFilesSummary,
  getReadTargetRef,
}) {
  const { openDrawer, headerMode } = useMainLayoutShell();
  const resolvedMobileInteractionsEnabled = Boolean(mobileInteractionsEnabled || isMobile);
  const composerDockRef = useRef(null);
  const lastScrollTopRef = useRef(0);
  const composerFocusedRef = useRef(false);
  const threadPinnedToBottomRef = useRef(true);
  const previousComposerLayoutRef = useRef({ composerHeight: null, keyboardInset: null });
  const previousSelectionModeRef = useRef(false);
  const backSwipeRef = useRef({ tracking: false, engaged: false, startX: 0, startY: 0 });
  const [composerHeight, setComposerHeight] = useState(compactMobile ? 92 : 102);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [backSwipeOffset, setBackSwipeOffset] = useState(0);
  const hasConversationTarget = Boolean(String(activeConversationId || '').trim());
  const showConversationLoadingState = !activeConversation && (messagesLoading || hasConversationTarget);
  const showEmbeddedMenuButton = compactMobile && headerMode !== 'notifications-only';
  const selectionMode = Number(selectedMessageCount || 0) > 0;

  useLayoutEffect(() => {
    const previousSelectionMode = previousSelectionModeRef.current;
    previousSelectionModeRef.current = selectionMode;
    if (previousSelectionMode === selectionMode) return;
    const container = threadScrollRef.current;
    if (!container) return;
    const preservedScrollTop = Number(lastScrollTopRef.current || container.scrollTop || 0);
    window.requestAnimationFrame(() => {
      if (threadScrollRef.current !== container) return;
      if (Math.abs(Number(container.scrollTop || 0) - preservedScrollTop) < 1) return;
      container.scrollTop = preservedScrollTop;
      lastScrollTopRef.current = preservedScrollTop;
    });
  }, [selectionMode, threadScrollRef]);

  const scrollPinnedThreadToBottom = useCallback(({ settleFrames = 1 } = {}) => {
    const container = threadScrollRef.current;
    if (!container || !threadPinnedToBottomRef.current) return;

    const scrollToBottom = () => {
      const nextScrollTop = Math.max(0, Number(container.scrollHeight || 0) - Number(container.clientHeight || 0));
      container.scrollTop = nextScrollTop;
      lastScrollTopRef.current = nextScrollTop;
    };

    scrollToBottom();

    let remainingFrames = Math.max(0, Math.floor(Number(settleFrames || 0)));
    if (remainingFrames <= 0) return;

    const settle = () => {
      if (!threadPinnedToBottomRef.current) return;
      scrollToBottom();
      remainingFrames -= 1;
      if (remainingFrames > 0) {
        window.requestAnimationFrame(settle);
      }
    };

    window.requestAnimationFrame(settle);
  }, [threadScrollRef]);

  useEffect(() => {
    const node = composerDockRef.current;
    if (!node) return undefined;

    const updateHeight = () => {
      const nextHeight = Math.round(node.getBoundingClientRect?.().height || 0);
      if (nextHeight > 0) setComposerHeight(nextHeight);
    };

    updateHeight();

    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      updateHeight();
    });
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const previousLayout = previousComposerLayoutRef.current;
    previousComposerLayoutRef.current = { composerHeight, keyboardInset };

    const hadPreviousMeasurement = Number.isFinite(Number(previousLayout.composerHeight))
      || Number.isFinite(Number(previousLayout.keyboardInset));
    if (!hadPreviousMeasurement) return;

    const heightChanged = Math.abs(Number(composerHeight || 0) - Number(previousLayout.composerHeight || 0)) > 1;
    const insetChanged = Math.abs(Number(keyboardInset || 0) - Number(previousLayout.keyboardInset || 0)) > 1;
    if (!heightChanged && !insetChanged) return;

    scrollPinnedThreadToBottom({ settleFrames: 2 });
  }, [composerHeight, keyboardInset, scrollPinnedThreadToBottom]);

  // Простое отслеживание клавиатуры через resize окна
  useEffect(() => {
    if (!compactMobile) {
      setKeyboardInset(0);
      return undefined;
    }

    let lastHeight = window.innerHeight;
    const onResize = () => {
      const diff = lastHeight - window.innerHeight;
      if (Math.abs(diff) > 50) {
        lastHeight = window.innerHeight;
        setKeyboardInset(diff > 0 ? diff : 0);
      }
    };

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [compactMobile]);

  // На Android клавиатура сжимает visualViewport — скроллим при каждом изменении
  const handleComposerFocusChange = useCallback((focused) => {
    composerFocusedRef.current = Boolean(focused);
    if (!focused) return;
    if (!threadPinnedToBottomRef.current) return;

    let scrollFrameId = null;
    let remainingFrames = 2;
    const scrollToEnd = () => {
      if (!composerFocusedRef.current || !threadPinnedToBottomRef.current) return;
      if (scrollFrameId) return;
      scrollFrameId = window.requestAnimationFrame(() => {
        scrollFrameId = null;
        if (!composerFocusedRef.current || !threadPinnedToBottomRef.current) return;
        scrollPinnedThreadToBottom({ settleFrames: 0 });
        remainingFrames -= 1;
        if (remainingFrames > 0) scrollToEnd();
      });
    };

    if (window.visualViewport) {
      const vp = window.visualViewport;
      vp.addEventListener('resize', scrollToEnd);
      vp.addEventListener('scroll', scrollToEnd);
      setTimeout(() => {
        vp.removeEventListener('resize', scrollToEnd);
        vp.removeEventListener('scroll', scrollToEnd);
        if (scrollFrameId) {
          window.cancelAnimationFrame(scrollFrameId);
          scrollFrameId = null;
        }
      }, 2000);
    }
  }, [scrollPinnedThreadToBottom]);

  const handleThreadTouchStart = useCallback((event) => {
    if (!compactMobile || typeof onBack !== 'function') return;
    const touch = event.touches?.[0];
    if (!touch) return;
    const target = event.target;
    if (target?.closest?.('button, a, input, textarea, video, [role="button"], [data-chat-no-back-swipe]')) return;
    const bounds = event.currentTarget?.getBoundingClientRect?.();
    const relativeX = Number(touch.clientX || 0) - Number(bounds?.left || 0);
    if (relativeX > BACK_SWIPE_EDGE_PX) return;
    backSwipeRef.current = {
      tracking: true,
      engaged: false,
      startX: Number(touch.clientX || 0),
      startY: Number(touch.clientY || 0),
    };
    setBackSwipeOffset(0);
  }, [compactMobile, onBack]);

  const handleThreadTouchMove = useCallback((event) => {
    if (!backSwipeRef.current.tracking) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    const deltaX = Number(touch.clientX || 0) - backSwipeRef.current.startX;
    const deltaY = Number(touch.clientY || 0) - backSwipeRef.current.startY;

    if (!backSwipeRef.current.engaged) {
      if (Math.abs(deltaY) > 18 && Math.abs(deltaY) > Math.abs(deltaX)) {
        backSwipeRef.current = { tracking: false, engaged: false, startX: 0, startY: 0 };
        setBackSwipeOffset(0);
        return;
      }
      if (deltaX < BACK_SWIPE_START_PX || Math.abs(deltaX) <= (Math.abs(deltaY) + 4)) return;
      backSwipeRef.current.engaged = true;
    }

    if (event.cancelable) event.preventDefault();
    setBackSwipeOffset(Math.max(0, Math.min(112, deltaX)));
  }, []);

  const finishBackSwipe = useCallback(() => {
    const shouldNavigateBack = backSwipeRef.current.engaged && backSwipeOffset >= BACK_SWIPE_TRIGGER_PX;
    backSwipeRef.current = { tracking: false, engaged: false, startX: 0, startY: 0 };
    setBackSwipeOffset(0);
    if (shouldNavigateBack) onBack?.();
  }, [backSwipeOffset, onBack]);

  const handleThreadScroll = useCallback((event) => {
    const node = event?.currentTarget;
    if (!node) {
      onThreadScroll?.(event);
      return;
    }

    const previousScrollTop = Number(lastScrollTopRef.current || 0);
    const currentScrollTop = Number(node.scrollTop || 0);
    const distanceFromBottom = node.scrollHeight - currentScrollTop - node.clientHeight;
    threadPinnedToBottomRef.current = distanceFromBottom <= COMPOSER_STICK_DISTANCE_PX;

    if (
      composerFocusedRef.current
      && currentScrollTop < (previousScrollTop - BLUR_SCROLL_DELTA_PX)
      && distanceFromBottom > COMPOSER_STICK_DISTANCE_PX
    ) {
      composerRef.current?.blur?.();
    }

    lastScrollTopRef.current = currentScrollTop;
    onThreadScroll?.(event);
  }, [composerRef, onThreadScroll]);

  if (!activeConversation) {
    return (
      <Stack
        data-testid={showConversationLoadingState ? 'chat-thread-loading-state' : 'chat-empty-state'}
        alignItems="center"
        justifyContent="center"
        className="chat-native-shell chat-no-select"
        sx={{
          flex: 1,
          minWidth: 0,
          minHeight: 360,
          px: 3,
          textAlign: 'center',
          ...threadWallpaperSx,
        }}
      >
        <Avatar
          sx={{
            width: 72,
            height: 72,
            mb: 2,
            bgcolor: ui.accentSoft,
            color: ui.accentText,
          }}
        >
          {showConversationLoadingState ? <CircularProgress size={28} color="inherit" /> : <SmartToyOutlinedIcon fontSize="large" />}
        </Avatar>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>
          {showConversationLoadingState ? 'Открываем диалог…' : 'Выберите чат'}
        </Typography>
        <Typography variant="body2" sx={{ mt: 1, color: ui.textSecondary, maxWidth: 460 }}>
          {showConversationLoadingState
            ? 'Загружаем сообщения и карточку собеседника.'
            : 'Откройте диалог слева, чтобы продолжить переписку, отправить файл или поделиться задачей.'}
        </Typography>
      </Stack>
    );
  }

  return (
    <Box
      data-testid="chat-thread-root"
      className="chat-native-shell"
      onTouchStart={handleThreadTouchStart}
      onTouchMove={handleThreadTouchMove}
      onTouchEnd={finishBackSwipe}
      onTouchCancel={finishBackSwipe}
      sx={{
        '--chat-action-bg': ui.headerActionBg || alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.04 : 0.06),
        '--chat-action-hover-bg': ui.headerActionHoverBg || ui.sidebarRowHover,
        '--chat-action-press-bg': ui.headerActionBg || alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.06 : 0.08),
        '--chat-action-active-bg': ui.accentSoft,
        '--chat-action-active-text': ui.accentText,
        '--chat-font-family': TELEGRAM_CHAT_FONT_FAMILY,
        '--chat-focus-ring': ui.focusRing,
        '--chat-skeleton-base': ui.skeletonBase,
        '--chat-skeleton-wave': ui.skeletonWave,
        '--chat-skeleton-own-bg': alpha(ui.bubbleOwnBg || '#d9fdd3', theme.palette.mode === 'dark' ? 0.34 : 0.58),
        '--chat-skeleton-other-bg': alpha(ui.bubbleOtherBg || '#ffffff', theme.palette.mode === 'dark' ? 0.5 : 0.82),
        '--chat-skeleton-shadow': ui.shadowSoft,
        flex: 1,
        minWidth: 0,
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: compactMobile ? ui.threadBg : (ui.desktopShellBg || ui.threadBg),
        position: 'relative',
        overscrollBehaviorY: compactMobile ? 'none' : 'contain',
        borderLeft: compactMobile ? 'none' : `1px solid ${ui.desktopShellBorder || ui.borderSoft}`,
        transform: compactMobile && backSwipeOffset > 0 ? `translateX(${backSwipeOffset}px)` : 'translateX(0)',
        transition: compactMobile && backSwipeOffset > 0 ? 'none' : 'transform 170ms ease-out',
        boxShadow: compactMobile && backSwipeOffset > 0 ? `-20px 0 40px ${alpha('#020617', 0.24)}` : 'none',
        fontFamily: 'var(--chat-font-family)',
        '& .MuiTypography-root, & button, & input, & textarea': {
          fontFamily: 'var(--chat-font-family)',
        },
      }}
    >
      <ChatThreadHeader
        theme={theme}
        ui={ui}
        isMobile={isMobile}
        compactMobile={compactMobile}
        activeConversation={activeConversation}
        headerSubtitle={headerSubtitle}
        typingLine={typingLine}
        contextPanelOpen={contextPanelOpen}
        onBack={onBack}
        onOpenDrawer={showEmbeddedMenuButton ? openDrawer : undefined}
        onOpenInfo={onOpenInfo}
        onOpenSearch={onOpenSearch}
        onOpenMenu={onOpenMenu}
        selectionMode={selectionMode}
        selectedMessageCount={selectedMessageCount}
        canCopySelectedMessages={canCopySelectedMessages}
        onClearMessageSelection={onClearMessageSelection}
        onCopySelectedMessages={onCopySelectedMessages}
        onForwardSelectedMessages={onForwardSelectedMessages}
      />

      <AnimatePresence initial={false}>
        {aiStatusDisplay?.visible ? (
          <AiInteractiveStatusBanner
            aiStatusDisplay={aiStatusDisplay}
            theme={theme}
            ui={ui}
            compactMobile={compactMobile}
          />
        ) : aiStatus ? (
          <AiRunStatusBanner
            aiStatus={aiStatus}
            theme={theme}
            ui={ui}
            compactMobile={compactMobile}
          />
        ) : null}
      </AnimatePresence>

      <PinnedMessageBar
        theme={theme}
        ui={ui}
        compactMobile={compactMobile}
        pinnedMessage={selectionMode ? null : pinnedMessage}
        onOpenPinnedMessage={onOpenPinnedMessage}
        onUnpinPinnedMessage={onUnpinPinnedMessage}
      />

      <ChatMessageList
        theme={theme}
        ui={ui}
        compactMobile={compactMobile}
        mobileInteractionsEnabled={resolvedMobileInteractionsEnabled}
        activeConversation={activeConversation}
        navigate={navigate}
        threadWallpaperSx={threadWallpaperSx}
        messages={messages}
        messagesLoading={messagesLoading}
        effectiveLastReadMessageId={effectiveLastReadMessageId}
        messagesHasMore={messagesHasMore}
        loadingOlder={loadingOlder}
        onLoadOlder={onLoadOlder}
        threadScrollRef={threadScrollRef}
        threadContentRef={threadContentRef}
        onThreadScroll={handleThreadScroll}
        bottomRef={bottomRef}
        onOpenReads={onOpenReads}
        onOpenAttachmentPreview={onOpenAttachmentPreview}
        onReplyMessage={onReplyMessage}
        onOpenMessageMenu={onOpenMessageMenu}
        onConfirmAction={onConfirmAction}
        onCancelAction={onCancelAction}
        onEditAction={onEditAction}
        selectedMessageIds={selectedMessageIds}
        onToggleMessageSelection={onToggleMessageSelection}
        onStartMessageSelection={onStartMessageSelection}
        highlightedMessageId={highlightedMessageId}
        showJumpToLatest={showJumpToLatest}
        onJumpToLatest={onJumpToLatest}
        onComposerDrop={onComposerDrop}
        onComposerDragOver={onComposerDragOver}
        onComposerDragLeave={onComposerDragLeave}
        isFileDragActive={isFileDragActive}
        composerHeight={composerHeight}
        keyboardInset={keyboardInset}
        getReadTargetRef={getReadTargetRef}
      />

      {selectionMode ? (
        <SelectionActionDock
          theme={theme}
          ui={ui}
          compactMobile={compactMobile}
          selectedMessageCount={selectedMessageCount}
          canReplySelectedMessage={canReplySelectedMessage}
          canDeleteSelectedMessages={canDeleteSelectedMessages}
          onClearMessageSelection={onClearMessageSelection}
          onReplySelectedMessage={onReplySelectedMessage}
          onForwardSelectedMessages={onForwardSelectedMessages}
          onDeleteSelectedMessages={onDeleteSelectedMessages}
        />
      ) : (
        <ChatComposer
          theme={theme}
          ui={ui}
          compactMobile={compactMobile}
          activeConversationId={activeConversationId}
          selectedFiles={selectedFiles}
          fileCaption={fileCaption}
          onOpenFileDialog={onOpenFileDialog}
          onClearSelectedFiles={onClearSelectedFiles}
          preparingFiles={preparingFiles}
          sendingFiles={sendingFiles}
          fileUploadProgress={fileUploadProgress}
          selectedFilesSummary={selectedFilesSummary}
          replyMessage={replyMessage}
          onClearReply={onClearReply}
          onOpenComposerMenu={onOpenComposerMenu}
          composerRef={composerRef}
          messageText={messageText}
          onMessageTextChange={onMessageTextChange}
          onComposerKeyDown={onComposerKeyDown}
          onComposerSelectionSync={onComposerSelectionSync}
          onOpenEmojiPicker={onOpenEmojiPicker}
          onSendMessage={onSendMessage}
          onComposerPaste={onComposerPaste}
          onComposerDrop={onComposerDrop}
          onComposerDragOver={onComposerDragOver}
          onComposerDragLeave={onComposerDragLeave}
          onComposerFocusChange={handleComposerFocusChange}
          mentionCandidates={mentionCandidates}
          onSearchMentionPeople={onSearchMentionPeople}
          composerDockRef={composerDockRef}
          keyboardInset={keyboardInset}
        />
      )}
    </Box>
  );
}
