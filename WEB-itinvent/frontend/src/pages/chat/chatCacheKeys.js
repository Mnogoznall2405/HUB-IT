export const buildChatConversationsCacheKeyParts = (userId) => ['chat', 'conversations', String(userId || 'guest')];
export const buildChatAiBotsCacheKeyParts = (userId) => ['chat', 'ai-bots', String(userId || 'guest')];
export const buildChatThreadCacheKeyParts = (userId, conversationId) => ['chat', 'thread', String(userId || 'guest'), String(conversationId || '').trim(), 'latest'];
export const buildChatLastConversationSessionKey = (userId) => `chat:last-conversation:${String(userId || 'guest')}`;
export const buildChatLastMobileViewSessionKey = (userId) => `chat:last-mobile-view:${String(userId || 'guest')}`;
