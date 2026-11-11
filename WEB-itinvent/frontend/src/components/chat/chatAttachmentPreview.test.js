import { describe, expect, it, vi } from 'vitest';

import {
  getChatAttachmentPreviewPollDelay,
  isChatDocumentPreviewableAttachment,
  mapChatAttachmentForPreview,
  waitForChatAttachmentPreview,
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
      file_name: 'slides.pptx',
      mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })).toBe(true);
    expect(isChatDocumentPreviewableAttachment({
      file_name: 'archive.zip',
      mime_type: 'application/zip',
    })).toBe(false);
  });

  it('polls queued Office preview metadata with bounded backoff until ready', async () => {
    let clockMs = 0;
    const sleep = vi.fn().mockImplementation(async (delayMs) => {
      clockMs += delayMs;
    });
    const signal = new AbortController().signal;
    const chatAttachmentsAPI = {
      getAttachmentPreview: vi.fn()
        .mockResolvedValueOnce({ preview_status: 'queued', retry_after_ms: 100 })
        .mockResolvedValueOnce({ status: 'processing', retry_after_ms: 500 })
        .mockResolvedValueOnce({ status: 'ready', preview_kind: 'office_pdf' }),
    };

    await expect(waitForChatAttachmentPreview({
      chatAttachmentsAPI,
      messageId: 'msg-1',
      attachmentId: 'att-1',
      signal,
      now: () => clockMs,
      random: () => 0.5,
      sleep,
    })).resolves.toMatchObject({ status: 'ready' });

    expect(chatAttachmentsAPI.getAttachmentPreview).toHaveBeenCalledTimes(3);
    expect(chatAttachmentsAPI.getAttachmentPreview).toHaveBeenNthCalledWith(
      1,
      'msg-1',
      'att-1',
      { signal: expect.any(AbortSignal) },
    );
    expect(sleep.mock.calls.map(([delayMs]) => delayMs)).toEqual([250, 500]);
  });

  it('uses deterministic jitter while keeping polling delays bounded', () => {
    expect(getChatAttachmentPreviewPollDelay({ attempt: 0, random: () => 0 })).toBe(250);
    expect(getChatAttachmentPreviewPollDelay({
      attempt: 20,
      retryAfterMs: 60_000,
      random: () => 1,
    })).toBe(3_000);
  });

  it('stops polling with a clear timeout error', async () => {
    let clockMs = 0;
    const chatAttachmentsAPI = {
      getAttachmentPreview: vi.fn().mockResolvedValue({ status: 'queued', retry_after_ms: 500 }),
    };

    await expect(waitForChatAttachmentPreview({
      chatAttachmentsAPI,
      messageId: 'msg-1',
      attachmentId: 'att-1',
      timeoutMs: 600,
      now: () => clockMs,
      random: () => 0.5,
      sleep: async (delayMs) => {
        clockMs += delayMs;
      },
    })).rejects.toThrow('Предпросмотр готовится дольше обычного');
    expect(chatAttachmentsAPI.getAttachmentPreview).toHaveBeenCalledTimes(3);
  });

  it('aborts an in-flight metadata request at the hard timeout', async () => {
    vi.useFakeTimers();
    try {
      let requestSignal;
      const chatAttachmentsAPI = {
        getAttachmentPreview: vi.fn().mockImplementation((_messageId, _attachmentId, options) => {
          requestSignal = options.signal;
          return new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => {
              const error = new Error('cancelled');
              error.name = 'AbortError';
              reject(error);
            }, { once: true });
          });
        }),
      };
      const previewPromise = waitForChatAttachmentPreview({
        chatAttachmentsAPI,
        messageId: 'msg-1',
        attachmentId: 'att-1',
        timeoutMs: 1_000,
      });
      const expectation = expect(previewPromise).rejects.toThrow(
        'Предпросмотр готовится дольше обычного',
      );

      await vi.advanceTimersByTimeAsync(1_000);
      await expectation;
      expect(requestSignal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps a failed preview response to a clear Russian error', async () => {
    const chatAttachmentsAPI = {
      getAttachmentPreview: vi.fn().mockRejectedValue({
        response: {
          data: { status: 'failed', error: 'converter unavailable' },
        },
      }),
    };

    await expect(waitForChatAttachmentPreview({
      chatAttachmentsAPI,
      messageId: 'msg-1',
      attachmentId: 'att-1',
    })).rejects.toThrow(
      'Не удалось подготовить предпросмотр документа: converter unavailable',
    );
  });
});
