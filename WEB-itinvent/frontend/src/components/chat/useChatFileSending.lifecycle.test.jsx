import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { chatAPI } from '../../api/client';
import { prepareChatUploadFile, prepareChatUploadFiles } from './chatUploadPrep';
import useChatFileSending from './useChatFileSending';

vi.mock('../../api/client', () => ({ chatAPI: { sendFiles: vi.fn() } }));
vi.mock('./chatUploadPrep', () => ({
  buildChatUploadSignature: (file) => file.name,
  isChatMediaFile: () => false,
  prepareChatUploadFile: vi.fn(), prepareChatUploadFiles: vi.fn(),
}));
const file = new File(['bytes'], 'sample.txt');
function useHarness(conversation) {
  const [items, setItems] = useState([{ file, originalFile: file }]);
  const [reply, setReply] = useState({ id: 'quoted' });
  const [sending, setSending] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const args = {
    activeConversationId: conversation, selectedUploadItems: items, selectedFiles: items.map(i => i.file),
    replyMessage: reply, sendingFiles: sending, preparingFiles: preparing,
    setSelectedUploadItems: setItems, setReplyMessage: setReply,
    setSendingFiles: setSending, setPreparingFiles: setPreparing,
    fileCaption: 'caption', fileUploadAbortRef: { current: null },
    createOptimisticFileMessage: () => null, buildReplyPreview: () => null,
  };
  for (const key of ['setFileCaption', 'setFileDialogOpen', 'setSendMediaAsFiles', 'setFileUploadProgress',
    'notifyApiError', 'notifyWarning', 'revokeObjectUrls', 'cancelPendingInitialAnchor',
    'logChatDebug', 'applyOutgoingThreadMessage']) args[key] = vi.fn();
  return { ...useChatFileSending(args), items, reply, setReply, preparing };
}
beforeEach(() => vi.resetAllMocks());

it.each([false, true])('retains reply on retry and preserves newer choice=%s', async (newer) => {
  let reject;
  chatAPI.sendFiles.mockReturnValueOnce(new Promise((_, r) => { reject = r; })).mockResolvedValue({ id: 'ok' });
  const { result } = renderHook(() => useHarness('A'));
  let pending;
  act(() => { pending = result.current.sendFiles(); });
  if (newer) act(() => result.current.setReply({ id: 'newer' }));
  await act(async () => { reject(new Error('network')); await pending; });
  await act(async () => result.current.sendFiles());
  expect(chatAPI.sendFiles.mock.calls[1][2].reply_to_message_id).toBe(newer ? 'newer' : 'quoted');
  expect(chatAPI.sendFiles.mock.calls[1][2].uploadAttempt).toBe(chatAPI.sendFiles.mock.calls[0][2].uploadAttempt);
});

it.each(['queue', 'edit', 'reset'])('discards late %s preparation after A-B-A', async (operation) => {
  let resolve;
  const deferred = new Promise(r => { resolve = r; });
  prepareChatUploadFiles.mockReturnValue(deferred);
  prepareChatUploadFile.mockReturnValue(deferred);
  const { result, rerender } = renderHook(({ conversation }) => useHarness(conversation), {
    initialProps: { conversation: 'A' },
  });
  const original = result.current.items;
  let pending;
  act(() => {
    pending = operation === 'queue' ? result.current.queueSelectedFiles([new File(['new'], 'new.txt')])
      : operation === 'edit' ? result.current.applySelectedImageEdit(0, { file })
        : result.current.resetSelectedImageEdit(0);
  });
  rerender({ conversation: 'B' });
  rerender({ conversation: 'A' });
  await act(async () => { resolve(operation === 'queue' ? { items: [{ file }] } : { file }); await pending; });
  expect(await pending).toBe(false);
  expect(result.current.items).toBe(original);
  expect(result.current.preparing).toBe(false);
});

it('discards preparation after unmount', async () => {
  let resolve;
  prepareChatUploadFiles.mockReturnValue(new Promise(r => { resolve = r; }));
  const { result, unmount } = renderHook(() => useHarness('A'));
  let pending;
  act(() => { pending = result.current.queueSelectedFiles([new File(['new'], 'new.txt')]); });
  unmount();
  resolve({ items: [{ file }] });
  expect(await pending).toBe(false);
});
