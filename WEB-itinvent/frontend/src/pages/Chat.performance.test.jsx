import { describe, expect, it } from 'vitest';

import {
  buildChatConversationsCacheKeyParts,
  buildChatLastConversationSessionKey,
  buildChatLastMobileViewSessionKey,
  buildChatThreadCacheKeyParts,
} from './Chat';

describe('Chat page cache helpers', () => {
  it('builds stable conversations and thread cache keys', () => {
    expect(buildChatConversationsCacheKeyParts(7)).toEqual(['chat', 'conversations', '7']);
    expect(buildChatConversationsCacheKeyParts()).toEqual(['chat', 'conversations', 'guest']);

    expect(buildChatThreadCacheKeyParts(7, 'conv-1')).toEqual([
      'chat',
      'thread',
      '7',
      'conv-1',
      'latest',
    ]);
    expect(buildChatThreadCacheKeyParts(null, ' conv-2 ')).toEqual([
      'chat',
      'thread',
      'guest',
      'conv-2',
      'latest',
    ]);
  });

  it('builds stable session storage keys for conversation restore and mobile view', () => {
    expect(buildChatLastConversationSessionKey(7)).toBe('chat:last-conversation:7');
    expect(buildChatLastConversationSessionKey()).toBe('chat:last-conversation:guest');

    expect(buildChatLastMobileViewSessionKey(7)).toBe('chat:last-mobile-view:7');
    expect(buildChatLastMobileViewSessionKey()).toBe('chat:last-mobile-view:guest');
  });
});
