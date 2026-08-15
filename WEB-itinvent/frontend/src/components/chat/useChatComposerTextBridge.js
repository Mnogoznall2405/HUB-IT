import { startTransition, useRef } from 'react';

/**
 * Stable ref-backed store so ChatThread pane memo does not depend on messageText.
 * Only the composer subtree subscribes via useSyncExternalStore.
 */
export default function useChatComposerTextBridge({
  messageText,
  setMessageText,
  onComposerKeyDown,
  onComposerSelectionSync,
}) {
  const stateRef = useRef({ messageText: '', listeners: new Set() });
  const bridgeRef = useRef(null);

  const hasExternalStore = typeof setMessageText?.subscribe === 'function'
    && typeof setMessageText?.getSnapshot === 'function'
    && typeof setMessageText?.deferred === 'function';

  if (!hasExternalStore) {
    stateRef.current.messageText = messageText;
  }

  if (!bridgeRef.current) {
    bridgeRef.current = {
      subscribe(listener) {
        stateRef.current.listeners.add(listener);
        return () => stateRef.current.listeners.delete(listener);
      },
      getSnapshot() {
        return stateRef.current.messageText;
      },
      notify() {
        stateRef.current.listeners.forEach((listener) => listener());
      },
      setMessageText() {},
      onComposerKeyDown: null,
      onComposerSelectionSync: null,
    };
  }

  const bridge = bridgeRef.current;
  bridge.subscribe = hasExternalStore
    ? setMessageText.subscribe
    : (listener) => {
        stateRef.current.listeners.add(listener);
        return () => stateRef.current.listeners.delete(listener);
      };
  bridge.getSnapshot = hasExternalStore
    ? setMessageText.getSnapshot
    : () => stateRef.current.messageText;
  bridge.setMessageText = (next) => {
    if (hasExternalStore) {
      setMessageText.deferred(next);
      return;
    }
    stateRef.current.messageText = next;
    bridge.notify();
    startTransition(() => setMessageText(next));
  };
  bridge.onComposerKeyDown = onComposerKeyDown;
  bridge.onComposerSelectionSync = onComposerSelectionSync;

  return bridge;
}
