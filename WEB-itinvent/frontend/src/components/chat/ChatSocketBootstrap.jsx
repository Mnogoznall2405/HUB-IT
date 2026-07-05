import { useEffect } from 'react';

import { useAuth } from '../../contexts/AuthContext';
import { CHAT_FEATURE_ENABLED, CHAT_WS_ENABLED } from '../../lib/chatFeature';
import { chatSocket } from '../../lib/chatSocket';

export default function ChatSocketBootstrap() {
  const { user, hasPermission } = useAuth();
  const hasChatPermission = CHAT_FEATURE_ENABLED && Boolean(user) && hasPermission('chat.read');

  useEffect(() => {
    if (!hasChatPermission || !CHAT_WS_ENABLED) return undefined;
    const releaseSocket = chatSocket.retain();
    void chatSocket.subscribeInbox().catch(() => {});
    return () => {
      chatSocket.unsubscribeInbox();
      releaseSocket();
    };
  }, [hasChatPermission]);

  return null;
}
