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

  it('revokes the document preview blob URL on unmount', async () => {
    const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:chat-doc-preview') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    try {
      chatAttachmentsAPIMock.downloadAttachment.mockResolvedValue({
        data: new Blob(['%PDF'], { type: 'application/pdf' }),
        headers: { 'content-type': 'application/pdf' },
      });
      const { result, unmount } = renderHook(() => useChatPreviewController(createControllerArgs()));

      await act(async () => {
        await result.current.openDocumentPreview('message-1', {
          id: 'attachment-1',
          file_name: 'doc.pdf',
          mime_type: 'application/pdf',
        });
      });
      expect(result.current.documentPreview?.objectUrl).toBe('blob:chat-doc-preview');

      unmount();
      expect(revoke).toHaveBeenCalledWith('blob:chat-doc-preview');
    } finally {
      if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate);
      else delete URL.createObjectURL;
      if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke);
      else delete URL.revokeObjectURL;
    }
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


describe('useChatPreviewController file-photo identity in a mixed chat', () => {
  beforeEach(() => {
    Object.values(chatAttachmentsAPIMock).forEach((mockFn) => mockFn.mockReset());
    chatAttachmentsAPIMock.getConversationAttachments = vi.fn().mockResolvedValue({ items: [], has_more: false });
  });

  const buildMixedChatArgs = () => {
    const args = createControllerArgs();
    args.messagesRef.current = [
      {
        id: 'msg-media',
        conversation_id: 'conversation-1',
        created_at: '2026-01-01T10:00:00.000Z',
        sender: { full_name: 'Sender' },
        attachments: [{ id: 'att-media', kind: 'image', file_name: 'regular.png', mime_type: 'image/png' }],
      },
      {
        id: 'msg-file',
        conversation_id: 'conversation-1',
        created_at: '2026-01-01T11:00:00.000Z',
        sender: { full_name: 'Sender' },
        attachments: [{ id: 'att-filephoto', kind: 'file', file_name: 'photo-as-file.png', mime_type: 'image/png' }],
      },
    ];
    return args;
  };

  it('clicking the photo-as-file shows exactly it, not the other photo', async () => {
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
    const args = buildMixedChatArgs();
    const { result } = renderHook(() => useChatPreviewController(args));

    await act(async () => {
      result.current.openMediaViewer('msg-file', args.messagesRef.current[1].attachments[0]);
      await Promise.resolve();
    });

    const preview = result.current.attachmentPreview;
    expect(preview).toBeTruthy();
    // Активный элемент — нажатый файл, а не первое обычное фото галереи.
    expect(preview.attachment.id).toBe('att-filephoto');
    expect(preview.attachment.messageId).toBe('msg-file');
    // Ссылка на оригинал (источник кнопки скачивания) ведёт на нажатый файл.
    expect(preview.originalUrl).toContain('att-filephoto');
    expect(preview.originalUrl).not.toContain('att-media');
    // Маршрут встроенный, без window.open в отдельную вкладку.
    expect(windowOpen).not.toHaveBeenCalled();
    windowOpen.mockRestore();
  });

  it('clicking the regular photo still shows the regular photo', async () => {
    const args = buildMixedChatArgs();
    const { result } = renderHook(() => useChatPreviewController(args));

    await act(async () => {
      result.current.openMediaViewer('msg-media', args.messagesRef.current[0].attachments[0]);
      await Promise.resolve();
    });

    const preview = result.current.attachmentPreview;
    expect(preview).toBeTruthy();
    expect(preview.attachment.id).toBe('att-media');
    expect(preview.originalUrl).toContain('att-media');
    expect(preview.originalUrl).not.toContain('att-filephoto');
  });
});
