import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { chatAPI } from '../../api/client';
import chatFoldersAPI from '../../api/chatFolders';
import useChatSelectedMessageActions from '../../components/chat/useChatSelectedMessageActions';
import useChatFolderMutationsController from './useChatFolderMutationsController';

vi.mock('../../api/client', () => ({ chatAPI: { deleteChatMessage: vi.fn() } }));
vi.mock('../../api/chatFolders', () => ({ default: { deleteFolder: vi.fn() } }));
afterEach(() => vi.restoreAllMocks());
it.each(['same-chat', 'other-chat', 'unmount'])('keeps newer selection after delete: %s', async (mode) => {
  let resolve;
  chatAPI.deleteChatMessage.mockReturnValue(new Promise(r => { resolve = r; }));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const active = { current: 'A' };
  const clear = vi.fn();
  const { result, rerender, unmount } = renderHook(({ selected }) => useChatSelectedMessageActions({
    activeConversationIdRef: active, selectedMessages: selected, conversationKind: 'direct',
    clearSelectedMessages: clear,
  }), { initialProps: { selected: [{ id: 'one', conversation_id: 'A', is_own: true, kind: 'text' }] } });
  let pending;
  act(() => { pending = result.current.deleteSelectedMessages(); });
  if (mode === 'unmount') unmount();
  else {
    if (mode === 'other-chat') active.current = 'B';
    rerender({ selected: [{ id: 'two', conversation_id: active.current, is_own: true, kind: 'text' }] });
  }
  await act(async () => { resolve({ id: 'one' }); await pending; });
  expect(clear).not.toHaveBeenCalled();
});

it.each([false, true])('changes folder only if deleted folder is still selected, switched=%s', async (switched) => {
  let resolve;
  chatFoldersAPI.deleteFolder.mockReturnValue(new Promise(r => { resolve = r; }));
  const change = vi.fn();
  const { result, rerender } = renderHook(({ filter }) => useChatFolderMutationsController({
    conversationFilter: filter, handleActiveFolderChange: change,
    setFolderSaving: vi.fn(), loadChatFolders: vi.fn(), notifyApiError: vi.fn(),
  }), { initialProps: { filter: 'folderA' } });
  let pending;
  act(() => { pending = result.current.handleDeleteChatFolder('folderA'); });
  if (switched) rerender({ filter: 'folderB' });
  await act(async () => { resolve(); await pending; });
  if (switched) expect(change).not.toHaveBeenCalled();
  else expect(change).toHaveBeenCalledWith('personal');
});
