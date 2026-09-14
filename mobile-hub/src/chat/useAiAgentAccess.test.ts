import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { getAiConversationAccess } from '../api/chatApi';
import { useAiAgentAccess } from './useAiAgentAccess';

jest.mock('../api/chatApi', () => ({ getAiConversationAccess: jest.fn() }));
const getAccess = jest.mocked(getAiConversationAccess);
beforeEach(() => {
  jest.useFakeTimers();
  AppState.currentState = 'active';
  getAccess.mockReset().mockResolvedValue({ can_use: true });
});
afterEach(() => { jest.useRealTimers(); });

it('blocks while loading, applies grants and detects revocation', async () => {
  const view = await renderHook(() => useAiAgentAccess('a', true, 1, false));
  await waitFor(() => expect(view.result.current.allowed).toBe(true));
  getAccess.mockResolvedValue({ can_use: false });
  await act(async () => { jest.advanceTimersByTime(15000); });
  expect(view.result.current).toEqual({ allowed: false, loading: false, error: false });
});

it('does not carry an old grant into another user or conversation', async () => {
  let resolve!: (value: { can_use: boolean }) => void;
  getAccess.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const view = await renderHook<ReturnType<typeof useAiAgentAccess>, { id: string; user: number }>(({ id, user }) => useAiAgentAccess(id, true, user, false), { initialProps: { id: 'a', user: 1 } });
  expect(view.result.current.allowed).toBe(false);
  getAccess.mockResolvedValue({ can_use: false });
  await view.rerender({ id: 'b', user: 2 });
  await act(async () => { resolve({ can_use: true }); });
  expect(view.result.current.allowed).toBe(false);
});

it('fails closed on errors then recovers on the next refresh', async () => {
  getAccess.mockRejectedValueOnce(new Error('Network'));
  const view = await renderHook(() => useAiAgentAccess('a', true, 1, false));
  await waitFor(() => expect(view.result.current.error).toBe(true));
  expect(view.result.current.allowed).toBe(false);
  await act(async () => { jest.advanceTimersByTime(15000); });
  expect(view.result.current.allowed).toBe(true);
});

it('does not query access for human conversations or while offline', async () => {
  const view = await renderHook<ReturnType<typeof useAiAgentAccess>, { ai: boolean; offline: boolean }>(({ ai, offline }) => useAiAgentAccess('a', ai, 1, offline), { initialProps: { ai: false, offline: false } });
  expect(view.result.current.allowed).toBe(true);
  await view.rerender({ ai: true, offline: true });
  expect(view.result.current.allowed).toBe(false);
  expect(getAccess).not.toHaveBeenCalled();
});
