import { useRef } from 'react';

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

  stateRef.current.messageText = messageText;

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
  bridge.setMessageText = (next) => {
    stateRef.current.messageText = next;
    setMessageText(next);
    bridge.notify();
  };
  bridge.onComposerKeyDown = onComposerKeyDown;
  bridge.onComposerSelectionSync = onComposerSelectionSync;

  return bridge;
}
