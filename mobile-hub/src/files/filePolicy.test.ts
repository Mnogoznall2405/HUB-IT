import {
  resolveTrustedAttachmentUrl,
  resolveTrustedChatMediaUrl,
  resolveTrustedStickerUrl,
  sanitizeNativeFileName,
  selectCacheEvictions,
  validateUploadBatch,
  validateUploadFile,
} from './filePolicy';

describe('native file policy', () => {
  it('sanitizes path characters and bounded names', () => {
    expect(sanitizeNativeFileName('../report:Q1?.pdf')).toBe('_report_Q1_.pdf');
    expect(sanitizeNativeFileName('   ')).toBe('hubit-file');
    expect(sanitizeNativeFileName(`${'x'.repeat(220)}.pdf`)).toHaveLength(180);
  });

  it('accepts ordinary files and blocks executable payloads', () => {
    expect(validateUploadFile({ name: 'отчёт.pdf', mimeType: 'application/pdf', size: 1024 }))
      .toEqual({ name: 'отчёт.pdf', mimeType: 'application/pdf', size: 1024 });
    expect(() => validateUploadFile({ name: 'update.apk', mimeType: 'application/octet-stream', size: 1024 }))
      .toThrow('нельзя отправить');
    expect(() => validateUploadFile({ name: 'photo.jpg', mimeType: 'image/jpeg', size: 0 }))
      .toThrow('пустой');
  });

  it('matches the backend limits for a multi-file chat message', () => {
    const file = (index: number, size = 10) => ({ name: `${index}.txt`, mimeType: 'text/plain', size });
    expect(validateUploadBatch(Array.from({ length: 5 }, (_, index) => file(index)))).toHaveLength(5);
    expect(() => validateUploadBatch(Array.from({ length: 6 }, (_, index) => file(index))))
      .toThrow('не больше 5 файлов');
    expect(() => validateUploadBatch([file(1, 600 * 1024 * 1024), file(2, 600 * 1024 * 1024)]))
      .toThrow('превышает 1 ГБ');
  });

  it('allows only the authenticated HUB-IT attachment endpoint', () => {
    expect(resolveTrustedAttachmentUrl('/api/v1/chat/messages/m1/attachments/a1/file'))
      .toBe('https://hubit.zsgp.ru/api/v1/chat/messages/m1/attachments/a1/file');
    expect(resolveTrustedAttachmentUrl('https://hubit.zsgp.ru/api/v1/chat/messages/m1/attachments/a1/file?inline=1'))
      .toContain('?inline=1');
    expect(() => resolveTrustedAttachmentUrl('https://hubit.zsgp.ru.evil.example/api/v1/chat/messages/m1/attachments/a1/file'))
      .toThrow('вне защищённого');
    expect(() => resolveTrustedAttachmentUrl('https://hubit.zsgp.ru/api/v1/mail/attachments/a1'))
      .toThrow('Недопустимый');
  });

  it('allows authenticated sticker preview and file endpoints', () => {
    expect(resolveTrustedStickerUrl('/api/v1/chat/stickers/s1/preview'))
      .toBe('https://hubit.zsgp.ru/api/v1/chat/stickers/s1/preview');
    expect(resolveTrustedStickerUrl('/api/v1/chat/sticker-packs/preview/office/stickers/s1/file'))
      .toContain('/sticker-packs/preview/office/stickers/s1/file');
    expect(() => resolveTrustedStickerUrl('/api/v1/chat/messages/m1/attachments/a1/file'))
      .toThrow('Недопустимый');
  });

  it('allows user and group avatars rendered in native Chat', () => {
    expect(resolveTrustedChatMediaUrl('/api/v1/auth/avatars/42.jpg?v=7'))
      .toBe('https://hubit.zsgp.ru/api/v1/auth/avatars/42.jpg?v=7');
    expect(resolveTrustedChatMediaUrl('/api/v1/chat/group-avatars/platform-team.jpg?v=9'))
      .toBe('https://hubit.zsgp.ru/api/v1/chat/group-avatars/platform-team.jpg?v=9');
  });

  it('evicts expired files first, then least recently used files', () => {
    const entries = [
      { uri: 'old', size: 20, modifiedAt: 100 },
      { uri: 'newer', size: 40, modifiedAt: 900 },
      { uri: 'keep', size: 50, modifiedAt: 950 },
    ];
    expect(selectCacheEvictions(entries, {
      now: 1000,
      maxAgeMs: 500,
      maxBytes: 60,
      preserveUri: 'keep',
    })).toEqual(['old', 'newer']);
  });

  it('never evicts the file currently being opened', () => {
    expect(selectCacheEvictions([
      { uri: 'huge', size: 100, modifiedAt: 1 },
      { uri: 'small', size: 5, modifiedAt: 2 },
    ], { now: 10, maxAgeMs: 100, maxBytes: 20, preserveUri: 'huge' }))
      .toEqual(['small']);
  });
});
