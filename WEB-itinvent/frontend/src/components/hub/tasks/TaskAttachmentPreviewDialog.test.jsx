import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hubTaskFilesAPI } from '../../../api/hubTaskFiles';
import {
  buildTaskAttachmentPreviewState,
  mapTaskAttachmentForPreview,
} from './TaskAttachmentPreviewDialog';

vi.mock('../../../api/hubTaskFiles', () => ({
  hubTaskFilesAPI: {
    getTaskAttachmentPreview: vi.fn(),
    downloadTaskAttachment: vi.fn(),
    downloadTaskAttachmentPreviewPdf: vi.fn(),
  },
}));

describe('TaskAttachmentPreviewDialog helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps Hub attachment fields to the shared preview contract', () => {
    expect(mapTaskAttachmentForPreview({
      id: 'attachment-1',
      file_name: 'report.docx',
      file_mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      file_size: 2048,
    })).toEqual({
      id: 'attachment-1',
      name: 'report.docx',
      content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 2048,
    });
  });

  it('waits for the worker and opens the generated Office PDF', async () => {
    hubTaskFilesAPI.getTaskAttachmentPreview.mockResolvedValue({
      status: 'ready',
      preview_kind: 'office_pdf',
      source_kind: 'word',
      pdf_filename: 'report.pdf',
      page_count: 2,
      sheets: [],
    });
    const pdfBlob = new Blob(['%PDF'], { type: 'application/pdf' });
    hubTaskFilesAPI.downloadTaskAttachmentPreviewPdf.mockResolvedValue({
      data: pdfBlob,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'inline; filename="report.pdf"',
      },
    });

    const result = await buildTaskAttachmentPreviewState({
      taskId: 'task-1',
      attachment: {
        id: 'attachment-1',
        file_name: 'report.docx',
        file_mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
      createObjectUrl: () => 'blob:task-preview',
    });

    expect(result).toMatchObject({
      open: true,
      loading: false,
      kind: 'office_pdf',
      sourceKind: 'word',
      objectUrl: 'blob:task-preview',
      previewBlob: pdfBlob,
      pageCount: 2,
      downloadContext: { taskId: 'task-1', attachmentId: 'attachment-1' },
    });
    expect(hubTaskFilesAPI.getTaskAttachmentPreview).toHaveBeenCalledWith({
      taskId: 'task-1',
      attachmentId: 'attachment-1',
      signal: expect.any(AbortSignal),
    });
    expect(hubTaskFilesAPI.downloadTaskAttachmentPreviewPdf).toHaveBeenCalledTimes(1);
    expect(hubTaskFilesAPI.downloadTaskAttachment).not.toHaveBeenCalled();
  });

  it('previews PDFs directly without sending them to the Office worker', async () => {
    const pdfBlob = new Blob(['%PDF'], { type: 'application/pdf' });
    hubTaskFilesAPI.downloadTaskAttachment.mockResolvedValue({
      data: pdfBlob,
      headers: { 'content-type': 'application/pdf' },
    });

    const result = await buildTaskAttachmentPreviewState({
      taskId: 'task-1',
      attachment: { id: 'attachment-2', file_name: 'manual.pdf', file_mime: 'application/pdf' },
      createObjectUrl: () => 'blob:direct-pdf',
    });

    expect(result).toMatchObject({ kind: 'pdf', objectUrl: 'blob:direct-pdf', blob: pdfBlob });
    expect(hubTaskFilesAPI.downloadTaskAttachment).toHaveBeenCalledTimes(1);
    expect(hubTaskFilesAPI.getTaskAttachmentPreview).not.toHaveBeenCalled();
  });
});
