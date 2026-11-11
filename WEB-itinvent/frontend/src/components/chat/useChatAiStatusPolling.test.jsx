import React from 'react';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatAPI } from '../../api/client';
import { mergeAiStatusPayload, shouldPollActiveAiThread } from '../../pages/chat/chatAiModel';
import useChatAiStatusPolling from './useChatAiStatusPolling';

vi.mock('../../api/client', () => ({
  chatAPI: {
    getConversationAiStatus: vi.fn(),
  },
}));

const setAiStatusByConversation = vi.fn();

function Harness({ aiStatus, intervalMs = 1000, ...overrides }) {
  useChatAiStatusPolling({
    activeConversationId: 'ai-conv-1',
    activeConversationKind: 'ai',
    activeThreadTransportState: 'healthy',
    aiStatus,
    canUseAiChat: true,
    intervalMs,
    mergeAiStatusPayload,
    setAiStatusByConversation,
    shouldPollActiveAiThread,
    socketStatus: 'connected',
    ...overrides,
  });
  return null;
}

describe('useChatAiStatusPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    chatAPI.getConversationAiStatus.mockResolvedValue({
      conversation_id: 'ai-conv-1',
      status: 'running',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('does not restart polling when aiStatus object reference changes but status stays the same', async () => {
    const { rerender } = render(<Harness aiStatus={{ status: 'running' }} />);

    expect(chatAPI.getConversationAiStatus).toHaveBeenCalledTimes(1);

    rerender(<Harness aiStatus={{ status: 'running', stage: 'analyzing_request' }} />);
    await Promise.resolve();

    expect(chatAPI.getConversationAiStatus).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(chatAPI.getConversationAiStatus).toHaveBeenCalledTimes(2);
  });

  it('polls on the configured interval', async () => {
    render(<Harness aiStatus={{ status: 'running' }} intervalMs={1000} />);

    expect(chatAPI.getConversationAiStatus).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(chatAPI.getConversationAiStatus).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(chatAPI.getConversationAiStatus).toHaveBeenCalledTimes(3);
  });

  it('does not start overlapping polls while a request is in flight', async () => {
    let resolveRequest;
    chatAPI.getConversationAiStatus.mockImplementation(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));

    render(<Harness aiStatus={{ status: 'running' }} intervalMs={1000} />);

    expect(chatAPI.getConversationAiStatus).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(chatAPI.getConversationAiStatus).toHaveBeenCalledTimes(1);

    resolveRequest({ conversation_id: 'ai-conv-1', status: 'running' });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);

    expect(chatAPI.getConversationAiStatus).toHaveBeenCalledTimes(2);
  });
});
