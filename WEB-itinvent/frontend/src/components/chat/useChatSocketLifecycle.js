import { useEffect } from 'react';

import { CHAT_FEATURE_ENABLED, CHAT_WS_ENABLED } from '../../lib/chatFeature';
import { chatSocket } from '../../lib/chatSocket';

export default function useChatSocketLifecycle({
  watchedPresenceUserIds,
  watchedPresenceUserIdsKey,
}) {
  useEffect(() => {
    if (!CHAT_FEATURE_ENABLED || !CHAT_WS_ENABLED) return undefined;
    const releaseSocket = chatSocket.retain();
    return () => {
      releaseSocket();
    };
  }, []);

  useEffect(() => {
    if (!CHAT_FEATURE_ENABLED || !CHAT_WS_ENABLED) return undefined;
    if (typeof chatSocket.subscribeInbox !== 'function') return undefined;
    Promise.resolve(chatSocket.subscribeInbox()).catch(() => {});
    return () => {
      chatSocket.unsubscribeInbox?.();
    };
  }, []);

  useEffect(() => {
    if (!CHAT_FEATURE_ENABLED || !CHAT_WS_ENABLED) return undefined;
    if (typeof chatSocket.watchPresence !== 'function') return undefined;
    Promise.resolve(chatSocket.watchPresence(watchedPresenceUserIds)).catch(() => {});
    return undefined;
  }, [watchedPresenceUserIds, watchedPresenceUserIdsKey]);
}
