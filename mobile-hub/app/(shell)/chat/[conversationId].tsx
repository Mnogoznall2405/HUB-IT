import { Redirect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../../src/auth/AuthContext';
import { NATIVE_CHAT_ENABLED } from '../../../src/chat/nativeChatFeature';
import { NativeChatThreadScreen } from '../../../src/screens/chat/NativeChatThreadScreen';

export default function ShellChatConversationRoute() {
  const { user } = useAuth();
  const { conversationId, messageId } = useLocalSearchParams<{
    conversationId?: string | string[];
    messageId?: string | string[];
  }>();
  const id = Array.isArray(conversationId) ? conversationId[0] : conversationId;
  const focusMessageId = Array.isArray(messageId) ? messageId[0] : messageId;
  if (!NATIVE_CHAT_ENABLED) return <Redirect href="/(shell)/menu" />;
  if (!id) return <Redirect href="/(shell)/chat" />;
  // Invariant: the screen remounts per user+conversation. Thread hooks rely on
  // mountedRef alone to drop stale async work — removing this key would turn
  // every mountedRef-only guard into a cross-conversation race.
  return <NativeChatThreadScreen key={`${Number(user?.id || 0)}:${id}`} conversationId={id} messageId={focusMessageId} />;
}
