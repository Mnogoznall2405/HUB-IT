import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { chatAPI } from '../../api/client';
import useVoiceRecorder from '../../components/chat/useVoiceRecorder';
import useChatUploadsController from './useChatUploadsController';

vi.mock('../../api/client', () => ({ chatAPI: { sendFiles: vi.fn() } }));
vi.mock('../../components/chat/useVoiceRecorder', () => ({ default: vi.fn(() => ({})) }));
beforeEach(() => vi.clearAllMocks());
function args(conversation) {
  const props = { activeConversationId: conversation, createOptimisticFileMessage: () => null };
  for (const key of ['notifyApiError', 'notifyWarning', 'applyOutgoingThreadMessage', 'cancelPendingInitialAnchor',
    'logChatDebug', 'revokeObjectUrls', 'setReplyMessage', 'buildReplyPreview']) props[key] = vi.fn();
  return props;
}
it('restores failed voice in its original chat and retries the same file with the same key', async () => {
  let reject;
  chatAPI.sendFiles.mockReturnValueOnce(new Promise((_, r) => { reject = r; })).mockResolvedValue({ id: 'sent' });
  const { result, rerender } = renderHook(({ conversation }) => useChatUploadsController(args(conversation)), {
    initialProps: { conversation: 'A' },
  });
  const file = new File(['voice'], 'voice.webm', { type: 'audio/webm' });
  const complete = useVoiceRecorder.mock.calls.at(-1)[0].onRecordingComplete;
  let pending;
  act(() => { pending = complete({ file, duration: 4, mimeType: 'audio/webm' }); });
  rerender({ conversation: 'B' });
  await act(async () => { reject(new Error('offline')); await pending; });
  expect(result.current.selectedFiles).toEqual([]);
  rerender({ conversation: 'A' });
  expect(result.current.selectedFiles).toEqual([file]);
  expect(result.current.fileDialogOpen).toBe(true);
  await act(async () => result.current.sendFiles());
  const [first, second] = chatAPI.sendFiles.mock.calls;
  expect(first[2].client_message_id).toEqual(expect.any(String));
  expect(second[0]).toBe('A');
  expect(second[1][0].file).toBe(file);
  expect(second[1][0].duration_seconds).toBe(4);
  expect(second[2].client_message_id).toBe(first[2].client_message_id);
});

it('retains two failed recordings without overwriting either', async () => {
  chatAPI.sendFiles.mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => useChatUploadsController(args('A')));
  const first = new File(['one'], 'one.webm', { type: 'audio/webm' });
  const second = new File(['two'], 'two.webm', { type: 'audio/webm' });
  const complete = useVoiceRecorder.mock.calls.at(-1)[0].onRecordingComplete;
  await act(async () => { await complete({ file: first }); await complete({ file: second }); });
  expect(result.current.selectedFiles).toEqual([first]);
  chatAPI.sendFiles.mockResolvedValue({ id: 'sent' });
  await act(async () => result.current.sendFiles());
  expect(result.current.selectedFiles).toEqual([second]);
  await act(async () => result.current.sendFiles());
  expect(result.current.selectedFiles).toEqual([]);
});
