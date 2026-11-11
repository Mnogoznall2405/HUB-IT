import {
  MAIL_UPLOAD_MAX_FILE_BYTES,
  buildMailCacheKey,
  canPreviewMailAttachment,
  stableMailCacheHash,
  validateDownloadedMailAttachment,
  validateMailUploadFiles,
} from './nativeMailFiles';

const longMessageId = (suffix: string) => `AAMkAGQzZDJlMTBmLWQxYzYtNDU5NS1hZjdkLWRhNzFmNGVjMTY2Zg${suffix}`;
const longReference = (suffix: string) => `att2_AAMkAD${'X'.repeat(180)}${suffix}`;

it('keeps same-named attachments in different cache entries', () => {
  const first = buildMailCacheKey({
    messageId: longMessageId('AAAAA'),
    reference: longReference('one'),
  });
  const second = buildMailCacheKey({
    messageId: longMessageId('AAAAA'),
    reference: longReference('two'),
  });

  expect(first).not.toBe(second);
});

it('keeps same-named attachments from different messages in different cache entries', () => {
  const first = buildMailCacheKey({
    messageId: longMessageId('AAAAA'),
    reference: longReference('same'),
  });
  const second = buildMailCacheKey({
    messageId: longMessageId('BBBBB'),
    reference: longReference('same'),
  });

  expect(first).not.toBe(second);
});

it('reuses the same cache key for the same message and attachment', () => {
  const args = { messageId: longMessageId('AAAAA'), reference: longReference('same') };

  expect(buildMailCacheKey(args)).toBe(buildMailCacheKey({ ...args }));
});

it('produces a bounded file-system-safe cache key', () => {
  const key = buildMailCacheKey({
    messageId: `${longMessageId('A')}/${'B'.repeat(400)}`,
    reference: `${longReference('C')}==`,
  });

  expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(key.length).toBeLessThanOrEqual(80);
  expect(stableMailCacheHash('same')).toBe(stableMailCacheHash('same'));
  expect(stableMailCacheHash('same')).not.toBe(stableMailCacheHash('other'));
});

it('accepts a mail batch inside the backend 10 files / 15 MB / 25 MB contract', () => {
  expect(validateMailUploadFiles([
    { uri: 'file:///one.pdf', name: 'one.pdf', mimeType: 'application/pdf', size: 1024 },
    { uri: 'file:///two.jpg', name: 'two.jpg', mimeType: 'image/jpeg', size: 2048 },
  ])).toHaveLength(2);
});

it('accepts a non-empty downloaded attachment when Exchange metadata has a different size', () => {
  expect(() => validateDownloadedMailAttachment({ exists: true, size: 4097 }, 4096)).not.toThrow();
  expect(() => validateDownloadedMailAttachment({ exists: true, size: 0 }, 4096)).toThrow();
});

it('offers server PDF preview only for the Office formats supported by the backend', () => {
  expect(canPreviewMailAttachment({ name: 'report.docx' })).toBe(true);
  expect(canPreviewMailAttachment({ name: 'budget.bin', content_type: 'application/vnd.ms-excel' })).toBe(true);
  expect(canPreviewMailAttachment({ name: 'archive.zip', content_type: 'application/zip' })).toBe(false);
});

it('rejects an individual oversized or executable mail attachment', () => {
  expect(() => validateMailUploadFiles([
    { uri: 'file:///large.pdf', name: 'large.pdf', mimeType: 'application/pdf', size: MAIL_UPLOAD_MAX_FILE_BYTES + 1 },
  ])).toThrow('15 МБ');
  expect(() => validateMailUploadFiles([
    { uri: 'file:///run.exe', name: 'run.exe', mimeType: 'application/x-msdownload', size: 128 },
  ])).toThrow('нельзя отправить');
});
