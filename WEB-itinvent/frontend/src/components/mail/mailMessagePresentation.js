import { alpha } from '@mui/material/styles';
import { normalizeMailRecipient } from './mailComposeState';
import { formatMailListDateLabel } from './mailDateGrouping';
import { getMailPersonDisplay, getMailPersonEmail } from './mailPeople';

const MAIL_RENDERED_CONTENT_LAYOUT_SX = {
  width: '100%',
  maxWidth: '100%',
  minWidth: 0,
  overflowX: 'hidden',
  boxSizing: 'border-box',
  '& div:not([data-mail-table-scroll="true"]), & section, & article, & main, & header, & footer, & p, & blockquote, & center, & ul, & ol, & li': {
    maxWidth: '100% !important',
    minWidth: '0 !important',
    boxSizing: 'border-box',
  },
  '& [data-mail-table-scroll="true"]': {
    width: '100%',
    maxWidth: '100%',
    overflowX: 'auto',
    overflowY: 'hidden',
    WebkitOverflowScrolling: 'touch',
    boxSizing: 'border-box',
  },
};

export const getMailRenderedContentSx = ({ ui, theme, variant = 'message', mine = false, quoted = false } = {}) => {
  const isConversation = variant === 'conversation';
  const isDark = Boolean(ui?.isDark);
  const inheritedText = mine
    ? (isDark ? alpha(theme.palette.common.white, 0.96) : theme.palette.text.primary)
    : (quoted ? ui?.textSecondary : ui?.textPrimary);
  const linkColor = mine
    ? (isDark ? '#dbeafe' : theme.palette.primary.main)
    : (isDark ? '#8cc8ff' : theme.palette.primary.main);
  const placeholderBorder = mine
    ? alpha(theme.palette.common.white, 0.35)
    : ui?.borderSoft;
  const placeholderBg = mine
    ? alpha(theme.palette.common.white, 0.08)
    : ui?.actionBg;
  const placeholderText = mine
    ? alpha(theme.palette.common.white, 0.88)
    : ui?.textSecondary;

  return {
    ...MAIL_RENDERED_CONTENT_LAYOUT_SX,
    ...(isConversation ? { mt: 0.55 } : {}),
    ...(quoted ? {
      mt: 1.1,
      pt: 1.1,
      borderTop: '1px solid',
      borderColor: ui?.borderSoft,
    } : {}),
    color: inheritedText,
    fontFamily: 'var(--mail-message-font)',
    fontSize: isConversation ? '0.9rem' : (quoted ? '0.9rem' : '0.9375rem'),
    lineHeight: 1.5,
    '& a': {
      color: linkColor,
      textDecorationColor: alpha(linkColor, 0.52),
    },
    '& blockquote, & .gmail_quote, & [data-mail-quoted-block="true"]': {
      m: isConversation ? '0.65em 0 0 0' : '0.8em 0 0 0',
      pl: isConversation ? 1 : 1.4,
      py: isConversation ? 0 : 0.2,
      borderLeft: '3px solid',
      borderColor: placeholderBorder,
      color: quoted || !mine ? ui?.textSecondary : inheritedText,
      fontSize: '0.9rem',
    },
    '& [data-mail-signature="true"], & .gmail_signature, & #Signature': {
      color: ui?.textSecondary,
      opacity: 0.88,
    },
    ...(isDark ? {
      '& p': { m: 0 },
      '& p + p': { mt: isConversation ? '0.45em' : '0.76em' },
    } : {}),
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
    '& img': {
      maxWidth: '100% !important',
      height: 'auto !important',
      objectFit: 'contain',
    },
    '& video, & iframe': {
      maxWidth: '100% !important',
      height: 'auto !important',
    },
    '& table': {
      maxWidth: '100%',
      borderCollapse: 'collapse',
    },
    '& [data-mail-table-scroll="true"]': {
      maxWidth: '100%',
      overflowX: 'auto',
      overflowY: 'hidden',
      WebkitOverflowScrolling: 'touch',
    },
    '& pre': {
      fontFamily: 'var(--mail-mono-font)',
      fontSize: isConversation ? '0.82rem' : '0.9rem',
      overflowX: 'auto',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      ...(isDark && !isConversation ? {
        p: 1,
        borderRadius: '8px',
        bgcolor: ui?.actionBg,
      } : {}),
    },
    '& .mail-image-placeholder': {
      ...(isConversation ? { mt: 0.45 } : {}),
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: isConversation ? 112 : 132,
      px: isConversation ? 1.2 : 1.4,
      py: isConversation ? 1.1 : 1.2,
      borderRadius: isConversation ? '8px' : '10px',
      border: '1px dashed',
      borderColor: placeholderBorder,
      bgcolor: placeholderBg,
      color: placeholderText,
      fontFamily: 'var(--mail-ui-font)',
      fontSize: isConversation ? '0.8rem' : '0.88rem',
      textAlign: 'center',
    },
  };
};

export const formatTime = (isoStr) => formatMailListDateLabel(isoStr);

export const formatFullDate = (isoStr) => {
  if (!isoStr) return '-';
  return new Date(isoStr).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const formatMailSyncedAt = (value, now = Date.now()) => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const nowDate = new Date(now);
  const sameDay = date.getFullYear() === nowDate.getFullYear()
    && date.getMonth() === nowDate.getMonth()
    && date.getDate() === nowDate.getDate();
  if (sameDay) return `Синхронизировано сегодня в ${time}`;
  return `Синхронизировано ${date.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
};

export const formatFileSize = (bytes) => {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${String(size.toFixed(unitIndex === 0 ? 0 : (size >= 10 ? 0 : 1))).replace('.', ',')} ${units[unitIndex]}`;
};

export const sumFilesSize = (files) => (
  Array.isArray(files) ? files.reduce((acc, file) => acc + Number(file?.size || 0), 0) : 0
);

export const sumAttachmentSize = (attachments) => (
  Array.isArray(attachments) ? attachments.reduce((acc, item) => acc + Number(item?.size || 0), 0) : 0
);

export const getInitials = (email) => {
  const source = String(email || '');
  if (!source) return '?';
  const name = source.split('@')[0] || '';
  const parts = name.split(/[._-]/);
  if (parts.length >= 2) return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
};

export const getAvatarColor = (email) => {
  const colors = ['#1976d2', '#388e3c', '#d32f2f', '#7b1fa2', '#f57c00', '#0097a7', '#5d4037', '#455a64'];
  const text = String(email || '');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = text.charCodeAt(index) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
};

export const buildSenderPerson = (value) => (
  value?.sender_person || {
    display: value?.sender_display,
    name: value?.sender_name,
    email: value?.sender_email,
  }
);

export const getSenderDisplay = (value, fallback = '-') => (
  getMailPersonDisplay(buildSenderPerson(value), String(value?.sender || fallback || '-'))
);

export const getSenderEmail = (value) => (
  getMailPersonEmail(buildSenderPerson(value))
  || normalizeMailRecipient(value?.sender || '')
);
