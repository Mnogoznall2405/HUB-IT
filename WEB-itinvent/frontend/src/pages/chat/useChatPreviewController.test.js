import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatAttachmentsAPIMock = vi.hoisted(() => ({
  downloadAttachment: vi.fn(),
  getAttachmentPreview: vi.fn(),
  downloadAttachmentPreviewPdf: vi.fn(),
}));

vi.mock('../../api/chatAttachments', () => ({
  default: chatAttachmentsAPIMock,
}));

import useChatPreviewController, { revokeDocumentPreviewObjectUrl } from './useChatPreviewController';

const createControllerArgs = () => ({
  activeConversationIdRef: { current: 'conversation-1' },
  loadChatDialogsModule: vi.fn().mockResolvedValue({}),
  messagesRef: { current: [] },
  notifyApiError: vi.fn(),
});

describe('revokeDocumentPreviewObjectUrl', () => {
  it('revokes object URL when present', () => {
    const revokeObjectURL = vi.fn();
    const originalUrl = window.URL;
    window.URL = { ...originalUrl, revokeObjectURL };

    revokeDocumentPreviewObjectUrl({ objectUrl: 'blob:preview-1' });

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
    window.URL = originalUrl;
  });

  it('ignores missing objectUrl', () => {
    const revokeObjectURL = vi.fn();
    const originalUrl = window.URL;
    window.URL = { ...originalUrl, revokeObjectURL };

    revokeDocumentPreviewObjectUrl({ filename: 'doc.pdf' });

    expect(revokeObjectURL).not.toHaveBeenCalled();
    window.URL = originalUrl;
  });
});

describe('useChatPreviewController Office preview cancellation', () => {
  beforeEach(() => {
    Object.values(chatAttachmentsAPIMock).forEach((mockFn) => mockFn.mockReset());
  });

  it('aborts metadata polling when the preview is closed', async () => {
    chatAttachmentsAPIMock.getAttachmentPreview.mockImplementation((_messageId, _attachmentId, options) => (
      new Promise((_resolve, reject) => {
        const abort = () => {
          const error = new Error('cancelled');
          error.name = 'AbortError';
          reject(error);
        };
        options.signal.addEventListener('abort', abort, { once: true });
      })
    ));
    const { result } = renderHook(() => useChatPreviewController(createControllerArgs()));
    let openPromise;

    await act(async () => {
      openPromise = result.current.openDocumentPreview('message-1', {
        id: 'attachment-1',
        file_name: 'memo.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      await Promise.resolve();
    });
    const signal = chatAttachmentsAPIMock.getAttachmentPreview.mock.calls[0][2].signal;
    expect(signal.aborted).toBe(false);

    await act(async () => {
      result.current.closeDocumentPreview();
      await openPromise;
    });

    expect(signal.aborted).toBe(true);
    expect(result.current.documentPreview).toBeNull();
    expect(chatAttachmentsAPIMock.downloadAttachmentPreviewPdf).not.toHaveBeenCalled();
  });

  it('aborts the previous attachment before opening the next one', async () => {
    chatAttachmentsAPIMock.getAttachmentPreview
      .mockImplementationOnce((_messageId, _attachmentId, options) => (
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const error = new Error('cancelled');
            error.name = 'AbortError';
            reject(error);
          }, { once: true });
        })
      ))
      .mockResolvedValueOnce({
        status: 'ready',
        preview_kind: 'office_pdf',
        source_kind: 'word',
        pdf_filename: 'second.pdf',
      });
    chatAttachmentsAPIMock.downloadAttachmentPreviewPdf.mockResolvedValue({
      data: new Blob(['%PDF'], { type: 'application/pdf' }),
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'inline; filename="second.pdf"',
      },
    });
    const { result } = renderHook(() => useChatPreviewController(createControllerArgs()));
    let firstPromise;

    await act(async () => {
      firstPromise = result.current.openDocumentPreview('message-1', {
        id: 'attachment-1',
        file_name: 'first.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      await Promise.resolve();
    });
    const firstSignal = chatAttachmentsAPIMock.getAttachmentPreview.mock.calls[0][2].signal;

    await act(async () => {
      await Promise.all([
        firstPromise,
        result.current.openDocumentPreview('message-2', {
          id: 'attachment-2',
          file_name: 'second.docx',
          mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ]);
    });

    expect(firstSignal.aborted).toBe(true);
    expect(result.current.documentPreview).toMatchObject({
      loading: false,
      filename: 'second.docx',
      pdfFilename: 'second.pdf',
    });
  });
});
