import { useSyncExternalStore } from 'react';

import ChatComposer from './ChatComposer';

export default function ChatThreadComposerBridge({ bridge, composerProps }) {
  const messageText = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot);
  return (
    <ChatComposer
      {...composerProps}
      messageText={messageText}
      onMessageTextChange={bridge.setMessageText}
      onComposerKeyDown={bridge.onComposerKeyDown}
      onComposerSelectionSync={bridge.onComposerSelectionSync}
    />
  );
}
