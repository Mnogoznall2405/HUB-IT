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
  latestMessageTextRef,
  setMessageText,
}) {
  const syncComposerSelection = useCallback(() => {
    const input = composerRef.current;
    composerSelectionRef.current = {
      start: Number.isInteger(input?.selectionStart) ? input.selectionStart : null,
      end: Number.isInteger(input?.selectionEnd) ? input.selectionEnd : null,
    };
  }, [composerRef, composerSelectionRef]);

  // Текст читается из latestMessageTextRef, а не из замыкания на state:
  // ref обновляется синхронно в publish (useChatMessageTextState), поэтому
  // значение всегда свежее, а коллбэк остаётся стабильным между keystroke'ами.
  // Это критично для keep-alive дока эмодзи: нестабильный onInsertEmoji
  // ломал memo-цепочку dock → panel → picker и перерендеривал скрытую
  // панель на каждый ввод/отправку.
  const insertEmojiAtSelection = useCallback((emoji) => {
    const { start, end, currentValue } = resolveComposerSelectionRange({
      composerSelectionRef,
      composerRef,
      messageText: latestMessageTextRef?.current ?? composerRef.current?.value ?? '',
    });
    const nextValue = `${currentValue.slice(0, start)}${emoji}${currentValue.slice(end)}`;
    const nextPosition = start + emoji.length;
    setMessageText(nextValue);
    composerSelectionRef.current = { start: nextPosition, end: nextPosition };
    if (isMobile) return;
    // Панель остаётся открытой: последовательная вставка эмодзи как в Telegram.
    window.requestAnimationFrame(() => {
      composerRef.current?.focus?.();
      composerRef.current?.setSelectionRange?.(nextPosition, nextPosition);
    });
  }, [composerRef, composerSelectionRef, isMobile, latestMessageTextRef, setMessageText]);

  return {
    insertEmojiAtSelection,
    syncComposerSelection,
  };
}
