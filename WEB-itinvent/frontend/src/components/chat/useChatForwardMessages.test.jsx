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
    expect(chatAPI.forwardMessage).toHaveBeenNthCalledWith(1, 'target-1', 'm1');
    expect(chatAPI.forwardMessage).toHaveBeenNthCalledWith(2, 'target-1', 'm2');
    expect(upsertThreadMessages).toHaveBeenCalledWith([
      { id: 'f1', body: 'First' },
      { id: 'f2', body: 'Second' },
    ]);
    expect(syncConversationPreview).toHaveBeenCalledWith('target-1', { id: 'f2', body: 'Second' }, { unread_count: 0 });
  });
});
