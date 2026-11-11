import { useCallback } from 'react';

export function resolveComposerSelectionRange({
  composerSelectionRef,
  composerRef,
  messageText,
} = {}) {
  const input = composerRef?.current;
  const currentValue = String(messageText || '');
  const storedStart = composerSelectionRef?.current?.start;
  const storedEnd = composerSelectionRef?.current?.end;
  const start = Number.isInteger(storedStart)
    ? storedStart
    : (Number.isInteger(input?.selectionStart) ? input.selectionStart : currentValue.length);
  const end = Number.isInteger(storedEnd)
    ? storedEnd
    : (Number.isInteger(input?.selectionEnd) ? input.selectionEnd : start);
  return { start, end, currentValue };
}

export default function useChatComposerSelection({
  composerRef,
  composerSelectionRef,
  isMobile,
  messageText,
  setEmojiAnchorEl,
  setMessageText,
}) {
  const syncComposerSelection = useCallback(() => {
    const input = composerRef.current;
    composerSelectionRef.current = {
      start: Number.isInteger(input?.selectionStart) ? input.selectionStart : null,
      end: Number.isInteger(input?.selectionEnd) ? input.selectionEnd : null,
    };
  }, [composerRef, composerSelectionRef]);

  const insertEmojiAtSelection = useCallback((emoji) => {
    const { start, end, currentValue } = resolveComposerSelectionRange({
      composerSelectionRef,
      composerRef,
      messageText,
    });
    const nextValue = `${currentValue.slice(0, start)}${emoji}${currentValue.slice(end)}`;
    const nextPosition = start + emoji.length;
    setMessageText(nextValue);
    composerSelectionRef.current = { start: nextPosition, end: nextPosition };
    if (isMobile) return;
    setEmojiAnchorEl(null);
    window.requestAnimationFrame(() => {
      composerRef.current?.focus?.();
      composerRef.current?.setSelectionRange?.(nextPosition, nextPosition);
    });
  }, [composerRef, composerSelectionRef, isMobile, messageText, setEmojiAnchorEl, setMessageText]);

  return {
    insertEmojiAtSelection,
    syncComposerSelection,
  };
}
