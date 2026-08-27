import type {
  MailActionResult,
  MailContact,
  MailComposeVariant,
  MailMessageDetail,
  MailMessagePreview,
  MailPerson,
} from '../api/mailApi';

export type NativeMailSwipeAction = 'toggle-read' | 'delete' | null;

export function resolveNativeMailSwipeAction(
  distanceX: number,
  options: { isRead: boolean; canDelete: boolean },
): NativeMailSwipeAction {
  if (!Number.isFinite(distanceX) || Math.abs(distanceX) < 72) return null;
  if (distanceX > 0) return 'toggle-read';
  return options.canDelete ? 'delete' : null;
}

export function extractNativeMailTrashRestoreId(result: MailActionResult): string {
  if (!result || result.permanent === true) return '';
  const id = String(result.message_id || '').trim();
  const resultFolder = String(result.folder || '').trim().toLowerCase();
  if (!id || (resultFolder && resultFolder !== 'trash')) return '';
  return id;
}

export const MAIL_STANDARD_FOLDERS = [
  { key: 'inbox', label: 'Входящие', icon: 'inbox-arrow-down-outline' as const },
  { key: 'sent', label: 'Отправленные', icon: 'send-check-outline' as const },
  { key: 'drafts', label: 'Черновики', icon: 'file-edit-outline' as const },
  { key: 'archive', label: 'Архив', icon: 'archive-outline' as const },
  { key: 'trash', label: 'Удалённые', icon: 'trash-can-outline' as const },
  { key: 'junk', label: 'Нежелательные', icon: 'alert-octagon-outline' as const },
] as const;

export function mailFolderLabel(folder: unknown): string {
  const key = String(folder || '').trim().toLowerCase();
  return MAIL_STANDARD_FOLDERS.find((item) => item.key === key)?.label
    || String(folder || '').trim()
    || 'Папка';
}

export function mailPersonLabel(person?: MailPerson | null, fallback?: unknown): string {
  return String(person?.display || person?.name || person?.email || fallback || '').trim() || 'Неизвестный отправитель';
}

export function mailPreviewSender(item: MailMessagePreview): string {
  return mailPersonLabel(item.sender_person, item.sender_display || item.sender_name || item.sender_email || item.sender);
}

export function mailSubject(item?: Pick<MailMessagePreview, 'subject'> | null): string {
  return String(item?.subject || '').trim() || '(без темы)';
}

export function mailDateLabel(value: unknown, now = new Date()): string {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '';
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  if (sameDay) return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(date);
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat('ru-RU', sameYear
    ? { day: '2-digit', month: 'short' }
    : { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

export function mailByteLabel(value: unknown): string {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 ** 2).toFixed(bytes >= 10 * 1024 ** 2 ? 0 : 1)} МБ`;
}

export function splitMailRecipients(value: unknown): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  String(value || '').split(/[;,\n]+/).forEach((part) => {
    const text = part.trim();
    const angleMatch = text.match(/<([^>]+)>/);
    const normalized = String(angleMatch?.[1] || text).trim();
    const key = normalized.toLowerCase();
    if (normalized && !seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  });
  return result;
}

export function isValidMailRecipient(value: unknown): boolean {
  const text = String(value || '').trim();
  const angleMatch = text.match(/<([^>]+)>/);
  const normalized = String(angleMatch?.[1] || text).trim();
  return /^[^\s@<>]+@[^\s@<>]+$/.test(normalized);
}

export function invalidMailRecipients(values: string[]): string[] {
  return values.filter((value) => !isValidMailRecipient(value));
}

export function mailBodyMentionsAttachment(value: unknown): boolean {
  const text = String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return /(влож|прикреп|attach|attachment|файл)/i.test(text);
}

export function mailDraftNeedsRichEditor(bodyHtml: unknown): boolean {
  return /<[a-z][^>]*>/i.test(String(bodyHtml || '').trim());
}

export function hasExternalMailRecipients(values: string[], mailboxEmail: unknown): boolean {
  const mailboxDomain = String(mailboxEmail || '').trim().toLowerCase().split('@')[1] || '';
  if (!mailboxDomain) return false;
  return values.some((value) => {
    const domain = String(value || '').trim().toLowerCase().split('@')[1] || '';
    return Boolean(domain && domain !== mailboxDomain);
  });
}

function escapeMailHtml(value: unknown): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function plainMailTextToHtml(value: unknown): string {
  const text = String(value || '').trim();
  return text ? `<p>${escapeMailHtml(text).replace(/\r?\n/g, '<br>')}</p>` : '';
}

function readableMailHtmlText(value: unknown): string {
  return String(value || '')
    .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/(?:p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function fallbackQuoteHtml(source: MailMessageDetail): string {
  const sender = mailPreviewSender(source);
  const date = mailDateLabel(source.received_at);
  const body = String(source.body_html || '').trim()
    || plainMailTextToHtml(source.body_text || source.body_preview);
  if (!body) return '';
  return [
    '<div class="quoted-mail">',
    '<br><br>',
    `<p><strong>От:</strong> ${escapeMailHtml(sender)}</p>`,
    date ? `<p><strong>Дата:</strong> ${escapeMailHtml(date)}</p>` : '',
    `<p><strong>Тема:</strong> ${escapeMailHtml(mailSubject(source))}</p>`,
    `<blockquote>${body}</blockquote>`,
    '</div>',
  ].join('');
}

export function buildNativeMailOutgoingHtml(body: unknown, quoteHtml: unknown = ''): string {
  const primary = plainMailTextToHtml(body);
  const quote = String(quoteHtml || '').trim();
  if (!quote) return primary;
  return `${primary ? `<div data-mail-native-body="true">${primary}</div>` : ''}<div data-mail-native-quote="true" data-mail-quoted-history="true">${quote}</div>`;
}

export function buildNativeMailContactSuggestions(
  term: unknown,
  contacts: MailContact[] = [],
  limit = 6,
): MailContact[] {
  const candidate = String(term || '').trim();
  const candidateKey = candidate.toLocaleLowerCase();
  const result = contacts.filter((contact) => String(contact.email || contact.value || '').trim());
  const hasExactMatch = result.some((contact) => (
    String(contact.email || contact.value || '').trim().toLocaleLowerCase() === candidateKey
  ));
  if (isValidMailRecipient(candidate) && !hasExactMatch) {
    result.unshift({
      id: `external:${candidateKey}`,
      email: candidate,
      value: candidate,
      display: `Использовать ${candidate}`,
    });
  }
  return result.slice(0, Math.max(1, limit));
}

export function composeVariantForMode(
  source: MailMessageDetail,
  mode: 'reply' | 'reply_all' | 'forward',
): { variant: MailComposeVariant; body: string; quoteHtml: string; quotePreview: string } {
  const context = source.compose_context || {};
  const variant = (mode === 'reply_all' ? context.reply_all : context[mode]) || {};
  const quoteHtml = String(variant.quote_html || '').trim() || fallbackQuoteHtml(source);
  const quotePreview = String(source.body_text || source.body_preview || '').trim()
    || readableMailHtmlText(source.body_html || quoteHtml);
  return { variant, body: '', quoteHtml, quotePreview };
}

export function draftRecipients(detail: MailMessageDetail, field: 'to' | 'cc' | 'bcc'): string[] {
  const values = detail[field];
  return Array.isArray(values) ? values.map(String).filter(Boolean) : [];
}
