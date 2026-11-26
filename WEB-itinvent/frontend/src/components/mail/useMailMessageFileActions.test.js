import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  requestMobilePrint: vi.fn(() => false),
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

  it('hands print jobs to the Android host without opening a browser popup', () => {
    const requestMobilePrint = vi.fn(() => true);
    const openWindow = vi.fn();
    const props = createProps({ requestMobilePrint, openWindow });
    const { result } = renderHook(() => useMailMessageFileActions(props));

    act(() => {
      expect(result.current.handlePrintSelectedMessage()).toBe(true);
    });

    expect(requestMobilePrint).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Hello',
      html: expect.stringContaining('<p>Rendered</p>'),
    }));
    expect(openWindow).not.toHaveBeenCalled();
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

    expect(props.mailAPI.downloadAttachment).toHaveBeenCalledWith('msg-1', 'att-1', expect.objectContaining({ mailboxId: 'mb-1' }));
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
      expect.objectContaining({ mailboxId: 'mb-1' }),
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

  it('rebuilds the PDF preview when the office viewer frame fails after a config fetch', async () => {
    const props = createProps({
      openOfficeWithDesktopApplication: vi.fn(async () => ({ accepted: false, status: 'unavailable' })),
      mailAPI: {
        getMessageHeaders: vi.fn(),
        downloadMessageSource: vi.fn(),
        downloadAttachment: vi.fn(),
        getAttachmentOfficeView: vi.fn().mockResolvedValue({
          config: { document: { key: 'view-1' } },
          public_path: '/onlyoffice',
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

    expect(result.current.attachmentPreview).toMatchObject({
      open: true,
      kind: 'office_view',
    });
    expect(typeof result.current.attachmentPreview.officeView.onError).toBe('function');

    await act(async () => {
      await result.current.attachmentPreview.officeView.onError();
    });

    expect(props.mailAPI.getAttachmentOfficeView).toHaveBeenCalledTimes(1);
    expect(props.mailAPI.downloadAttachmentPreviewPdf).toHaveBeenCalledWith(
      'msg-1',
      'att-docx',
      expect.objectContaining({ mailboxId: 'mb-1' }),
    );
    expect(result.current.attachmentPreview).toMatchObject({
      open: true,
      loading: false,
      kind: 'office_pdf',
    });
    expect(result.current.attachmentPreview.officeView).toBeFalsy();
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

describe('attachment preview object URL lifecycle', () => {
  const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  const imageResponse = (name = 'photo.png') => ({
    data: new Blob(['image-bytes'], { type: 'image/png' }),
    headers: {
      'content-type': 'image/png',
      'content-disposition': `attachment; filename="${name}"`,
    },
  });

  const imageProps = () => createProps({
    mailAPI: {
      getMessageHeaders: vi.fn(),
      downloadMessageSource: vi.fn(),
      downloadAttachment: vi.fn().mockResolvedValue(imageResponse()),
    },
  });

  const openImagePreview = async (result, name = 'photo.png') => {
    await act(async () => {
      await result.current.openAttachmentPreview(
        { id: 'msg-1', mailbox_id: 'mb-1' },
        { id: `att-${name}`, name, content_type: 'image/png' },
      );
    });
  };

  let originalCreate;
  let originalRevoke;
  let create;
  let revoke;

  beforeEach(() => {
    originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    create = vi.fn(() => 'blob:mail-preview');
    revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
  });

  afterEach(() => {
    if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate);
    else delete URL.createObjectURL;
    if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke);
    else delete URL.revokeObjectURL;
  });

  it('revokes the blob URL once on close and not again on a repeated close', async () => {
    const { result } = renderHook(() => useMailMessageFileActions(imageProps()));

    await openImagePreview(result);
    expect(result.current.attachmentPreview.objectUrl).toBe('blob:mail-preview');

    act(() => result.current.closeAttachmentPreview());
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:mail-preview');

    act(() => result.current.closeAttachmentPreview());
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('revokes the previous blob URL when another preview replaces it', async () => {
    create.mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
    const { result, unmount } = renderHook(() => useMailMessageFileActions(imageProps()));

    await openImagePreview(result, 'one.png');
    expect(result.current.attachmentPreview.objectUrl).toBe('blob:first');

    await openImagePreview(result, 'two.png');
    expect(result.current.attachmentPreview.objectUrl).toBe('blob:second');
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:first');

    unmount();
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenLastCalledWith('blob:second');
  });

  it('revokes the blob URL once when the hook unmounts with an open preview', async () => {
    const { result, unmount } = renderHook(() => useMailMessageFileActions(imageProps()));

    await openImagePreview(result);
    unmount();

    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:mail-preview');
  });

  it('ignores non-blob preview URLs', async () => {
    create.mockReturnValue('https://cdn.example.test/photo.png');
    const { result, unmount } = renderHook(() => useMailMessageFileActions(imageProps()));

    await openImagePreview(result);
    expect(result.current.attachmentPreview.objectUrl).toBe('https://cdn.example.test/photo.png');

    act(() => result.current.closeAttachmentPreview());
    unmount();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('revokes a late blob URL once and stays closed when closed before the response resolves', async () => {
    const pending = deferred();
    const props = imageProps();
    props.mailAPI.downloadAttachment = vi.fn(() => pending.promise);
    const { result } = renderHook(() => useMailMessageFileActions(props));

    let openPromise;
    act(() => {
      openPromise = result.current.openAttachmentPreview(
        { id: 'msg-1', mailbox_id: 'mb-1' },
        { id: 'att-photo', name: 'photo.png', content_type: 'image/png' },
      );
    });
    act(() => result.current.closeAttachmentPreview());

    await act(async () => {
      pending.resolve(imageResponse());
      await openPromise;
    });

    expect(result.current.attachmentPreview.open).toBe(false);
    expect(result.current.attachmentPreview.objectUrl).toBe('');
    expect(create).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:mail-preview');
  });

  it('revokes a late blob URL once when the hook unmounts before the response resolves', async () => {
    const pending = deferred();
    const props = imageProps();
    props.mailAPI.downloadAttachment = vi.fn(() => pending.promise);
    const { result, unmount } = renderHook(() => useMailMessageFileActions(props));

    let openPromise;
    act(() => {
      openPromise = result.current.openAttachmentPreview(
        { id: 'msg-1', mailbox_id: 'mb-1' },
        { id: 'att-photo', name: 'photo.png', content_type: 'image/png' },
      );
    });
    unmount();

    await act(async () => {
      pending.resolve(imageResponse());
      await openPromise;
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:mail-preview');
  });

  it('revokes a late Office preview blob URL when closed before conversion resolves', async () => {
    const pending = deferred();
    const props = createProps({
      openOfficeWithDesktopApplication: vi.fn(async () => ({ accepted: false, status: 'unavailable' })),
      mailAPI: {
        getMessageHeaders: vi.fn(),
        downloadMessageSource: vi.fn(),
        downloadAttachment: vi.fn(),
        getAttachmentPreview: vi.fn().mockResolvedValue({
          status: 'ready',
          preview_kind: 'office_pdf',
          source_kind: 'word',
          pdf_filename: 'memo.pdf',
          page_count: 1,
        }),
        downloadAttachmentPreviewPdf: vi.fn(() => pending.promise),
      },
    });
    const { result } = renderHook(() => useMailMessageFileActions(props));

    let openPromise;
    act(() => {
      openPromise = result.current.openAttachmentPreview(
        { id: 'msg-1', mailbox_id: 'mb-1' },
        {
          id: 'att-docx',
          name: 'memo.docx',
          content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(props.mailAPI.downloadAttachmentPreviewPdf).toHaveBeenCalledWith(
      'msg-1',
      'att-docx',
      expect.objectContaining({ mailboxId: 'mb-1' }),
    );
    expect(result.current.attachmentPreview).toMatchObject({ open: true, loading: true });

    act(() => result.current.closeAttachmentPreview());
    await act(async () => {
      pending.resolve({
        data: new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="memo.pdf"',
        },
      });
      await openPromise;
    });

    expect(result.current.attachmentPreview.open).toBe(false);
    expect(revoke).toHaveBeenCalledTimes(1);
  });
});
