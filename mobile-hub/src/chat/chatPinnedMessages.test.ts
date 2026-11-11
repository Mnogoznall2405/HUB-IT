import * as SecureStore from 'expo-secure-store';
import { getPinnedChatMessageId, setPinnedChatMessageId } from './chatPinnedMessages';

describe('native pinned Chat messages', () => {
  it('keeps one local web-compatible pin per user and conversation', async () => {
    await setPinnedChatMessageId(1, 'conversation-1', 'message-1');
    await setPinnedChatMessageId(1, 'conversation-2', 'message-2');

    await expect(getPinnedChatMessageId(1, 'conversation-1')).resolves.toBe('message-1');
    await expect(getPinnedChatMessageId(1, 'conversation-2')).resolves.toBe('message-2');
  });

  it('removes the storage key when the last pin is cleared', async () => {
    await setPinnedChatMessageId(1, 'conversation-1', 'message-1');
    await setPinnedChatMessageId(1, 'conversation-1', null);

    await expect(getPinnedChatMessageId(1, 'conversation-1')).resolves.toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('hubit_native_chat_pinned_messages_v1');
  });
});
