import type {
  MailActionResult,
  MailContact,
  MailComposeVariant,
  MailMessageDetail,
  MailMessagePreview,
  MailPerson,
} from '../api/mailApi';

export type NativeMailSwipeAction = 'toggle-read' | 'archive' | 'delete' | 'delete-forever' | null;

/** User-configurable swipe target stored locally; 'delete-forever' stays Trash-only. */
export type NativeMailSwipeSetting = 'toggle-read' | 'archive' | 'delete' | 'none';

export const DEFAULT_NATIVE_MAIL_SWIPE_SETTINGS: { right: NativeMailSwipeSetting; left: NativeMailSwipeSetting } = {
  right: 'toggle-read',
  left: 'archive',
};

export function resolveNativeMailSwipeAction(
  distanceX: number,
  options: {
    isRead: boolean;
    canArchive?: boolean;
    canDelete?: boolean;
    canDeleteForever?: boolean;
    swipeRight?: NativeMailSwipeSetting;
    swipeLeft?: NativeMailSwipeSetting;
  },
): NativeMailSwipeAction {
  if (!Number.isFinite(distanceX) || Math.abs(distanceX) < 72) return null;
  if (distanceX < 0 && options.canDeleteForever) return 'delete-forever';
  const configured = distanceX > 0
    ? (options.swipeRight ?? DEFAULT_NATIVE_MAIL_SWIPE_SETTINGS.right)
    : (options.swipeLeft ?? DEFAULT_NATIVE_MAIL_SWIPE_SETTINGS.left);
  if (configured === 'toggle-read') return 'toggle-read';
  if (configured === 'archive') return options.canArchive ? 'archive' : null;
  if (configured === 'delete') return options.canDeleteForever ? 'delete-forever' : options.canDelete ? 'delete' : null;
  return null;
}

/** Swipe target usable for a row, or null when the gesture must stay disabled. */
export function resolveNativeMailSwipeAvailability(
  setting: NativeMailSwipeSetting,
  options: { canArchive?: boolean; canDelete?: boolean; canDeleteForever?: boolean },
): boolean {
  if (setting === 'toggle-read') return true;
  if (setting === 'archive') return Boolean(options.canArchive);
  if (setting === 'delete') return Boolean(options.canDeleteForever || options.canDelete);
  return false;
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

export function mailPersonEmail(person?: MailPerson | string | null): string {
  if (!person) return '';
  const raw = typeof person === 'string' ? person : person.email;
  const text = String(raw || '').trim();
  const angleMatch = text.match(/<([^>]+)>/);
  return String(angleMatch?.[1] || text).trim().toLowerCase();
}

export function mailPersonDisplay(person?: MailPerson | string | null): string {
  if (!person) return '';
  if (typeof person === 'string') {
    const text = person.trim();
    const angleStart = text.indexOf('<');
    return (angleStart > 0 ? text.slice(0, angleStart).trim() : '') || text;
  }
  return String(person.display || person.name || person.email || '').trim();
}

function mailRecipientPeople(item?: MailMessagePreview | MailMessageDetail | null): Array<MailPerson | string> {
  if (!item) return [];
  const detail = item as MailMessageDetail;
  if (Array.isArray(detail.to_people) && detail.to_people.length) return detail.to_people;
  if (Array.isArray(item.recipient_people) && item.recipient_people.length) return item.recipient_people;
  if (Array.isArray(detail.to) && detail.to.length) return detail.to;
  if (Array.isArray(item.recipients) && item.recipients.length) return item.recipients;
  return [];
}

/**
 * Web parity: getPrimaryCorrespondent — a message counts as outgoing when the
 * current folder is sent/drafts or the sender is one of the user's mailboxes.
 */
export function isMailOutgoingMessage(
  item?: MailMessagePreview | MailMessageDetail | null,
  { folder, mailboxEmails }: { folder?: string | null; mailboxEmails?: string[] } = {},
): boolean {
  const contextFolder = String(folder || item?.folder || '').trim().toLowerCase();
  if (contextFolder === 'sent' || contextFolder === 'drafts') return true;
  const senderEmail = mailPersonEmail(item?.sender_person || item?.sender_email || item?.sender);
  const emails = new Set((mailboxEmails || []).map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
  return Boolean(senderEmail && emails.has(senderEmail));
}

export type MailCorrespondent = {
  direction: 'incoming' | 'outgoing';
  label: string;
  person: MailPerson | string | null;
};

export function mailCorrespondent(
  item: MailMessagePreview | MailMessageDetail,
  { folder, isSearch = false, mailboxEmails }: { folder?: string | null; isSearch?: boolean; mailboxEmails?: string[] } = {},
): MailCorrespondent {
  const contextFolder = String(folder || item?.folder || '').trim().toLowerCase();
  const outgoing = isMailOutgoingMessage(item, { folder: contextFolder, mailboxEmails });
  const showRecipients = isSearch
    ? outgoing
    : contextFolder === 'sent' || contextFolder === 'drafts' || (contextFolder === 'trash' && outgoing);
  if (!showRecipients) {
    return {
      direction: 'incoming',
      label: mailPreviewSender(item),
      person: item.sender_person || null,
    };
  }
  const people = mailRecipientPeople(item);
  const first = people[0] ?? null;
  const name = mailPersonDisplay(first);
  return {
    direction: 'outgoing',
    label: `${isSearch ? 'Кому: ' : ''}${name || 'Нет получателя'}${people.length > 1 ? ` +${people.length - 1}` : ''}`,
    person: first,
  };
}

/**
 * Шапка читателя по finding 16: «Кому: мне» когда единственный получатель — свой ящик,
 * иначе «Кому: имя +N». Принимает уже дедуплицированные метки группы «Кому»
 * (см. mergeRecipientLabels в карточке) и адреса ящиков пользователя.
 */
export function nativeMailRecipientSummary(
  values: Array<MailPerson | string>,
  ownEmails: string[] = [],
): { text: string; count: number } {
  if (!values.length) return { text: '', count: 0 };
  const first = values[0];
  const own = new Set(ownEmails.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
  const firstIsSelf = Boolean(own.size && own.has(mailPersonEmail(first)));
  const name = firstIsSelf ? 'мне' : (mailPersonDisplay(first) || 'Нет получателя');
  return { text: `${name}${values.length > 1 ? ` +${values.length - 1}` : ''}`, count: values.length };
}

export function mailSubject(item?: Pick<MailMessagePreview, 'subject'> | null): string {
  return String(item?.subject || '').trim() || '(без темы)';
}

export type ParsedNativeMailSearch = {
  q: string;
  from: string;
  to: string;
  subject: string;
  hasAttachments: boolean;
};

/** Поисковые операторы в строке запроса: `от:`, `кому:`, `тема:` и фраза `с файлами` / `с вложениями`. */
export function parseNativeMailSearchQuery(raw: unknown): ParsedNativeMailSearch {
  const parsed: ParsedNativeMailSearch = { q: '', from: '', to: '', subject: '', hasAttachments: false };
  const operatorField = (key: string): 'from' | 'to' | 'subject' | '' => {
    if (key === 'от' || key === 'from') return 'from';
    if (key === 'кому' || key === 'to') return 'to';
    if (key === 'тема' || key === 'subject') return 'subject';
    return '';
  };
  const rest = String(raw || '').replace(
    /(от|кому|тема|from|to|subject)\s*:\s*"([^"]*)"|(от|кому|тема|from|to|subject)\s*:\s*'([^']*)'|(от|кому|тема|from|to|subject)\s*:\s*(\S+)/gi,
    (_match, quotedKey, quotedValue, singleKey, singleValue, bareKey, bareValue) => {
      const field = operatorField(String(quotedKey || singleKey || bareKey || '').toLowerCase());
      const value = String(quotedValue ?? singleValue ?? bareValue ?? '').trim();
      if (field && value) parsed[field] = [parsed[field], value].filter(Boolean).join(' ');
      return ' ';
    },
  );
  let query = rest.replace(/\s+/g, ' ');
  if (/с\s+файлами|с\s+вложениями|has\s*:\s*attachments?/i.test(query)) {
    parsed.hasAttachments = true;
    query = query.replace(/с\s+файлами|с\s+вложениями|has\s*:\s*attachments?/gi, ' ');
  }
  parsed.q = query.replace(/\s+/g, ' ').trim();
  return parsed;
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
