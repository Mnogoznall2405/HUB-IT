import { resolveAttachmentUrl } from './attachmentUrl';

describe('attachment preview URL', () => {
  it('resolves only same-origin attachment URLs', () => {
    expect(resolveAttachmentUrl('/api/v1/chat/messages/m1/attachments/a1/file?inline=1'))
      .toBe('https://hubit.zsgp.ru/api/v1/chat/messages/m1/attachments/a1/file?inline=1');
    expect(resolveAttachmentUrl('https://hubit.zsgp.ru/api/v1/chat/file')).toBe(
      'https://hubit.zsgp.ru/api/v1/chat/file',
    );
    expect(resolveAttachmentUrl('https://example.com/private.jpg')).toBeNull();
    expect(resolveAttachmentUrl('javascript:alert(1)')).toBeNull();
  });
});
