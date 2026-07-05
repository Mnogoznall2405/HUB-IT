import { describe, expect, it } from 'vitest';

import {
  isChatDocumentPreviewableAttachment,
  mapChatAttachmentForPreview,
} from './chatAttachmentPreview';

describe('chatAttachmentPreview', () => {
  it('maps chat attachment fields for preview helpers', () => {
    expect(mapChatAttachmentForPreview({
      file_name: 'report.docx',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      file_size: 1024,
      id: 'att-1',
    })).toEqual({
      name: 'report.docx',
      content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 1024,
      id: 'att-1',
    });
  });

  it('detects previewable office, pdf and text attachments', () => {
    expect(isChatDocumentPreviewableAttachment({
      file_name: 'report.docx',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })).toBe(true);
    expect(isChatDocumentPreviewableAttachment({
      file_name: 'manual.pdf',
      mime_type: 'application/pdf',
    })).toBe(true);
    expect(isChatDocumentPreviewableAttachment({
      file_name: 'notes.txt',
      mime_type: 'text/plain',
    })).toBe(true);
    expect(isChatDocumentPreviewableAttachment({
      file_name: 'archive.zip',
      mime_type: 'application/zip',
    })).toBe(false);
  });
});
