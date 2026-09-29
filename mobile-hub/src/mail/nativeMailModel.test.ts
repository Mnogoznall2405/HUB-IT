import {
  buildNativeMailContactSuggestions,
  buildNativeMailOutgoingHtml,
  composeVariantForMode,
  extractNativeMailTrashRestoreId,
  hasExternalMailRecipients,
  invalidMailRecipients,
  mailBodyMentionsAttachment,
  mailByteLabel,
  mailDateLabel,
  mailDraftNeedsRichEditor,
  mailPreviewSender,
  nativeMailRecipientSummary,
  parseNativeMailSearchQuery,
  resolveNativeMailSwipeAction,
  resolveNativeMailSwipeAvailability,
  splitMailRecipients,
} from './nativeMailModel';

it('formats sender, timestamps and attachment sizes for compact native rows', () => {
  expect(mailPreviewSender({ id: 'm1', sender_person: { name: 'Иван', email: 'i@example.com' } })).toBe('Иван');
  expect(mailDateLabel('2026-08-24T11:15:00+05:00', new Date('2026-08-24T12:00:00+05:00'))).toMatch(/11:15/);
  expect(mailByteLabel(1_572_864)).toBe('1.5 МБ');
});

it('uses deliberate horizontal swipe thresholds, archives on the left swipe and never deletes by swipe', () => {
  expect(resolveNativeMailSwipeAction(71, { isRead: false, canArchive: true })).toBeNull();
  expect(resolveNativeMailSwipeAction(80, { isRead: false, canArchive: true })).toBe('toggle-read');
  expect(resolveNativeMailSwipeAction(-80, { isRead: true, canArchive: true })).toBe('archive');
  expect(resolveNativeMailSwipeAction(-80, { isRead: true, canArchive: false })).toBeNull();
});

it('offers delete undo only when the backend returns a new Trash message id', () => {
  expect(extractNativeMailTrashRestoreId({ message_id: 'trash/message-1', folder: 'trash' })).toBe('trash/message-1');
  expect(extractNativeMailTrashRestoreId({ message_id: 'message-1', folder: 'archive' })).toBe('');
  expect(extractNativeMailTrashRestoreId({ permanent: true, message_id: 'message-1' })).toBe('');
});

it('detects attachment reminders and rich drafts without treating plain text as HTML', () => {
  expect(mailBodyMentionsAttachment('Прикрепляю файл с отчётом')).toBe(true);
  expect(mailBodyMentionsAttachment('Просто текст письма')).toBe(false);
  expect(mailDraftNeedsRichEditor('<p><strong>Форматированный</strong> текст</p>')).toBe(true);
  expect(mailDraftNeedsRichEditor('Обычный текст с 2 < 3')).toBe(false);
  expect(hasExternalMailRecipients(['one@corp.local', 'two@example.com'], 'me@corp.local')).toBe(true);
  expect(hasExternalMailRecipients(['one@corp.local'], 'me@corp.local')).toBe(false);
});

it('splits, deduplicates and validates recipient lists', () => {
  const values = splitMailRecipients('one@example.com; TWO@example.com, two@example.com\nBoss <boss@intranet>\nbroken');
  expect(values).toEqual(['one@example.com', 'TWO@example.com', 'boss@intranet', 'broken']);
  expect(invalidMailRecipients(values)).toEqual(['broken']);
});

it('keeps the editable reply empty and preserves the backend HTML quote separately', () => {
  const result = composeVariantForMode({
    id: 'm1',
    subject: 'Смета',
    sender_display: 'Иван',
    body_text: 'Проверьте документ',
    compose_context: {
      reply_all: { subject: 'Re: Смета', to: ['one@example.com'], cc: ['two@example.com'], quote_html: '<b>unsafe</b>' },
    },
  }, 'reply_all');
  expect(result.variant.to).toEqual(['one@example.com']);
  expect(result.body).toBe('');
  expect(result.quoteHtml).toBe('<b>unsafe</b>');
  expect(result.quotePreview).toBe('Проверьте документ');
});

it('builds an HTML reply with the new text before a separately marked quote', () => {
  const result = buildNativeMailOutgoingHtml('Согласовано\nСпасибо', '<div class="quoted-mail">Исходное</div>');
  expect(result).toContain('<p>Согласовано<br>Спасибо</p>');
  expect(result).toContain('data-mail-native-body="true"');
  expect(result).toContain('data-mail-quoted-history="true"');
  expect(result.indexOf('Согласовано')).toBeLessThan(result.indexOf('Исходное'));
});

it('treats reply input as plain text instead of injecting typed HTML', () => {
  const result = buildNativeMailOutgoingHtml('<strong>Обычный текст</strong>', '<blockquote>Исходное письмо</blockquote>');
  expect(result).toContain('&lt;strong&gt;Обычный текст&lt;/strong&gt;');
  expect(result).not.toContain('<div data-mail-native-body="true"><p><strong>');
  expect(result).toContain('<div data-mail-native-quote="true" data-mail-quoted-history="true"><blockquote>Исходное письмо</blockquote></div>');
});

it('offers a valid external address when Exchange has no matching contact', () => {
  expect(buildNativeMailContactSuggestions('outside@example.net', [])).toEqual([
    expect.objectContaining({
      email: 'outside@example.net',
      display: 'Использовать outside@example.net',
    }),
  ]);
  expect(buildNativeMailContactSuggestions('broken@', [])).toEqual([]);
});
import { mailCorrespondent, isMailOutgoingMessage } from './nativeMailModel';
import type { MailMessagePreview } from '../api/mailApi';

const sentMessage: MailMessagePreview = {
  id: 'm1',
  sender_person: { name: 'Я', email: 'me@corp.local' },
  sender_email: 'me@corp.local',
  recipient_people: [{ name: 'Коллега', email: 'peer@corp.local' }],
  subject: 'Тест',
};

describe('mailCorrespondent', () => {
  it('shows the recipient in Sent and Drafts instead of the own mailbox', () => {
    expect(mailCorrespondent(sentMessage, { folder: 'sent' }).label).toBe('Коллега');
    expect(mailCorrespondent(sentMessage, { folder: 'drafts' }).label).toBe('Коллега');
  });

  it('keeps the sender in Inbox', () => {
    expect(mailCorrespondent(sentMessage, { folder: 'inbox' }).label).toBe('Я');
  });

  it('marks outgoing by own mailbox email when folder key is unknown', () => {
    expect(isMailOutgoingMessage(sentMessage, { folder: 'all', mailboxEmails: ['me@corp.local'] })).toBe(true);
    expect(mailCorrespondent(sentMessage, { folder: 'trash', mailboxEmails: ['me@corp.local'] }).label).toBe('Коллега');
  });

  it('falls back to recipients array and counts extras', () => {
    const multi = { ...sentMessage, recipient_people: undefined, recipients: ['a@x.ru', 'b@x.ru', 'c@x.ru'] };
    expect(mailCorrespondent(multi, { folder: 'sent' }).label).toBe('a@x.ru +2');
  });

  it('uses the search prefix for outgoing results', () => {
    expect(mailCorrespondent(sentMessage, { folder: 'inbox', isSearch: true, mailboxEmails: ['me@corp.local'] }).label).toBe('Кому: Коллега');
  });

  it('handles a missing recipient gracefully', () => {
    const empty = { ...sentMessage, recipient_people: [], recipients: [] };
    expect(mailCorrespondent(empty, { folder: 'sent' }).label).toBe('Нет получателя');
  });
});

describe('parseNativeMailSearchQuery', () => {
  it('maps Russian and English operators onto backend filters', () => {
    expect(parseNativeMailSearchQuery('от:ivan@example.com тема:"квартальный отчёт" с файлами встреча')).toEqual({
      q: 'встреча',
      from: 'ivan@example.com',
      to: '',
      subject: 'квартальный отчёт',
      hasAttachments: true,
    });
    expect(parseNativeMailSearchQuery("кому:'Иван Петров' subject:смета")).toEqual({
      q: '',
      from: '',
      to: 'Иван Петров',
      subject: 'смета',
      hasAttachments: false,
    });
  });

  it('keeps unknown operators and free text in the query', () => {
    expect(parseNativeMailSearchQuery('размер:10 план')).toEqual({
      q: 'размер:10 план',
      from: '',
      to: '',
      subject: '',
      hasAttachments: false,
    });
    expect(parseNativeMailSearchQuery('')).toEqual({ q: '', from: '', to: '', subject: '', hasAttachments: false });
  });
});

describe('nativeMailRecipientSummary', () => {
  it('marks the own mailbox as «мне» and counts extra recipients', () => {
    expect(nativeMailRecipientSummary(
      [{ display: 'Я', email: 'me@corp.local' }, 'peer@corp.local'],
      ['me@corp.local'],
    )).toEqual({ text: 'мне +1', count: 2 });
  });

  it('shows the first recipient name for foreign recipients', () => {
    expect(nativeMailRecipientSummary(['Получатель <peer@corp.local>'], ['me@corp.local'])).toEqual({ text: 'Получатель', count: 1 });
    expect(nativeMailRecipientSummary([], ['me@corp.local'])).toEqual({ text: '', count: 0 });
  });
});

describe('nativeMailSwipeSettings', () => {
  it('honours configured swipe targets and disables the unavailable ones', () => {
    expect(resolveNativeMailSwipeAction(-80, { isRead: true, canDelete: true, swipeLeft: 'delete' })).toBe('delete');
    expect(resolveNativeMailSwipeAction(80, { isRead: true, swipeRight: 'none' })).toBeNull();
    expect(resolveNativeMailSwipeAction(-80, { isRead: true, canDeleteForever: true, swipeLeft: 'toggle-read' })).toBe('delete-forever');
    expect(resolveNativeMailSwipeAction(80, { isRead: true, canArchive: false, swipeRight: 'archive' })).toBeNull();
  });

  it('reports direction availability for the row capabilities', () => {
    expect(resolveNativeMailSwipeAvailability('toggle-read', {})).toBe(true);
    expect(resolveNativeMailSwipeAvailability('archive', { canArchive: false })).toBe(false);
    expect(resolveNativeMailSwipeAvailability('delete', { canDeleteForever: true })).toBe(true);
    expect(resolveNativeMailSwipeAvailability('delete', { canDelete: false, canDeleteForever: false })).toBe(false);
    expect(resolveNativeMailSwipeAvailability('none', { canArchive: true })).toBe(false);
  });
});
