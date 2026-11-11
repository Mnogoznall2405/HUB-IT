import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatAPI } from '../../api/client';
import useChatTaskSharing from './useChatTaskSharing';

vi.mock('../../api/client', () => ({
  chatAPI: {
    shareTask: vi.fn(),
  },
}));

function Harness({ applyOutgoingThreadMessage, resetShareDialog }) {
  const { shareTask } = useChatTaskSharing({
    activeConversationId: 'conversation-1',
    applyOutgoingThreadMessage,
    cancelPendingInitialAnchor: vi.fn(),
    logChatDebug: vi.fn(),
    notifyApiError: vi.fn(),
    notifySuccess: vi.fn(),
    replyMessage: { id: 'reply-1' },
    resetShareDialog,
    setReplyMessage: vi.fn(),
    setSharingTaskId: vi.fn(),
  });

  return (
    <button type="button" onClick={() => shareTask('task-1')}>
      share
    </button>
  );
}

describe('useChatTaskSharing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shares a task and applies server message to active thread', async () => {
    const applyOutgoingThreadMessage = vi.fn();
    const resetShareDialog = vi.fn();
    chatAPI.shareTask.mockResolvedValueOnce({ id: 'message-1', body: 'Task' });

    render(
      <Harness
        applyOutgoingThreadMessage={applyOutgoingThreadMessage}
        resetShareDialog={resetShareDialog}
      />,
    );

    fireEvent.click(document.querySelector('button'));

    await waitFor(() => expect(chatAPI.shareTask).toHaveBeenCalledWith('conversation-1', 'task-1', {
      reply_to_message_id: 'reply-1',
    }));
    expect(resetShareDialog).toHaveBeenCalledTimes(1);
    expect(applyOutgoingThreadMessage).toHaveBeenCalledWith(
      'conversation-1',
      { id: 'message-1', body: 'Task' },
      { scroll: true, scrollSource: 'shareTask' },
    );
  });
});
