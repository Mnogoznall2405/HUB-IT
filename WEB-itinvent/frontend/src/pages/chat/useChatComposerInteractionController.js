import { useCallback } from 'react';

export default function useChatComposerInteractionController({
  focusComposer,
  handleComposerSend,
  setEditingMessage,
  setMessageText,
  setReplyMessage,
}) {
  const handleComposerKeyDown = useCallback((event) => {
    if (
      event.key !== 'Enter'
      || event.shiftKey
      || event.nativeEvent?.isComposing
      || event.repeat
    ) {
      return;
    }
    event.preventDefault();
    void handleComposerSend();
  }, [handleComposerSend]);

  const clearReplyMessage = useCallback(() => {
    setReplyMessage(null);
    focusComposer();
  }, [focusComposer, setReplyMessage]);

  const clearEditingMessage = useCallback(() => {
    setEditingMessage(null);
    setMessageText('');
    focusComposer();
  }, [focusComposer, setEditingMessage, setMessageText]);

  return {
    clearEditingMessage,
    clearReplyMessage,
    handleComposerKeyDown,
  };
}
