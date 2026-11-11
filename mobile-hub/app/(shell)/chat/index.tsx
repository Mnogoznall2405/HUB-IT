import { Redirect, useLocalSearchParams } from 'expo-router';
import { NATIVE_CHAT_ENABLED } from '../../../src/chat/nativeChatFeature';
import type { ChatWorkspaceKey } from '../../../src/chat/chatAiWorkspace';
import { NativeChatInboxScreen } from '../../../src/screens/chat/NativeChatInboxScreen';

export default function ShellChatRoute() {
  const { workspace } = useLocalSearchParams<{ workspace?: string | string[] }>();
  const requested = Array.isArray(workspace) ? workspace[0] : workspace;
  const requestedWorkspace: ChatWorkspaceKey | undefined =
    requested === 'ai' || requested === 'chats' ? requested : undefined;
  if (!NATIVE_CHAT_ENABLED) {
    return <Redirect href="/(shell)/menu" />;
  }
  return <NativeChatInboxScreen requestedWorkspace={requestedWorkspace} />;
}
