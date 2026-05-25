import { describe, expect, it } from 'vitest';

import {
  MAIL_ATTACHMENT_CONTEXT_MISSING_CODE,
  buildAttachmentBlobPayload,
  buildAttachmentContextError,
  buildAttachmentDownloadKey,
  buildAttachmentPreviewState,
  buildAttachmentRequestContext,
  buildMessageSourceDownloadPayload,
  buildPrintMailDocumentHtml,
  createEmptyAttachmentPreview,
  parseDownloadFilename,
} from './mailMessageFileActions';

describe('mailMessageFileActions', () => {
  it('parses download filenames from RFC 6266 headers with safe fallbacks', () => {
    expect(parseDownloadFilename("attachment; filename*=UTF-8''report%20final.eml", 'fallback.eml'))
      .toBe('report final.eml');
    expect(parseDownloadFilename('attachment; filename="plain.txt"', 'fallback.txt'))
      .toBe('plain.txt');
    expect(parseDownloadFilename('', 'fallback.bin')).toBe('fallback.bin');
  });

  it('builds attachment request context without owning mailbox state', () => {
    const context = buildAttachmentRequestContext({
      messageOrId: 'msg-42',
      fallbackMessage: { id: 'msg-fallback', mailbox_id: 'mailbox-1' },
      attachment: { download_token: 'att-token', id: 'att-id' },
      resolveMailboxId: (message) => message?.mailbox_id || '',
    });

    expect(context).toEqual({
      messageId: 'msg-42',
      attachmentRef: 'att-token',
      mailboxId: 'mailbox-1',
    });
  });

  it('builds structured attachment context errors and stable download keys', () => {
    const error = buildAttachmentContextError({
      attachment: { name: 'broken.txt', size: 64 },
      messageId: 'msg-42',
      mailboxId: 'mailbox-1',
    });

    expect(error.code).toBe(MAIL_ATTACHMENT_CONTEXT_MISSING_CODE);
    expect(error.message).toContain('broken.txt');
    expect(error.attachment).toMatchObject({
      name: 'broken.txt',
      size: 64,
      mailbox_id: 'mailbox-1',
      message_id: 'msg-42',
    });
    expect(buildAttachmentDownloadKey({ messageId: 'msg-42', attachmentRef: 'att-token', mailboxId: 'mailbox-1' }))
      .toBe('msg-42::att-token::mailbox-1');
  });

  it('builds source and attachment blob payloads from response headers', () => {
    const sourcePayload = buildMessageSourceDownloadPayload({
      message: { subject: 'Fallback subject' },
      response: {
        data: 'raw message',
        headers: {
          'content-type': 'message/rfc822',
          'content-disposition': 'attachment; filename="source.eml"',
        },
      },
    });
    const attachmentPayload = buildAttachmentBlobPayload({
      attachment: { name: 'fallback.txt', content_type: 'text/plain' },
      response: {
        data: 'attachment body',
        headers: {},
      },
    });

    expect(sourcePayload.filename).toBe('source.eml');
    expect(sourcePayload.blob.type).toBe('message/rfc822');
    expect(attachmentPayload.filename).toBe('fallback.txt');
    expect(attachmentPayload.contentType).toBe('text/plain');
    expect(attachmentPayload.blob.type).toBe('text/plain');
  });

  it('builds attachment preview state for text and object-url previews', async () => {
    const textPreview = await buildAttachmentPreviewState({
      attachment: { name: 'notes.txt', content_type: 'text/plain' },
      response: {
        data: 'abcdef',
        headers: { 'content-type': 'text/plain' },
      },
      maxTextPreviewBytes: 3,
      maxPreviewFileBytes: 4,
    });
    const imagePreview = await buildAttachmentPreviewState({
      attachment: { name: 'photo.png', content_type: 'image/png' },
      response: {
        data: 'png',
        headers: { 'content-type': 'image/png' },
      },
      createObjectUrl: () => 'blob:photo',
    });

    expect(textPreview).toMatchObject({
      open: true,
      kind: 'text',
      filename: 'notes.txt',
      textContent: 'abc',
      textTruncated: true,
      tooLargeForPreview: true,
    });
    expect(textPreview.blob).toBeInstanceOf(Blob);
    expect(imagePreview).toMatchObject({
      kind: 'image',
      objectUrl: 'blob:photo',
    });
  });

  it('marks office documents (Word, Excel) as unsupported for preview', async () => {
    const wordPreview = await buildAttachmentPreviewState({
      attachment: { name: 'report.docx', content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      response: {
        data: 'word-binary',
        headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      },
    });
    const excelPreview = await buildAttachmentPreviewState({
      attachment: { name: 'table.xlsx', content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      response: {
        data: 'excel-binary',
        headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      },
    });

    expect(wordPreview).toMatchObject({
      open: true,
      kind: 'unsupported',
      filename: 'report.docx',
      objectUrl: '',
      textContent: '',
    });
    expect(excelPreview).toMatchObject({
      open: true,
      kind: 'unsupported',
      filename: 'table.xlsx',
      objectUrl: '',
      textContent: '',
    });
  });

  it('provides empty preview state and print document shell', () => {
    expect(createEmptyAttachmentPreview()).toMatchObject({
      open: false,
      loading: false,
      kind: 'unsupported',
      blob: null,
    });

    const printHtml = buildPrintMailDocumentHtml({
      subject: 'Quarterly report',
      senderLine: 'Ops <ops@example.com>',
      dateLine: '2026-05-03 10:00',
      html: '<p>Hello</p>',
    });

    expect(printHtml).toContain('<title>Quarterly report</title>');
    expect(printHtml).toContain('Ops <ops@example.com>');
    expect(printHtml).toContain('<p>Hello</p>');
  });
});
