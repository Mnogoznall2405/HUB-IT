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
  resolveNativeMailSwipeAction,
  splitMailRecipients,
} from './nativeMailModel';

it('formats sender, timestamps and attachment sizes for compact native rows', () => {
  expect(mailPreviewSender({ id: 'm1', sender_person: { name: 'Иван', email: 'i@example.com' } })).toBe('Иван');
  expect(mailDateLabel('2026-08-24T11:15:00+05:00', new Date('2026-08-24T12:00:00+05:00'))).toMatch(/11:15/);
  expect(mailByteLabel(1_572_864)).toBe('1.5 МБ');
});

it('uses deliberate horizontal swipe thresholds and never swipes permanent delete in Trash', () => {
  expect(resolveNativeMailSwipeAction(71, { isRead: false, canDelete: true })).toBeNull();
  expect(resolveNativeMailSwipeAction(80, { isRead: false, canDelete: true })).toBe('toggle-read');
  expect(resolveNativeMailSwipeAction(-80, { isRead: true, canDelete: true })).toBe('delete');
  expect(resolveNativeMailSwipeAction(-80, { isRead: true, canDelete: false })).toBeNull();
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
