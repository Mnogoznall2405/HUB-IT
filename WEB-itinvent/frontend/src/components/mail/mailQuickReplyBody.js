import { mergeQuotedHistoryHtml } from './mailQuotedHistory';

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const formatQuoteTimestamp = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const pad = (part) => String(part).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const buildQuickReplyHtml = (body = '') => (
  `<p>${escapeHtml(body).replace(/\n/g, '<br/>')}</p>`
);

export const resolveMailReplyQuoteHtml = (message, context = {}) => {
  const fromContext = String(context?.quote_html || '').trim();
  if (fromContext) return fromContext;

  const bodyHtml = String(message?.body_html || '').trim();
  const bodyText = String(message?.body_text || '').trim();
  const inner = bodyHtml || (bodyText ? `<p>${escapeHtml(bodyText).replace(/\n/g, '<br/>')}</p>` : '');
  if (!inner) return '';

  const sender = escapeHtml(
    message?.sender_display || message?.sender_email || message?.sender || '-',
  );
  const subject = escapeHtml(String(message?.subject || '').trim() || '(без темы)');
  const received = escapeHtml(formatQuoteTimestamp(message?.received_at));
  return (
    `<div class="quoted-mail"><br><br>`
    + `<p><strong>От:</strong> ${sender}</p>`
    + `<p><strong>Дата:</strong> ${received}</p>`
    + `<p><strong>Тема:</strong> ${subject}</p>`
    + `<blockquote>${inner}</blockquote></div>`
  );
};

export const buildQuickReplyOutgoingHtml = (body = '', quoteHtml = '') => (
  mergeQuotedHistoryHtml(buildQuickReplyHtml(body), quoteHtml)
);
