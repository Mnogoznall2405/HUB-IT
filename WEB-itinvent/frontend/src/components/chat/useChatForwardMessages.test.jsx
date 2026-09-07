import React, { useRef, useState } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatAPI } from '../../api/client';
import useChatForwardMessages from './useChatForwardMessages';

vi.mock('../../api/client', () => ({
  chatAPI: {
    forwardMessage: vi.fn(),
  },
}));

function Harness({ upsertThreadMessages, syncConversationPreview }) {
  const activeConversationIdRef = useRef('target-1');
  const [forwardMessages, setForwardMessages] = useState([
    { id: 'm1', body: 'First' },
    { id: 'm2', body: 'Second' },
  ]);
  const [forwardingConversationId, setForwardingConversationId] = useState('');
  const [forwardOpen, setForwardOpen] = useState(true);
  void forwardOpen;

  const { handleForwardMessageToConversation } = useChatForwardMessages({
    activeConversationIdRef,
    clearSelectedMessages: vi.fn(),
    closeMessageMenu: vi.fn(),
    forwardMessages,
    forwardingConversationId,
    loadChatDialogsModule: vi.fn(),
    loadConversations: vi.fn(),
    normalizeForwardMessageQueue: (messages) => (Array.isArray(messages) ? messages : [messages]).filter(Boolean),
    notifyApiError: vi.fn(),
    notifySuccess: vi.fn(),
    openConversation: vi.fn(),
    promoteConversationToTop: vi.fn(),
    queueAutoScroll: vi.fn(),
    setComposerMenuAnchor: vi.fn(),
    setForwardConversationQuery: vi.fn(),
    setForwardMessages,
    setForwardOpen,
    setForwardingConversationId,
    setMessageMenuAnchor: vi.fn(),
    setMessageMenuMessage: vi.fn(),
    setReplyMessage: vi.fn(),
    setThreadMenuAnchor: vi.fn(),
    syncConversationPreview,
    upsertThreadMessages,
  });

  return (
    <button type="button" onClick={() => handleForwardMessageToConversation('target-1')}>
      forward
    </button>
  );
}

describe('useChatForwardMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatAPI.forwardMessage.mockReset();
  });

  it('retries only the incomplete item with its original idempotency key', async () => {
    chatAPI.forwardMessage.mockResolvedValueOnce({ id: 'f1' }).mockRejectedValueOnce(new Error('lost response'));
    render(<Harness upsertThreadMessages={vi.fn()} syncConversationPreview={vi.fn()} />);
    fireEvent.click(document.querySelector('button'));
    await waitFor(() => expect(chatAPI.forwardMessage).toHaveBeenCalledTimes(2));
    const failedKey = chatAPI.forwardMessage.mock.calls[1][2]?.client_message_id;
    expect(failedKey).toBeTruthy();
    chatAPI.forwardMessage.mockResolvedValueOnce({ id: 'f2' });
    fireEvent.click(document.querySelector('button'));
    await waitFor(() => expect(chatAPI.forwardMessage).toHaveBeenCalledTimes(3));
    expect(chatAPI.forwardMessage.mock.calls.map(call => call[1])).toEqual(['m1', 'm2', 'm2']);
    expect(chatAPI.forwardMessage.mock.calls[2][2].client_message_id).toBe(failedKey);
  });

  it('forwards queued messages in order and updates active thread', async () => {
    const upsertThreadMessages = vi.fn();
    const syncConversationPreview = vi.fn();
    chatAPI.forwardMessage
      .mockResolvedValueOnce({ id: 'f1', body: 'First' })
      .mockResolvedValueOnce({ id: 'f2', body: 'Second' });

    render(
      <Harness
        upsertThreadMessages={upsertThreadMessages}
        syncConversationPreview={syncConversationPreview}
      />,
    );

    fireEvent.click(document.querySelector('button'));

    await waitFor(() => expect(chatAPI.forwardMessage).toHaveBeenCalledTimes(2));
    expect(chatAPI.forwardMessage).toHaveBeenNthCalledWith(1, 'target-1', 'm1', expect.objectContaining({ client_message_id: expect.any(String) }));
    expect(chatAPI.forwardMessage).toHaveBeenNthCalledWith(2, 'target-1', 'm2', expect.objectContaining({ client_message_id: expect.any(String) }));
    expect(upsertThreadMessages).toHaveBeenCalledWith([
      { id: 'f1', body: 'First' },
      { id: 'f2', body: 'Second' },
    ]);
    expect(syncConversationPreview).toHaveBeenCalledWith('target-1', { id: 'f2', body: 'Second' }, { unread_count: 0 });
  });
});
