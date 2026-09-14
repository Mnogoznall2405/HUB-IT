import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useAiAgentAccess from './useAiAgentAccess';
import { aiBotAccess } from '../../api/aiBotAccess';
vi.mock('../../api/aiBotAccess', () => ({ aiBotAccess: { conversation: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());
describe('agent write access', () => {
  it('denies until checked, responds to revoke and fails closed on errors', async () => {
    aiBotAccess.conversation.mockResolvedValue({ can_use: true });
    const { result } = renderHook(() => useAiAgentAccess('conversation', true, 2));
    expect(result.current.allowed).toBe(false);
    await waitFor(() => expect(result.current.allowed).toBe(true));
    aiBotAccess.conversation.mockResolvedValue({ can_use: false });
    act(() => window.dispatchEvent(new Event('ai-agent-access-changed')));
    await waitFor(() => expect(result.current.allowed).toBe(false));
    aiBotAccess.conversation.mockRejectedValue(new Error('offline'));
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(result.current.error).toBe(true));
  });
  it('does not query agent access for ordinary conversations', () => {
    const { result } = renderHook(() => useAiAgentAccess('conversation', false, 2));
    expect(result.current.allowed).toBe(true);
    expect(aiBotAccess.conversation).not.toHaveBeenCalled();
  });
});
