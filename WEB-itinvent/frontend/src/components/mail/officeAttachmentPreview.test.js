import { describe, expect, it, vi } from 'vitest';
import { buildOfficeAttachmentPreviewState } from './officeAttachmentPreview';

describe('buildOfficeAttachmentPreviewState', () => {
  it('waits for preview generation before downloading its PDF artifact', async () => {
    let resolveMetadata;
    const metadataPromise = new Promise((resolve) => {
      resolveMetadata = resolve;
    });
    const mailAPI = {
      getAttachmentPreview: vi.fn(() => metadataPromise),
      downloadAttachmentPreviewPdf: vi.fn().mockResolvedValue({
        data: new Blob(['%PDF'], { type: 'application/pdf' }),
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="memo.pdf"',
        },
      }),
    };

    const resultPromise = buildOfficeAttachmentPreviewState({
      mailAPI,
      messageId: 'message-1',
      attachmentRef: 'attachment-1',
      mailboxId: 'mailbox-1',
      attachment: { name: 'memo.docx', content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      filename: 'memo.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      createObjectUrl: () => 'blob:preview',
    });

    await Promise.resolve();
    expect(mailAPI.getAttachmentPreview).toHaveBeenCalledTimes(1);
    expect(mailAPI.downloadAttachmentPreviewPdf).not.toHaveBeenCalled();

    resolveMetadata({
      preview_kind: 'office_pdf',
      source_kind: 'word',
      source_filename: 'memo.docx',
      pdf_filename: 'memo.pdf',
      page_count: 1,
      sheets: [],
    });

    const result = await resultPromise;
    expect(mailAPI.downloadAttachmentPreviewPdf).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      kind: 'office_pdf',
      objectUrl: 'blob:preview',
      pdfFilename: 'memo.pdf',
    });
  });
});
