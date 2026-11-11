import { describe, expect, it, vi } from 'vitest';
import { buildOfficeAttachmentPreviewState } from './officeAttachmentPreview';

describe('buildOfficeAttachmentPreviewState', () => {
  it('builds a Word PDF preview from ready metadata', async () => {
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
      previewMetadata: {
        preview_kind: 'office_pdf',
        source_kind: 'word',
        pdf_filename: 'memo.pdf',
        page_count: 3,
      },
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
      pageCount: 3,
      blob: null,
      filename: 'memo.docx',
    });
    expect(result.previewBlob).toBeTruthy();
  });

  it('waits for the shared preview worker before downloading the PDF', async () => {
    const mailAPI = {
      getAttachmentPreview: vi.fn()
        .mockResolvedValueOnce({ status: 'queued', retry_after_ms: 1 })
        .mockResolvedValueOnce({
          status: 'ready',
          preview_kind: 'office_pdf',
          source_kind: 'word',
          pdf_filename: 'memo.pdf',
          page_count: 2,
        }),
      downloadAttachmentPreviewPdf: vi.fn().mockResolvedValue({
        data: new Blob(['%PDF'], { type: 'application/pdf' }),
        headers: { 'content-type': 'application/pdf' },
      }),
    };

    const result = await buildOfficeAttachmentPreviewState({
      mailAPI,
      messageId: 'message-1',
      attachmentRef: 'attachment-1',
      mailboxId: 'mailbox-1',
      attachment: { name: 'memo.docx', content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      filename: 'memo.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      createObjectUrl: () => 'blob:preview',
    });

    expect(mailAPI.getAttachmentPreview).toHaveBeenCalledTimes(2);
    expect(mailAPI.downloadAttachmentPreviewPdf).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ sourceKind: 'word', pageCount: 2 });
  });
});
