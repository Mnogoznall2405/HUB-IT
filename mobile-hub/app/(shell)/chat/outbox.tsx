import { Redirect } from 'expo-router';
import { NATIVE_CHAT_ENABLED } from '../../../src/chat/nativeChatFeature';
import { NativeChatOutboxScreen } from '../../../src/screens/chat/NativeChatOutboxScreen';

export default function ChatOutboxRoute() {
  if (!NATIVE_CHAT_ENABLED) return <Redirect href="/(shell)/menu" />;
  return <NativeChatOutboxScreen />;
}
