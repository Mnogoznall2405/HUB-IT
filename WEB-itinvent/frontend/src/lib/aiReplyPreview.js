export const AI_REPLY_NOTIFICATION_TITLE = 'ИИ ответил';
const AI_REPLY_PREVIEW_LIMIT = 140;

const MEMORY_MARK_LINE = /\n*_?Учтена личная память:[^\n]*_?\s*$/;
const MARKDOWN_LINK = /!?\[([^\]]*)\]\([^)]*\)/g;
const MARKDOWN_NOISE = /[*_`#>~|]+/g;

// Beginning of an AI answer as plain text for a notification: no markdown and no
// personal-memory mark. Mirrors backend/chat/notification_planner.py::ai_reply_preview.
export function buildAiReplyNotificationPreview(value, limit = AI_REPLY_PREVIEW_LIMIT) {
  const text = String(value || '')
    .replace(MEMORY_MARK_LINE, '')
    .replace(MARKDOWN_LINK, '$1')
    .replace(MARKDOWN_NOISE, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length <= limit ? text : `${text.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}
