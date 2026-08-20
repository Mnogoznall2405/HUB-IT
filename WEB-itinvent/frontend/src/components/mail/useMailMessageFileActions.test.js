import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import useMailMessageFileActions from './useMailMessageFileActions';

const createPrintWindow = () => ({
  document: {
    write: vi.fn(),
    close: vi.fn(),
  },
  focus: vi.fn(),
  print: vi.fn(),
});

const createProps = (overrides = {}) => ({
  mailAPI: {
    getMessageHeaders: vi.fn().mockResolvedValue({ items: [{ name: 'From', value: 'sender@example.com' }] }),
    downloadMessageSource: vi.fn().mockResolvedValue({
      data: 'source',
      headers: { 'content-disposition': 'attachment; filename="source.eml"' },
    }),
    downloadAttachment: vi.fn().mockResolvedValue({
      data: 'attachment body',
      headers: { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="notes.txt"' },
    }),
  },
  selectedMessage: {
    id: 'msg-1',
    subject: 'Hello',
    mailbox_id: 'mb-1',
    sender: 'sender@example.com',
    received_at: '2026-05-03T10:00:00Z',
    body_html: '<p>Hello</p>',
  },
  selectedRenderedHtml: '<p>Rendered</p>',
  viewMode: 'messages',
  resolveItemMailboxId: (item) => item?.mailbox_id || 'mb-1',
  getMessageDetailForListAction: vi.fn().mockResolvedValue({
    id: 'msg-list',
    subject: 'List message',
    sender: 'sender@example.com',
    received_at: '2026-05-03T10:00:00Z',
    body_html: '<p>List</p>',
  }),
  handleMailCredentialsRequired: vi.fn().mockResolvedValue(false),
  getMailErrorDetail: vi.fn((error, fallback) => fallback),
  getMailErrorDetailAsync: vi.fn(async (error, fallback) => fallback),
  setError: vi.fn(),
  formatFullDate: (value) => String(value || ''),
  downloadBlobFileImpl: vi.fn(),
  openWindow: vi.fn(() => createPrintWindow()),
  ...overrides,
});

describe('useMailMessageFileActions', () => {
  it('loads selected message headers with mailbox scope', async () => {
    const props = createProps();
    const { result } = renderHook(() => useMailMessageFileActions(props));

    await act(async () => {
      await result.current.handleOpenHeaders();
    });

    expect(props.mailAPI.getMessageHeaders).toHaveBeenCalledWith('msg-1', { mailboxId: 'mb-1' });
    expect(result.current.headersOpen).toBe(true);
    expect(result.current.headersForDialog).toEqual({ items: [{ name: 'From', value: 'sender@example.com' }] });
  });

  it('downloads selected message source through the shared downloader', async () => {
    const props = createProps();
    const { result } = renderHook(() => useMailMessageFileActions(props));

    await act(async () => {
      await result.current.handleDownloadMessageSource();
    });

    expect(props.mailAPI.downloadMessageSource).toHaveBeenCalledWith('msg-1', { mailboxId: 'mb-1' });
    expect(props.downloadBlobFileImpl).toHaveBeenCalledWith(
      expect.any(Blob),
      'source.eml',
      { preferOpenFallback: true },
    );
  });

  it('prints selected and list messages through one print workflow', async () => {
    const selectedPrintWindow = createPrintWindow();
    const listPrintWindow = createPrintWindow();
    const openWindow = vi.fn()
      .mockReturnValueOnce(selectedPrintWindow)
      .mockReturnValueOnce(listPrintWindow);
    const props = createProps({ openWindow });
    const { result } = renderHook(() => useMailMessageFileActions(props));

    act(() => {
      result.current.handlePrintSelectedMessage();
    });
    await act(async () => {
      await result.current.handleListPrintMessage({ id: 'msg-list', mailbox_id: 'mb-1' });
    });

    expect(selectedPrintWindow.document.write).toHaveBeenCalledWith(expect.stringContaining('<p>Rendered</p>'));
    expect(props.getMessageDetailForListAction).toHaveBeenCalledWith({ id: 'msg-list', mailbox_id: 'mb-1' });
    expect(listPrintWindow.document.write).toHaveBeenCalledWith(expect.stringContaining('List message'));
  });

  it('opens attachment previews and keeps the loaded blob for dialog download', async () => {
    const props = createProps();
    const { result } = renderHook(() => useMailMessageFileActions(props));

    await act(async () => {
      await result.current.openAttachmentPreview(
        { id: 'msg-1', mailbox_id: 'mb-1' },
        { id: 'att-1', name: 'notes.txt', content_type: 'text/plain' },
      );
    });

    expect(props.mailAPI.downloadAttachment).toHaveBeenCalledWith('msg-1', 'att-1', { mailboxId: 'mb-1' });
    expect(result.current.attachmentPreview).toMatchObject({
      open: true,
      filename: 'notes.txt',
      kind: 'text',
      textContent: 'attachment body',
    });

    act(() => {
      result.current.downloadAttachmentPreview();
    });

    expect(props.downloadBlobFileImpl).toHaveBeenCalledWith(
      expect.any(Blob),
      'notes.txt',
      { preferOpenFallback: true },
    );
  });

  it('downloads the real Word attachment when preview only has a PDF blob', async () => {
    const props = createProps({
      mailAPI: {
        getMessageHeaders: vi.fn(),
        downloadMessageSource: vi.fn(),
        downloadAttachment: vi.fn().mockResolvedValue({
          data: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
          headers: {
            'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'content-disposition': 'attachment; filename="memo.docx"',
          },
        }),
        getAttachmentPreview: vi.fn().mockResolvedValue({
          status: 'ready',
          preview_kind: 'office_pdf',
          source_kind: 'word',
          pdf_filename: 'memo.pdf',
          page_count: 1,
        }),
        downloadAttachmentPreviewPdf: vi.fn().mockResolvedValue({
          data: new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
          headers: {
            'content-type': 'application/pdf',
            'content-disposition': 'attachment; filename="memo.pdf"',
          },
        }),
      },
    });
    const { result } = renderHook(() => useMailMessageFileActions(props));
    const message = { id: 'msg-1', mailbox_id: 'mb-1' };
    const attachment = {
      id: 'att-docx',
      name: 'memo.docx',
      content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };

    await act(async () => {
      await result.current.openAttachmentPreview(message, attachment);
    });

    expect(props.mailAPI.downloadAttachmentPreviewPdf).toHaveBeenCalledWith(
      'msg-1',
      'att-docx',
      { mailboxId: 'mb-1' },
    );
    expect(result.current.attachmentPreview).toMatchObject({
      open: true,
      filename: 'memo.docx',
      kind: 'office_pdf',
      blob: null,
    });
    expect(result.current.attachmentPreview.previewBlob).toBeTruthy();

    props.mailAPI.downloadAttachment.mockClear();
    props.downloadBlobFileImpl.mockClear();

    await act(async () => {
      await result.current.downloadAttachmentPreview();
    });

    expect(props.mailAPI.downloadAttachment).toHaveBeenCalledWith(
      'msg-1',
      'att-docx',
      { mailboxId: 'mb-1' },
    );
    expect(props.downloadBlobFileImpl).toHaveBeenCalledWith(
      expect.any(Blob),
      'memo.docx',
      { preferOpenFallback: true },
    );
    const savedBlob = props.downloadBlobFileImpl.mock.calls[0][0];
    expect(savedBlob.type).not.toBe('application/pdf');
  });

  it('deduplicates concurrent attachment downloads for the same message and attachment', async () => {
    let resolveDownload;
    const downloadPromise = new Promise((resolve) => {
      resolveDownload = resolve;
    });
    const props = createProps({
      mailAPI: {
        getMessageHeaders: vi.fn(),
        downloadMessageSource: vi.fn(),
        downloadAttachment: vi.fn(() => downloadPromise),
      },
    });
    const { result } = renderHook(() => useMailMessageFileActions(props));

    let first;
    let second;
    await act(async () => {
      first = result.current.downloadAttachmentFile(
        { id: 'msg-1', mailbox_id: 'mb-1' },
        { id: 'att-1', name: 'notes.txt', content_type: 'text/plain' },
      );
      second = result.current.downloadAttachmentFile(
        { id: 'msg-1', mailbox_id: 'mb-1' },
        { id: 'att-1', name: 'notes.txt', content_type: 'text/plain' },
      );
      await Promise.resolve();
    });

    expect(props.mailAPI.downloadAttachment).toHaveBeenCalledTimes(1);

    resolveDownload({
      data: 'body',
      headers: { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="notes.txt"' },
    });
    await act(async () => {
      await Promise.all([first, second]);
    });

    await waitFor(() => {
      expect(props.downloadBlobFileImpl).toHaveBeenCalledTimes(1);
    });
  });

  it('opens Office attachments in the Desktop Word/Excel handler instead of converting to PDF', async () => {
    const openOfficeWithDesktopApplication = vi.fn(async ({ onDownload }) => {
      await onDownload?.();
      return { accepted: true, status: 'accepted' };
    });
    const props = createProps({
      openOfficeWithDesktopApplication,
      mailAPI: {
        getMessageHeaders: vi.fn(),
        downloadMessageSource: vi.fn(),
        downloadAttachment: vi.fn().mockResolvedValue({
          data: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
          headers: {
            'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'content-disposition': 'attachment; filename="memo.docx"',
          },
        }),
        downloadAttachmentPreviewPdf: vi.fn(),
      },
    });
    const { result } = renderHook(() => useMailMessageFileActions(props));

    await act(async () => {
      await result.current.openAttachmentPreview(
        { id: 'msg-1', mailbox_id: 'mb-1' },
        {
          id: 'att-docx',
          name: 'memo.docx',
          content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
      );
    });

    expect(openOfficeWithDesktopApplication).toHaveBeenCalledTimes(1);
    expect(props.mailAPI.downloadAttachmentPreviewPdf).not.toHaveBeenCalled();
    expect(props.mailAPI.downloadAttachment).toHaveBeenCalledWith('msg-1', 'att-docx', { mailboxId: 'mb-1' });
    expect(props.downloadBlobFileImpl).toHaveBeenCalledWith(
      expect.any(Blob),
      'memo.docx',
      { preferOpenFallback: true },
    );
    expect(result.current.attachmentPreview.open).toBe(false);
  });
});
