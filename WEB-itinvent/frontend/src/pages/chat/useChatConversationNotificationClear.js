import { useEffect } from 'react';

import { clearChatConversationNotifications } from '../../lib/chatNotificationClear';
import { DESKTOP_WINDOW_STATE_CHANGED_EVENT, getDesktopWindowForeground } from '../../lib/desktopBridge';

// Same "user actually sees the thread" surface as read receipts
// (useReadReceipts): visible document and focused window / desktop foreground.
const isChatSurfaceActive = () => typeof document !== 'undefined'
  && document.visibilityState === 'visible'
  && (getDesktopWindowForeground() ?? document.hasFocus());

/**
 * Clears system notifications of the open conversation when it becomes
 * visible to the user: on opening the chat and on returning to the tab/window
 * with this chat already open.
 */
export default function useChatConversationNotificationClear({
  conversationId,
  taskId = '',
  threadVisible = true,
}) {
  const normalizedConversationId = String(conversationId || '').trim();
  const normalizedTaskId = String(taskId || '').trim();

  useEffect(() => {
    if (!normalizedConversationId || !threadVisible) return undefined;
    const clearIfVisible = () => {
      if (!isChatSurfaceActive()) return;
      clearChatConversationNotifications(normalizedConversationId, { taskId: normalizedTaskId });
    };
    clearIfVisible();
    document.addEventListener('visibilitychange', clearIfVisible);
    window.addEventListener('focus', clearIfVisible);
    window.addEventListener(DESKTOP_WINDOW_STATE_CHANGED_EVENT, clearIfVisible);
    return () => {
      document.removeEventListener('visibilitychange', clearIfVisible);
      window.removeEventListener('focus', clearIfVisible);
      window.removeEventListener(DESKTOP_WINDOW_STATE_CHANGED_EVENT, clearIfVisible);
    };
  }, [normalizedConversationId, normalizedTaskId, threadVisible]);
}
