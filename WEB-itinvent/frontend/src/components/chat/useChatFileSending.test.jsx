import React, { useMemo, useRef, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
