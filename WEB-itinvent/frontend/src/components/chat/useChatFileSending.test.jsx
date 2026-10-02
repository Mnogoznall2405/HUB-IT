import React, { useMemo, useRef, useState } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatAPI } from '../../api/client';
import useChatFileSending, { buildChatSendUploadItems } from './useChatFileSending';

vi.mock('../../api/client', () => ({
  chatAPI: {
    sendFiles: vi.fn(),
  },
}));

function Harness({
  applyOutgoingThreadMessage,
  createOptimisticFileMessage = ({ body, files }) => ({
    id: 'optimistic-file-1',
    body,
    files,
    isOptimistic: true,
    optimisticObjectUrls: ['blob:demo'],
  }),
  initialSendMediaAsFiles = false,
  initialUploadItems = null,
  notifyWarning = vi.fn(),
  patchThreadMessage,
  queuedFiles = [],
  registerFailedOutgoingMessage = vi.fn(),
}) {
  const fileInputRef = useRef(null);
  const mediaFileInputRef = useRef(null);
  const fileUploadAbortRef = useRef(null);
  const [fileCaption, setFileCaption] = useState('caption');
  const [sendMediaAsFiles, setSendMediaAsFiles] = useState(initialSendMediaAsFiles);
  const [selectedUploadItems, setSelectedUploadItems] = useState(() => initialUploadItems || [
    {
      file: new File(['demo'], 'report.pdf', { type: 'application/pdf' }),
      transferFile: new File(['demo'], 'report.pdf', { type: 'application/pdf' }),
      transferSize: 4,
    },
  ]);
  const selectedFiles = useMemo(
    () => selectedUploadItems.map((item) => item.file).filter(Boolean),
    [selectedUploadItems],
  );

  const {
    applySelectedImageEdit,
    changeSendMediaAsFiles,
    queueSelectedFiles,
    resetSelectedImageEdit,
    sendFiles,
  } = useChatFileSending({
    activeConversation: { id: 'conversation-1', kind: 'ai', title: 'AI' },
    activeConversationId: 'conversation-1',
    applyOutgoingThreadMessage,
    buildReplyPreview: () => null,
    cancelPendingInitialAnchor: vi.fn(),
    createOptimisticFileMessage,
    fileCaption,
    fileInputRef,
    fileUploadAbortRef,
    loadChatDialogsModule: vi.fn(),
    logChatDebug: vi.fn(),
    mediaFileInputRef,
    notifyApiError: vi.fn(),
    notifySuccess: vi.fn(),
    notifyWarning,
    patchThreadMessage,
    preparingFiles: false,
    registerFailedOutgoingMessage,
    removeThreadMessage: vi.fn(),
    replyMessage: null,
    revokeObjectUrls: vi.fn(),
    sendMediaAsFiles,
    selectedFiles,
    selectedUploadItems,
    sendingFiles: false,
    setComposerMenuAnchor: vi.fn(),
    setEmojiAnchorEl: vi.fn(),
    setFileCaption,
    setFileDialogOpen: vi.fn(),
    setFileUploadProgress: vi.fn(),
    setOptimisticAiQueuedStatus: vi.fn(),
    setPreparingFiles: vi.fn(),
    setReplyMessage: vi.fn(),
    setSendMediaAsFiles,
    setSelectedUploadItems,
    setSendingFiles: vi.fn(),
    setThreadMenuAnchor: vi.fn(),
  });

  return (
    <>
      <button type="button" onClick={sendFiles}>send files</button>
      <button type="button" onClick={() => changeSendMediaAsFiles(true)}>send original</button>
      <button type="button" onClick={() => queueSelectedFiles(queuedFiles, { sendMediaAsFiles: true })}>drop original</button>
      <button
        type="button"
        onClick={() => applySelectedImageEdit(0, {
          file: new File(['edited'], 'photo-edited.jpg', { type: 'image/jpeg' }),
          recipe: { version: 1, operations: [{ type: 'rotate', turns: 1 }] },
        })}
      >
        apply edit
      </button>
      <button type="button" onClick={() => resetSelectedImageEdit(0)}>reset edit</button>
      <output aria-label="send mode">{sendMediaAsFiles ? 'file' : 'media'}</output>
      <output aria-label="edit state">{selectedUploadItems[0]?.imageEdit ? 'edited' : 'original'}</output>
      <output aria-label="selected file name">{selectedUploadItems[0]?.file?.name || ''}</output>
    </>
  );
}

describe('useChatFileSending', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatAPI.sendFiles.mockReset();
  });

  it('restores a failed upload only when its original conversation is opened', async () => {
    let reject;
    chatAPI.sendFiles.mockReturnValueOnce(new Promise((_, r) => { reject = r; }));
    const file = new File(['bytes'], 'original.pdf');
    const items = [{ file }];
    const setSelectedUploadItems = vi.fn();
    const args = {
      selectedFiles: [file], selectedUploadItems: items, fileCaption: 'original caption',
      fileUploadAbortRef: { current: null }, buildReplyPreview: vi.fn(), createOptimisticFileMessage: () => ({ id: 'pending' }),
      setSelectedUploadItems,
    };
    for (const key of ['setFileCaption', 'setFileDialogOpen', 'setSendMediaAsFiles', 'setFileUploadProgress',
      'setReplyMessage', 'setSendingFiles', 'applyOutgoingThreadMessage', 'removeThreadMessage', 'notifyApiError', 'revokeObjectUrls']) args[key] = vi.fn();
    const { result, rerender } = renderHook(({ conversation, selected }) => useChatFileSending({
      ...args, activeConversationId: conversation, selectedUploadItems: selected,
    }), { initialProps: { conversation: 'A', selected: items } });
    let sending;
    act(() => { sending = result.current.sendFiles(); });
    rerender({ conversation: 'B', selected: [] });
    await act(async () => { reject(new Error('503')); await sending; });
    expect(setSelectedUploadItems).toHaveBeenCalledExactlyOnceWith([]);
    rerender({ conversation: 'A', selected: [] });
    expect(setSelectedUploadItems).toHaveBeenLastCalledWith(items);
    expect(args.setFileCaption).toHaveBeenLastCalledWith('original caption');
  });

  it('restores files and caption after failure so the same upload can be retried', async () => {
    chatAPI.sendFiles.mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce({ id: 'server' });
    render(<Harness applyOutgoingThreadMessage={vi.fn()} patchThreadMessage={vi.fn()} />);
    fireEvent.click(screen.getByText('send files'));
    await waitFor(() => expect(chatAPI.sendFiles).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText('selected file name').textContent).toBe('report.pdf'));
    fireEvent.click(screen.getByText('send files'));
    await waitFor(() => expect(chatAPI.sendFiles).toHaveBeenCalledTimes(2));
    expect(chatAPI.sendFiles.mock.calls[1][2].body).toBe('caption');
  });

  it('keeps optimistic file message and replaces it with server response', async () => {
    const applyOutgoingThreadMessage = vi.fn();
    const patchThreadMessage = vi.fn();
    chatAPI.sendFiles.mockImplementationOnce(async (_conversationId, _items, options) => {
      options?.onUploadProgress?.({ loaded: 2, total: 4 });
      return {
        id: 'server-file-1',
        body: 'caption',
        attachments: [{ file_name: 'report.pdf' }],
      };
    });

    render(
      <Harness
        applyOutgoingThreadMessage={applyOutgoingThreadMessage}
        patchThreadMessage={patchThreadMessage}
      />,
    );

    fireEvent.click(document.querySelector('button'));

    await waitFor(() => expect(chatAPI.sendFiles).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(applyOutgoingThreadMessage).toHaveBeenCalledTimes(2));

    expect(applyOutgoingThreadMessage).toHaveBeenNthCalledWith(
      1,
      'conversation-1',
      expect.objectContaining({ id: 'optimistic-file-1', isOptimistic: true }),
      expect.objectContaining({ scroll: true, scrollSource: 'sendFiles' }),
    );
    expect(patchThreadMessage).toHaveBeenCalledWith('optimistic-file-1', { uploadProgress: 50 });
    expect(applyOutgoingThreadMessage).toHaveBeenNthCalledWith(
      2,
      'conversation-1',
      expect.objectContaining({ id: 'server-file-1' }),
      expect.objectContaining({ replaceId: 'optimistic-file-1', scroll: true, scrollSource: 'sendFiles:server' }),
    );
  });

  it('uses the original media payload when sending as a file', () => {
    const originalFile = new File(['original-image'], 'photo.jpg', { type: 'image/jpeg' });
    const preparedFile = new File(['small'], 'photo.jpg', { type: 'image/jpeg' });
    const documentFile = new File(['document'], 'report.pdf', { type: 'application/pdf' });
    const documentItem = { file: documentFile, transferFile: documentFile, transferEncoding: 'identity' };

    const [mediaItem, preservedDocumentItem] = buildChatSendUploadItems([
      {
        originalFile,
        file: preparedFile,
        transferFile: preparedFile,
        transferEncoding: 'identity',
        imageWasPrepared: true,
      },
      documentItem,
    ], true);

    expect(mediaItem).toEqual(expect.objectContaining({
      originalFile,
      file: originalFile,
      transferFile: originalFile,
      transferEncoding: 'identity',
      media_kind: 'file',
      mediaKind: 'file',
      imageWasPrepared: false,
    }));
    expect(preservedDocumentItem).toBe(documentItem);
  });

  it('never replaces an edited image with the original payload', () => {
    const originalFile = new File(['original-image'], 'photo.jpg', { type: 'image/jpeg' });
    const editedFile = new File(['edited-image'], 'photo-edited.jpg', { type: 'image/jpeg' });
    const editedItem = {
      originalFile,
      file: editedFile,
      transferFile: editedFile,
      imageEdit: { recipe: { operations: [{ type: 'rotate', turns: 1 }] } },
    };

    expect(buildChatSendUploadItems([editedItem], true)[0]).toBe(editedItem);
  });

  it('enables original-media mode when files are dropped on the no-compression zone', async () => {
    const photo = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
    render(
      <Harness
        applyOutgoingThreadMessage={vi.fn()}
        initialUploadItems={[]}
        patchThreadMessage={vi.fn()}
        queuedFiles={[photo]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'drop original' }));

    await waitFor(() => expect(screen.getByLabelText('send mode')).toHaveTextContent('file'));
  });

  it('sends original media metadata and keeps the optimistic attachment in file mode', async () => {
    const originalFile = new File(['original-image'], 'photo.jpg', { type: 'image/jpeg' });
    const preparedFile = new File(['small'], 'photo.jpg', { type: 'image/jpeg' });
    const createOptimisticFileMessage = vi.fn(() => ({
      id: 'optimistic-file-2',
      optimisticObjectUrls: [],
    }));
    chatAPI.sendFiles.mockResolvedValueOnce({ id: 'server-file-2', attachments: [] });

    render(
      <Harness
        applyOutgoingThreadMessage={vi.fn()}
        createOptimisticFileMessage={createOptimisticFileMessage}
        initialSendMediaAsFiles
        initialUploadItems={[{
          originalFile,
          file: preparedFile,
          transferFile: preparedFile,
          transferSize: preparedFile.size,
          imageWasPrepared: true,
        }]}
        patchThreadMessage={vi.fn()}
      />,
    );

    fireEvent.click(document.querySelector('button'));

    await waitFor(() => expect(chatAPI.sendFiles).toHaveBeenCalledTimes(1));
    const [, uploadItems] = chatAPI.sendFiles.mock.calls[0];
    expect(uploadItems[0]).toEqual(expect.objectContaining({
      file: originalFile,
      transferFile: originalFile,
      transferEncoding: 'identity',
      media_kind: 'file',
    }));
    expect(createOptimisticFileMessage).toHaveBeenCalledWith(expect.objectContaining({
      files: [originalFile],
      mediaKinds: ['file'],
    }));
  });

  it('rejects original-media mode when the original payload exceeds the upload limit', () => {
    const notifyWarning = vi.fn();
    const originalFile = new File(['image'], 'huge.jpg', { type: 'image/jpeg' });
    Object.defineProperty(originalFile, 'size', { configurable: true, value: (25 * 1024 * 1024) + 1 });
    const preparedFile = new File(['small'], 'huge.jpg', { type: 'image/jpeg' });

    render(
      <Harness
        applyOutgoingThreadMessage={vi.fn()}
        initialUploadItems={[{
          originalFile,
          file: preparedFile,
          transferFile: preparedFile,
          transferSize: preparedFile.size,
        }]}
        notifyWarning={notifyWarning}
        patchThreadMessage={vi.fn()}
      />,
    );

    fireEvent.click(document.querySelectorAll('button')[1]);

    expect(notifyWarning).toHaveBeenCalledWith('Суммарный размер оригиналов превышает 25 МБ.');
    expect(document.querySelector('output')).toHaveTextContent('media');
  });

  it('applies and resets an image edit while preserving the immutable original', async () => {
    const notifyWarning = vi.fn();
    const originalFile = new File(['original'], 'photo.jpg', { type: 'image/jpeg' });
    const preparedFile = new File(['prepared'], 'photo.jpg', { type: 'image/jpeg' });
    render(
      <Harness
        applyOutgoingThreadMessage={vi.fn()}
        initialSendMediaAsFiles
        initialUploadItems={[{
          originalFile,
          originalSize: originalFile.size,
          file: preparedFile,
          transferFile: preparedFile,
          transferSize: preparedFile.size,
        }]}
        notifyWarning={notifyWarning}
        patchThreadMessage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'apply edit' }));
    await waitFor(() => expect(screen.getByLabelText('edit state')).toHaveTextContent('edited'));
    expect(screen.getByLabelText('send mode')).toHaveTextContent('media');
    expect(screen.getByLabelText('selected file name')).toHaveTextContent('photo-edited.jpg');

    fireEvent.click(screen.getByRole('button', { name: 'send original' }));
    expect(notifyWarning).toHaveBeenCalledWith('Сбросьте изменения фотографии, чтобы отправить оригинал.');
    expect(screen.getByLabelText('send mode')).toHaveTextContent('media');

    fireEvent.click(screen.getByRole('button', { name: 'reset edit' }));
    await waitFor(() => expect(screen.getByLabelText('edit state')).toHaveTextContent('original'));
    expect(screen.getByLabelText('selected file name')).toHaveTextContent('photo.jpg');
  });

  it('splits a media-only selection above the limit into sequential albums', async () => {
    const applyOutgoingThreadMessage = vi.fn();
    const mediaItems = Array.from({ length: 7 }, (_, index) => {
      const file = new File([`img-${index}`], `photo-${index}.jpg`, { type: 'image/jpeg' });
      return {
        file,
        transferFile: file,
        transferSize: file.size,
        media_kind: 'image',
        imageWidth: 800 + index,
        imageHeight: 600,
      };
    });
    let optimisticSeq = 0;
    const createOptimisticFileMessage = vi.fn(() => {
      const seq = optimisticSeq;
      optimisticSeq += 1;
      return {
        id: `optimistic-album-${seq}`,
        client_message_id: `client-album-${seq}`,
        isOptimistic: true,
        optimisticObjectUrls: [],
      };
    });
    chatAPI.sendFiles
      .mockResolvedValueOnce({ id: 'server-album-0' })
      .mockResolvedValueOnce({ id: 'server-album-1' });

    render(
      <Harness
        applyOutgoingThreadMessage={applyOutgoingThreadMessage}
        createOptimisticFileMessage={createOptimisticFileMessage}
        initialUploadItems={mediaItems}
        patchThreadMessage={vi.fn()}
      />,
    );

    fireEvent.click(document.querySelector('button'));

    await waitFor(() => expect(chatAPI.sendFiles).toHaveBeenCalledTimes(2));

    const [firstCall, secondCall] = chatAPI.sendFiles.mock.calls;
    expect(firstCall[1]).toHaveLength(5);
    expect(secondCall[1]).toHaveLength(2);
    expect(firstCall[2]).toEqual(expect.objectContaining({
      client_message_id: 'client-album-0',
      body: 'caption',
    }));
    expect(secondCall[2]).toEqual(expect.objectContaining({
      client_message_id: 'client-album-1',
      body: '',
    }));

    expect(createOptimisticFileMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      body: 'caption',
      mediaDimensions: mediaItems.slice(0, 5).map((item) => ({ width: item.imageWidth, height: item.imageHeight })),
    }));
    expect(createOptimisticFileMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      body: '',
      mediaDimensions: mediaItems.slice(5).map((item) => ({ width: item.imageWidth, height: item.imageHeight })),
    }));

    // Both optimistic bubbles land in order, then each is replaced by its ACK.
    const optimisticInserts = applyOutgoingThreadMessage.mock.calls
      .filter(([, message]) => String(message?.id || '').startsWith('optimistic-album'));
    expect(optimisticInserts.map(([, message]) => message.id)).toEqual(['optimistic-album-0', 'optimistic-album-1']);
    expect(applyOutgoingThreadMessage).toHaveBeenCalledWith(
      'conversation-1',
      expect.objectContaining({ id: 'server-album-0' }),
      expect.objectContaining({ replaceId: 'optimistic-album-0' }),
    );
    expect(applyOutgoingThreadMessage).toHaveBeenCalledWith(
      'conversation-1',
      expect.objectContaining({ id: 'server-album-1' }),
      expect.objectContaining({ replaceId: 'optimistic-album-1' }),
    );
  });

  it('keeps a failed album as a failed optimistic bubble while sent albums stay', async () => {
    const applyOutgoingThreadMessage = vi.fn();
    const registerFailedOutgoingMessage = vi.fn();
    const mediaItems = Array.from({ length: 6 }, (_, index) => {
      const file = new File([`img-${index}`], `photo-${index}.jpg`, { type: 'image/jpeg' });
      return { file, transferFile: file, transferSize: file.size, media_kind: 'image' };
    });
    let optimisticSeq = 0;
    const createOptimisticFileMessage = vi.fn(() => {
      const seq = optimisticSeq;
      optimisticSeq += 1;
      return {
        id: `optimistic-album-${seq}`,
        client_message_id: `client-album-${seq}`,
        isOptimistic: true,
        optimisticObjectUrls: [`blob:album-${seq}`],
      };
    });
    chatAPI.sendFiles
      .mockResolvedValueOnce({ id: 'server-album-0' })
      .mockRejectedValueOnce(new Error('503'));

    render(
      <Harness
        applyOutgoingThreadMessage={applyOutgoingThreadMessage}
        createOptimisticFileMessage={createOptimisticFileMessage}
        initialUploadItems={mediaItems}
        patchThreadMessage={vi.fn()}
        registerFailedOutgoingMessage={registerFailedOutgoingMessage}
      />,
    );

    fireEvent.click(document.querySelector('button'));

    await waitFor(() => expect(registerFailedOutgoingMessage).toHaveBeenCalledTimes(1));
    const [failedConversationId, failedMessage, failedExtras] = registerFailedOutgoingMessage.mock.calls[0];
    expect(failedConversationId).toBe('conversation-1');
    expect(failedMessage).toEqual(expect.objectContaining({
      id: 'optimistic-album-1',
      client_message_id: 'client-album-1',
    }));
    expect(failedExtras?.fileResend?.uploadItems).toHaveLength(1);
    // The sent album was still replaced by its server ACK.
    expect(applyOutgoingThreadMessage).toHaveBeenCalledWith(
      'conversation-1',
      expect.objectContaining({ id: 'server-album-0' }),
      expect.objectContaining({ replaceId: 'optimistic-album-0' }),
    );
  });

  it('warns instead of sending when a non-media selection exceeds one album', async () => {
    const notifyWarning = vi.fn();
    const mixedItems = Array.from({ length: 6 }, (_, index) => {
      const file = new File([`doc-${index}`], `doc-${index}.pdf`, { type: 'application/pdf' });
      return { file, transferFile: file, transferSize: file.size };
    });

    render(
      <Harness
        applyOutgoingThreadMessage={vi.fn()}
        initialUploadItems={mixedItems}
        notifyWarning={notifyWarning}
        patchThreadMessage={vi.fn()}
      />,
    );

    fireEvent.click(document.querySelector('button'));

    expect(chatAPI.sendFiles).not.toHaveBeenCalled();
    expect(notifyWarning).toHaveBeenCalledWith('Можно отправить не более 5 файлов за один раз.');
  });

  it('rechecks the 25 MB original-media limit immediately before sending', () => {
    const notifyWarning = vi.fn();
    const originalFile = new File(['image'], 'huge.jpg', { type: 'image/jpeg' });
    Object.defineProperty(originalFile, 'size', { configurable: true, value: (25 * 1024 * 1024) + 1 });
    const preparedFile = new File(['small'], 'huge.jpg', { type: 'image/jpeg' });

    render(
      <Harness
        applyOutgoingThreadMessage={vi.fn()}
        initialSendMediaAsFiles
        initialUploadItems={[{
          originalFile,
          file: preparedFile,
          transferFile: preparedFile,
          transferSize: preparedFile.size,
        }]}
        notifyWarning={notifyWarning}
        patchThreadMessage={vi.fn()}
      />,
    );

    fireEvent.click(document.querySelector('button'));

    expect(chatAPI.sendFiles).not.toHaveBeenCalled();
    expect(notifyWarning).toHaveBeenCalledWith('Суммарный размер оригиналов превышает 25 МБ.');
    expect(document.querySelector('output')).toHaveTextContent('media');
  });
});
