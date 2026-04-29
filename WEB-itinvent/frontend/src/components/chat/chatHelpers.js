import { API_V1_BASE } from '../../api/client';

export const CHAT_FILE_ACCEPT = '.jpg,.jpeg,.png,.gif,.webp,.bmp,.pdf,.doc,.docx,.docm,.rtf,.odt,.xls,.xlsx,.xlsm,.ods,.ppt,.pptx,.pptm,.odp,.txt,.csv,.tsv,.log,.md,.json,.xml';
export const CHAT_MAX_FILE_COUNT = 5;
export const CHAT_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const CHAT_THREAD_NEAR_BOTTOM_DISTANCE_PX = 96;
export const CHAT_IMAGE_ATTACHMENT_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']);
export const CHAT_VIDEO_ATTACHMENT_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'm4v']);
export const CHAT_ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz']);
export const CHAT_ARCHIVE_MIME_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/x-7z-compressed',
  'application/gzip',
  'application/x-gzip',
  'application/x-tar',
]);

const CP1251_TABLE = [
  'Ђ', 'Ѓ', '‚', 'ѓ', '„', '…', '†', '‡',
  '€', '‰', 'Љ', '‹', 'Њ', 'Ќ', 'Ћ', 'Џ',
  'ђ', '‘', '’', '“', '”', '•', '–', '—',
  '', '™', 'љ', '›', 'њ', 'ќ', 'ћ', 'џ',
  '\u00A0', 'Ў', 'ў', 'Ј', '¤', 'Ґ', '¦', '§',
  'Ё', '©', 'Є', '«', '¬', '\u00AD', '®', 'Ї',
  '°', '±', 'І', 'і', 'ґ', 'µ', '¶', '·',
  'ё', '№', 'є', '»', 'ј', 'Ѕ', 'ѕ', 'ї',
  'А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З',
  'И', 'Й', 'К', 'Л', 'М', 'Н', 'О', 'П',
  'Р', 'С', 'Т', 'У', 'Ф', 'Х', 'Ц', 'Ч',
  'Ш', 'Щ', 'Ъ', 'Ы', 'Ь', 'Э', 'Ю', 'Я',
  'а', 'б', 'в', 'г', 'д', 'е', 'ж', 'з',
  'и', 'й', 'к', 'л', 'м', 'н', 'о', 'п',
  'р', 'с', 'т', 'у', 'ф', 'х', 'ц', 'ч',
  'ш', 'щ', 'ъ', 'ы', 'ь', 'э', 'ю', 'я',
];

const CP1251_ENCODE_MAP = new Map();
CP1251_TABLE.forEach((char, index) => {
  if (char) CP1251_ENCODE_MAP.set(char, 0x80 + index);
});

const looksLikeUtf8Mojibake = (value) => /(?:Р[\u0400-\u045F]|С[\u0400-\u045F]|вЂ.|Ð.|Ñ.)/.test(String(value || ''));

export const normalizeChatText = (value) => {
  const raw = String(value ?? '');
  if (!raw || !looksLikeUtf8Mojibake(raw) || typeof TextDecoder === 'undefined') return raw;

  try {
    const bytes = [];
    for (const char of raw) {
      const code = char.charCodeAt(0);
      if (code <= 0x7F) {
        bytes.push(code);
        continue;
      }
      const mapped = CP1251_ENCODE_MAP.get(char);
      if (typeof mapped !== 'number') return raw;
      bytes.push(mapped);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return raw;
  }
};

const normalizeTrimmedChatText = (value, fallback = '') => {
  const normalized = normalizeChatText(value).trim();
  return normalized || fallback;
};

const MARKDOWN_TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

export const hasChatMarkdownTable = (value) => {
  const text = String(value || '').trim();
  if (!text) return false;
  const lines = text.split(/\r?\n/);
  return lines.some((line, index) => (
    /\|/.test(line)
    && MARKDOWN_TABLE_SEPARATOR_RE.test(lines[index + 1] || '')
  ));
};

export const detectChatBodyFormat = (value) => {
  const text = String(value || '').trim();
  if (!text) return 'plain';
  const lines = text.split(/\r?\n/);
  if (/^\s{0,3}#{1,6}\s+\S/m.test(text)) return 'markdown';
  if (/^\s{0,3}(?:```|~~~)/m.test(text)) return 'markdown';
  if (/^\s{0,3}>\s+\S/m.test(text)) return 'markdown';
  if (/^\s{0,3}- \[[ xX]\]\s+\S/m.test(text)) return 'markdown';
  if (/^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)\S/m.test(text)) return 'markdown';
  if (/(^|\s)(?:\*\*|__)[^\n]+(?:\*\*|__)(?=\s|[.,!?;:]|$)/.test(text)) return 'markdown';
  if (/(^|\s)`[^`\n]+`(?=\s|[.,!?;:]|$)/.test(text)) return 'markdown';
  if (/\[[^\]\n]+\]\((?:https?:\/\/|\/|#)[^)]+\)/i.test(text)) return 'markdown';
  return hasChatMarkdownTable(text) ? 'markdown' : 'plain';
};

export const stripChatMarkdownPreview = (value) => {
  const text = normalizeChatText(value).trim();
  if (!text) return '';
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const cleanedLines = [];
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^(?:```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (MARKDOWN_TABLE_SEPARATOR_RE.test(trimmed)) continue;

    let cleaned = trimmed;
    if (/^\|.*\|$/.test(cleaned)) {
      cleaned = cleaned
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean)
        .join(' | ');
    }
    cleaned = cleaned
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^\s{0,3}>\s?/, '')
      .replace(/^\s{0,3}- \[[ xX]\]\s+/, '')
      .replace(/^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)/, '')
      .replace(/\[([^\]\n]+)\]\([^)]+\)/g, '$1')
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[*_~]{1,3}/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleaned) cleanedLines.push(cleaned);
    if (!inFence && cleanedLines.length >= 3) break;
  }

  return cleanedLines.join(' ').trim();
};

export const getChatFileExtension = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized.includes('.')) return '';
  return normalized.split('.').pop() || '';
};

export const isArchiveMimeType = (value) => CHAT_ARCHIVE_MIME_TYPES.has(String(value || '').trim().toLowerCase());

export const isArchiveFile = (file) => {
  const fileName = String(file?.name || file?.file_name || file?.fileName || '').trim();
  const mimeType = String(file?.type || file?.mime_type || file?.mimeType || '').trim().toLowerCase();
  const extension = getChatFileExtension(fileName);
  if (extension && CHAT_ARCHIVE_EXTENSIONS.has(extension)) {
    return true;
  }
  return isArchiveMimeType(mimeType);
};

export const formatShortTime = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
};

export const formatFullDate = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const getDateDividerLabel = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return 'Сегодня';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Вчера';
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
};

export const formatFileSize = (value) => {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) return '0 Б';
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} КБ`;
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`;
};

export const getMessagePreview = (message) => {
  if (!message) return 'Сообщение';
  if (message.kind === 'task_share') return 'Поделились задачей';
  const body = normalizeTrimmedChatText(message.body);
  if (message.kind === 'file' && body) return body;
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (attachments.length > 0) {
    if (attachments.length === 1) {
      return `Файл: ${normalizeTrimmedChatText(attachments[0]?.file_name, 'вложение')}`;
    }
    return `Файлы: ${attachments.length}`;
  }
  return body || 'Сообщение';
};

export const getEmojiOnlyCount = (value) => {
  const text = String(value || '').trim();
  if (!text) return 0;
  try {
    if (!/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+$/u.test(text)) return 0;
    const count = Array.from(text.matchAll(/\p{Extended_Pictographic}/gu)).length;
    return count >= 1 && count <= 3 ? count : 0;
  } catch {
    return 0;
  }
};

export const normalizeChatAttachmentUrl = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (/^(?:https?:|blob:|data:|\/\/)/i.test(normalized)) return normalized;

  const apiV1Base = String(API_V1_BASE || '/api/v1').replace(/\/+$/, '') || '/api/v1';
  const apiBase = apiV1Base.endsWith('/v1') ? apiV1Base.slice(0, -3) : apiV1Base.replace(/\/v1\/?$/, '');
  if (normalized.startsWith('/api/v1/')) {
    return `${apiV1Base}${normalized.slice('/api/v1'.length)}`;
  }
  if (normalized.startsWith('api/v1/')) {
    return `${apiV1Base}/${normalized.slice('api/v1/'.length)}`;
  }
  if (normalized.startsWith('/api/')) {
    return `${apiBase || '/api'}${normalized.slice('/api'.length)}`;
  }
  if (normalized.startsWith('api/')) {
    return `${apiBase || '/api'}/${normalized.slice('api/'.length)}`;
  }
  // Если URL не начинается с / или api/, добавляем apiV1Base
  if (!normalized.startsWith('/')) {
    console.warn(`Attachment URL does not start with /, prepending API base: ${normalized}`);
    return `${apiV1Base}/${normalized}`;
  }
  return normalized;
};

const getAttachmentMimeType = (attachment) => String(
  attachment?.mime_type
  || attachment?.mimeType
  || attachment?.content_type
  || attachment?.contentType
  || attachment?.file_mime
  || attachment?.fileMime
  || attachment?.type
  || '',
).trim().toLowerCase();

const getAttachmentFileName = (attachment) => String(
  attachment?.file_name
  || attachment?.fileName
  || attachment?.name
  || '',
).trim().toLowerCase();

export const isImageAttachment = (attachment) => {
  const mimeType = getAttachmentMimeType(attachment);
  if (mimeType.startsWith('image/')) return true;
  const extension = getChatFileExtension(getAttachmentFileName(attachment));
  return CHAT_IMAGE_ATTACHMENT_EXTENSIONS.has(extension);
};
export const isVideoAttachment = (attachment) => {
  const mimeType = getAttachmentMimeType(attachment);
  if (mimeType.startsWith('video/')) return true;
  const extension = getChatFileExtension(getAttachmentFileName(attachment));
  return CHAT_VIDEO_ATTACHMENT_EXTENSIONS.has(extension);
};
export const isMediaAttachment = (attachment) => isImageAttachment(attachment) || isVideoAttachment(attachment);
export const isPdfAttachment = (attachment) => getAttachmentMimeType(attachment) === 'application/pdf';

export const buildAttachmentUrl = (messageId, attachmentId, options = {}) => {
  const baseUrl = `${API_V1_BASE}/chat/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/file`;
  const params = new URLSearchParams();
  if (options?.inline) params.set('inline', '1');
  if (String(options?.variant || '').trim()) params.set('variant', String(options.variant).trim());
  const query = params.toString();
  return query ? `${baseUrl}?${query}` : baseUrl;
};

export const avatarLabel = (item) => {
  const title = normalizeTrimmedChatText(item?.title || item?.full_name || item?.username);
  if (!title) return '#';
  const parts = title.split(/\s+/).filter(Boolean);
  return (parts.length >= 2 ? `${parts[0][0] || ''}${parts[1][0] || ''}` : title.slice(0, 2)).toUpperCase();
};

export const getStatusMeta = (value) => {
  if (value === 'in_progress') return ['В работе', '#d97706', 'rgba(217,119,6,0.14)'];
  if (value === 'review') return ['На проверке', '#2563eb', 'rgba(37,99,235,0.14)'];
  if (value === 'done') return ['Выполнена', '#059669', 'rgba(5,150,105,0.14)'];
  return ['Новая', '#2563eb', 'rgba(37,99,235,0.14)'];
};

export const getPriorityMeta = (value) => {
  if (value === 'urgent') return ['Срочный', '#b91c1c', 'rgba(185,28,28,0.14)'];
  if (value === 'high') return ['Высокий', '#d97706', 'rgba(217,119,6,0.14)'];
  if (value === 'low') return ['Низкий', '#64748b', 'rgba(100,116,139,0.14)'];
  return ['Обычный', '#0f766e', 'rgba(15,118,110,0.14)'];
};

export const getTaskAssignee = (task) => normalizeTrimmedChatText(task?.assignee_full_name || task?.assignee_username, 'Не назначен');

export const buildChatDraftKey = (userId, conversationId) => {
  const normalizedUserId = String(userId || '').trim();
  const normalizedConversationId = String(conversationId || '').trim();
  if (!normalizedUserId || !normalizedConversationId) return '';
  return `chat:draft:${normalizedUserId}:${normalizedConversationId}`;
};

export const buildChatPinnedMessageKey = (userId, conversationId) => {
  const normalizedUserId = String(userId || '').trim();
  const normalizedConversationId = String(conversationId || '').trim();
  if (!normalizedUserId || !normalizedConversationId) return '';
  return `chat:pinned-message:${normalizedUserId}:${normalizedConversationId}`;
};

export const getReplyPreviewText = (replyPreview) => {
  if (!replyPreview || typeof replyPreview !== 'object') return '';
  const markdownPreview = stripChatMarkdownPreview(replyPreview.task_title || replyPreview.body);
  if (markdownPreview) return markdownPreview;
  if (replyPreview.kind === 'task_share') {
    return normalizeTrimmedChatText(replyPreview.task_title || replyPreview.body, 'Карточка задачи');
  }
  if (replyPreview.kind === 'file') {
    const body = normalizeTrimmedChatText(replyPreview.body);
    if (body) return body;
    const attachmentsCount = Number(replyPreview.attachments_count || 0);
    return attachmentsCount > 1 ? `Файлы: ${attachmentsCount}` : 'Файл';
  }
  return normalizeTrimmedChatText(replyPreview.body);
};

export const getSearchResultPreview = (message) => {
  if (!message) return 'Сообщение';
  if (message.kind === 'task_share') {
    return normalizeTrimmedChatText(message?.task_preview?.title, 'Карточка задачи');
  }
  const body = normalizeTrimmedChatText(message.body);
  if (message.kind === 'file' && body) return body;
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  if (attachments.length > 0) {
    if (attachments.length === 1) {
      return `Файл: ${normalizeTrimmedChatText(attachments[0]?.file_name, 'вложение')}`;
    }
    return `Файлы: ${attachments.length}`;
  }
  return body || 'Сообщение';
};

export const formatPresenceText = (presence) => {
  if (!presence || typeof presence !== 'object') return 'Не в сети';
  const statusText = normalizeTrimmedChatText(presence.status_text);
  if (statusText) return statusText;
  if (presence.is_online) return 'В сети';
  const raw = String(presence.last_seen_at || '').trim();
  if (!raw) return 'Не в сети';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return 'Не в сети';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 60_000) return 'Был(а) только что';
  if (diffMs < 60 * 60 * 1000) return `Был(а) ${Math.max(1, Math.floor(diffMs / 60_000))} мин назад`;
  if (date.toDateString() === now.toDateString()) return `Сегодня в ${formatShortTime(raw)}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Вчера в ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  }
  return formatFullDate(raw);
};

export const getGroupOnlineCount = (conversation) => {
  const explicitOnlineCount = Number(conversation?.online_member_count);
  if (Number.isFinite(explicitOnlineCount) && explicitOnlineCount >= 0) {
    return explicitOnlineCount;
  }
  if (Array.isArray(conversation?.members)) {
    return conversation.members.filter((member) => Boolean(member?.user?.presence?.is_online)).length;
  }
  if (Array.isArray(conversation?.member_preview)) {
    return conversation.member_preview.filter((member) => Boolean(member?.user?.presence?.is_online)).length;
  }
  return 0;
};

export const getConversationHeaderSubtitle = (conversation) => {
  if (!conversation) return '';
  if (conversation.kind === 'direct') {
    return formatPresenceText(conversation?.direct_peer?.presence);
  }
  return `${Number(conversation?.member_count || 0)} участников • ${getGroupOnlineCount(conversation)} онлайн`;
};

export const getConversationStatusLine = (conversation) => {
  const preview = normalizeTrimmedChatText(conversation?.last_message_preview, 'Сообщений пока нет');
  if (!conversation) return preview;
  if (conversation.kind === 'direct') {
    return `${formatPresenceText(conversation?.direct_peer?.presence)} • ${preview}`;
  }
  return `${getGroupOnlineCount(conversation)} онлайн • ${preview}`;
};

export const getPersonStatusLine = (person) => {
  const username = normalizeTrimmedChatText(person?.username);
  const presenceText = formatPresenceText(person?.presence);
  return username ? `@${username} • ${presenceText}` : presenceText;
};

export const sortByName = (items) => (
  [...items].sort((left, right) => {
    const a = normalizeTrimmedChatText(left?.full_name || left?.username || left?.title).toLowerCase();
    const b = normalizeTrimmedChatText(right?.full_name || right?.username || right?.title).toLowerCase();
    return a.localeCompare(b, 'ru');
  })
);

export const getMessageIndexById = (messages, messageId) => {
  const normalizedMessageId = String(messageId || '').trim();
  if (!normalizedMessageId) return -1;
  const list = Array.isArray(messages) ? messages : [];
  for (let index = 0; index < list.length; index += 1) {
    if (String(list[index]?.id || '').trim() === normalizedMessageId) return index;
  }
  return -1;
};

export const resolveLatestMessageIdInOrder = (messages, ...messageIds) => {
  const list = Array.isArray(messages) ? messages : [];
  let latestIndex = -1;
  let latestMessageId = '';
  const normalizedIds = messageIds
    .flat()
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  normalizedIds.forEach((candidateId) => {
    const candidateIndex = getMessageIndexById(list, candidateId);
    if (candidateIndex > latestIndex) {
      latestIndex = candidateIndex;
      latestMessageId = candidateId;
    }
  });

  return latestMessageId || normalizedIds[0] || '';
};

export const isMessageReadByMarker = (messages, message, markerId) => {
  if (!message || message?.is_own) return true;
  const markerIndex = getMessageIndexById(messages, markerId);
  if (markerIndex < 0) return false;
  const messageIndex = getMessageIndexById(messages, message?.id);
  return messageIndex > -1 && messageIndex <= markerIndex;
};

export const countUnreadIncomingAfterMarker = (messages, markerId) => {
  const list = Array.isArray(messages) ? messages : [];
  const markerIndex = getMessageIndexById(list, markerId);
  let total = 0;
  list.forEach((message, index) => {
    if (message?.is_own) return;
    if (markerIndex < 0 || index > markerIndex) total += 1;
  });
  return total;
};

export const getUnreadAnchorId = (messages, viewerLastReadMessageId) => {
  const normalizedMarker = String(viewerLastReadMessageId || '').trim();
  const list = Array.isArray(messages) ? messages : [];
  const markerIndex = getMessageIndexById(list, normalizedMarker);
  const startIndex = markerIndex >= 0 ? (markerIndex + 1) : 0;

  for (let index = startIndex; index < list.length; index += 1) {
    if (!list[index]?.is_own) {
      return String(list[index]?.id || '').trim();
    }
  }
  return '';
};

export const buildTimelineItems = (messages, viewerLastReadMessageId) => {
  const unreadAnchorId = getUnreadAnchorId(messages, viewerLastReadMessageId);
  const timeline = [];
  let lastDateKey = '';
  let unreadInserted = false;

  for (const message of Array.isArray(messages) ? messages : []) {
    const currentDateKey = new Date(message?.created_at || '').toDateString();
    if (currentDateKey && currentDateKey !== 'Invalid Date' && currentDateKey !== lastDateKey) {
      timeline.push({
        type: 'date',
        key: `date:${currentDateKey}`,
        label: getDateDividerLabel(message?.created_at),
      });
      lastDateKey = currentDateKey;
    }

    if (!unreadInserted && unreadAnchorId && String(message?.id || '').trim() === unreadAnchorId) {
      timeline.push({
        type: 'unread',
        key: `unread:${unreadAnchorId}`,
        label: 'Непрочитанные сообщения',
      });
      unreadInserted = true;
    }

    timeline.push({
      type: 'message',
      key: `message:${String(message?.renderKey || message?.render_key || message?.id || '').trim()}`,
      message,
    });
  }

  return timeline;
};
