import { useCallback } from 'react';

import { chatAPI } from '../../api/client';
import { getOrFetchSWR, peekSWRCache } from '../../lib/swrCache';
import { CHAT_FEATURE_ENABLED } from '../../lib/chatFeature';
import { buildChatThreadCacheKeyParts } from './chatCacheKeys';
import { CHAT_THREAD_BOOTSTRAP_LIMIT } from './chatThreadHistory';
import { buildThreadPrefetchQueue } from './chatThreadMessages';

export default function useChatThreadPrefetch({
  conversationsRef,
  threadPrefetchAbortControllersRef,
  userCacheId,
  staleTimeMs,
}) {
  const prefetchThreadBootstrap = useCallback(async (conversationId, { force = false } = {}) => {
    const id = String(conversationId || '').trim();
    if (!CHAT_FEATURE_ENABLED || !id) return null;
    const cacheKeyParts = buildChatThreadCacheKeyParts(userCacheId, id);
    if (!force) {
      const cachedEntry = peekSWRCache(cacheKeyParts, { staleTimeMs });
      if (cachedEntry?.data) return cachedEntry.data;
    }

    const existingController = threadPrefetchAbortControllersRef.current.get(id);
    if (existingController) return null;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    if (controller) {
      threadPrefetchAbortControllersRef.current.set(id, controller);
    }

    try {
      const result = await getOrFetchSWR(
        cacheKeyParts,
        () => (typeof chatAPI.getThreadBootstrap === 'function'
          ? chatAPI.getThreadBootstrap(
              id,
              { limit: CHAT_THREAD_BOOTSTRAP_LIMIT, lightweight: 1 },
              { signal: controller?.signal },
            )
          : chatAPI.getMessages(
              id,
              { limit: CHAT_THREAD_BOOTSTRAP_LIMIT },
              { signal: controller?.signal },
            )),
        {
          staleTimeMs,
          force,
          revalidateStale: false,
        },
      );
      return result?.data || null;
    } catch {
      return null;
    } finally {
      if (controller) {
        threadPrefetchAbortControllersRef.current.delete(id);
      }
    }
  }, [staleTimeMs, threadPrefetchAbortControllersRef, userCacheId]);

  const prefetchAdjacentThreadBootstraps = useCallback((activeConversationId) => {
    const normalizedConversationId = String(activeConversationId || '').trim();
    if (!normalizedConversationId) return;
    const conversations = conversationsRef?.current;
    const queue = buildThreadPrefetchQueue(conversations, normalizedConversationId, { limit: 6 });
    if (!queue.length) return;

    const run = () => {
      queue.forEach((conversationId) => {
        void prefetchThreadBootstrap(conversationId);
      });
    };

    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: 2000 });
    } else {
      window.setTimeout(run, 0);
    }
  }, [conversationsRef, prefetchThreadBootstrap]);

  return { prefetchAdjacentThreadBootstraps, prefetchThreadBootstrap };
}
