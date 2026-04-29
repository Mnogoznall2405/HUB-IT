import React, { useMemo, useRef, useState } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatAPI } from '../../api/client';
import useChatFileSending from './useChatFileSending';

vi.mock('../../api/client', () => ({
  chatAPI: {
    sendFiles: vi.fn(),
  },
}));

function Harness({ applyOutgoingThreadMessage, patchThreadMessage }) {
  const fileInputRef = useRef(null);
  const mediaFileInputRef = useRef(null);
  const fileUploadAbortRef = useRef(null);
  const [fileCaption, setFileCaption] = useState('caption');
  const [selectedUploadItems, setSelectedUploadItems] = useState([
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

  const { sendFiles } = useChatFileSending({
    activeConversation: { id: 'conversation-1', kind: 'ai', title: 'AI' },
    activeConversationId: 'conversation-1',
    applyOutgoingThreadMessage,
    buildReplyPreview: () => null,
    cancelPendingInitialAnchor: vi.fn(),
    createOptimisticFileMessage: ({ body, files }) => ({
      id: 'optimistic-file-1',
      body,
      files,
      isOptimistic: true,
      optimisticObjectUrls: ['blob:demo'],
    }),
    fileCaption,
    fileInputRef,
    fileUploadAbortRef,
    loadChatDialogsModule: vi.fn(),
    logChatDebug: vi.fn(),
    mediaFileInputRef,
    notifyApiError: vi.fn(),
    notifySuccess: vi.fn(),
    notifyWarning: vi.fn(),
    patchThreadMessage,
    preparingFiles: false,
    removeThreadMessage: vi.fn(),
    replyMessage: null,
    revokeObjectUrls: vi.fn(),
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
    setSelectedUploadItems,
    setSendingFiles: vi.fn(),
    setThreadMenuAnchor: vi.fn(),
  });

  return (
    <button type="button" onClick={sendFiles}>
      send files
    </button>
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
      expect.objectContaining({ replaceId: 'optimistic-file-1', scroll: false }),
    );
  });
});
