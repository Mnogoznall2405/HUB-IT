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
  return <NativeChatThreadScreen key={`${Number(user?.id || 0)}:${id}`} conversationId={id} messageId={focusMessageId} />;
}
