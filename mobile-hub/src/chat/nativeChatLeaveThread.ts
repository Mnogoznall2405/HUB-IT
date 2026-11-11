import type { ChatMessage } from '../api/types';

/**
 * Leave-thread navigation must not wait for markConversationRead (OFF-02).
 * Mark-read is fire-and-forget; late completion must not navigate again.
 */
export function createNativeChatLeaveController(options: {
  navigateAway: () => void;
  markRead?: (messageId: string) => Promise<unknown>;
  offline?: boolean;
}) {
  let left = false;
  let navigationCount = 0;

  return {
    leave(latestIncoming: ChatMessage | null | undefined) {
      if (left) return { navigated: false, markReadStarted: false };
      left = true;
      navigationCount += 1;
      options.navigateAway();
      const messageId = String(latestIncoming?.id || '').trim();
      if (options.offline || !messageId || !options.markRead) {
        return { navigated: true, markReadStarted: false };
      }
      void options.markRead(messageId).catch(() => undefined);
      return { navigated: true, markReadStarted: true };
    },
    get navigationCount() {
      return navigationCount;
    },
  };
}
