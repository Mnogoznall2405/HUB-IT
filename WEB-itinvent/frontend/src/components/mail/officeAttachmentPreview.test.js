import { describe, expect, it, vi } from 'vitest';
import { buildOfficeAttachmentPreviewState } from './officeAttachmentPreview';

describe('buildOfficeAttachmentPreviewState', () => {
  it('downloads a Word PDF preview without a separate metadata request', async () => {
    const mailAPI = {
      getAttachmentPreview: vi.fn(),
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

    const result = await resultPromise;
    expect(mailAPI.getAttachmentPreview).not.toHaveBeenCalled();
    expect(mailAPI.downloadAttachmentPreviewPdf).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      kind: 'office_pdf',
      objectUrl: 'blob:preview',
      pdfFilename: 'memo.pdf',
      sourceKind: 'word',
    });
  });
});
