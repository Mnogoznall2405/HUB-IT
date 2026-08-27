import { Redirect } from 'expo-router';
import { NATIVE_CHAT_ENABLED } from '../../../src/chat/nativeChatFeature';
import { NativeChatInboxScreen } from '../../../src/screens/chat/NativeChatInboxScreen';

export default function ShellChatRoute() {
  if (!NATIVE_CHAT_ENABLED) {
    return <Redirect href="/(shell)/menu" />;
  }
  return <NativeChatInboxScreen />;
}
