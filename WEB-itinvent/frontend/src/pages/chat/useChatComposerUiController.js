import { useCallback, useEffect, useMemo, useRef } from 'react';

// Telegram Desktop: курсор над кнопкой смайла открывает лёгкое превью
// (popover над полем ввода), клик закрепляет панель справа. Паузы убирают
// мерцание при быстром движении мыши между кнопкой и панелью.
const EMOJI_PREVIEW_OPEN_DELAY_MS = 260;
const EMOJI_PREVIEW_CLOSE_DELAY_MS = 320;

// Общий ленивый чанк панели (ChatEmojiPanel грузится lazy в ChatThread,
// ChatComposer и ChatEmojiDock) — префетч на наведении убирает пустую
// вспышку контента при открытии превью.
const prefetchEmojiPanel = () => {
  void import('../../components/chat/ChatEmojiPanel');
};

export default function useChatComposerUiController({
  composerRef,
  emojiAnchorEl,
  emojiPanelMode = 'popover',
  focusComposer,
  isMobile,
  loadChatDialogsModule,
  setComposerMenuAnchor,
  setEmojiAnchorEl,
  setEmojiPanelMode,
  setThreadMenuAnchor,
  syncComposerSelection,
}) {
  const emojiPickerOpen = useMemo(() => Boolean(emojiAnchorEl), [emojiAnchorEl]);
  const previewOpenTimerRef = useRef(null);
  const previewCloseTimerRef = useRef(null);

  const clearPreviewTimers = useCallback(() => {
    if (previewOpenTimerRef.current !== null) {
      window.clearTimeout(previewOpenTimerRef.current);
      previewOpenTimerRef.current = null;
    }
    if (previewCloseTimerRef.current !== null) {
      window.clearTimeout(previewCloseTimerRef.current);
      previewCloseTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearPreviewTimers(), [clearPreviewTimers]);

  const handleOpenMenu = useCallback((event) => {
    void loadChatDialogsModule();
    setThreadMenuAnchor(event.currentTarget);
  }, [loadChatDialogsModule, setThreadMenuAnchor]);

  const handleOpenComposerMenu = useCallback((event) => {
    void loadChatDialogsModule();
    setComposerMenuAnchor(event.currentTarget);
    if (isMobile) focusComposer({ forceMobile: true });
  }, [focusComposer, isMobile, loadChatDialogsModule, setComposerMenuAnchor]);

  const handleCloseEmojiPicker = useCallback(() => {
    clearPreviewTimers();
    setEmojiAnchorEl(null);
    window.requestAnimationFrame(() => {
      composerRef.current?.focus?.();
    });
  }, [clearPreviewTimers, composerRef, setEmojiAnchorEl]);

  // Клик по кнопке смайла (desktop): preview → pin, pinned → close,
  // closed → pin. На мобильном клик переключает инлайн-панель.
  const handleOpenEmojiPicker = useCallback((event) => {
    void loadChatDialogsModule();
    syncComposerSelection();
    clearPreviewTimers();
    if (emojiPickerOpen && (isMobile || emojiPanelMode === 'pinned')) {
      handleCloseEmojiPicker();
      return;
    }
    if (isMobile) {
      composerRef.current?.blur?.();
      setEmojiPanelMode?.('popover');
    } else {
      setEmojiPanelMode?.('pinned');
    }
    setEmojiAnchorEl(event?.currentTarget || emojiAnchorEl || true);
  }, [
    clearPreviewTimers,
    composerRef,
    emojiAnchorEl,
    emojiPanelMode,
    emojiPickerOpen,
    handleCloseEmojiPicker,
    isMobile,
    loadChatDialogsModule,
    setEmojiAnchorEl,
    setEmojiPanelMode,
    syncComposerSelection,
  ]);

  // Навели на кнопку/панель: отменить закрытие; если закрыто — открыть
  // preview с задержкой. Уже открытая pinned-панель не реагирует.
  const handleEmojiHoverStart = useCallback((event) => {
    if (isMobile) return;
    prefetchEmojiPanel();
    if (previewCloseTimerRef.current !== null) {
      window.clearTimeout(previewCloseTimerRef.current);
      previewCloseTimerRef.current = null;
    }
    if (emojiPickerOpen || previewOpenTimerRef.current !== null) return;
    const anchorSource = event?.currentTarget || null;
    previewOpenTimerRef.current = window.setTimeout(() => {
      previewOpenTimerRef.current = null;
      void loadChatDialogsModule();
      syncComposerSelection();
      setEmojiPanelMode?.('popover');
      setEmojiAnchorEl(anchorSource || true);
    }, EMOJI_PREVIEW_OPEN_DELAY_MS);
  }, [
    emojiPickerOpen,
    isMobile,
    loadChatDialogsModule,
    setEmojiAnchorEl,
    setEmojiPanelMode,
    syncComposerSelection,
  ]);

  // Ушли с кнопки/панели: закрываем только временное preview, pinned остаётся.
  const handleEmojiHoverEnd = useCallback(() => {
    if (isMobile) return;
    if (previewOpenTimerRef.current !== null) {
      window.clearTimeout(previewOpenTimerRef.current);
      previewOpenTimerRef.current = null;
    }
    if (!emojiPickerOpen || emojiPanelMode !== 'popover') return;
    if (previewCloseTimerRef.current !== null) return;
    previewCloseTimerRef.current = window.setTimeout(() => {
      previewCloseTimerRef.current = null;
      setEmojiAnchorEl(null);
    }, EMOJI_PREVIEW_CLOSE_DELAY_MS);
  }, [emojiPanelMode, emojiPickerOpen, isMobile, setEmojiAnchorEl]);

  const handleComposerFocusChange = useCallback((focused) => {
    if (focused && isMobile && emojiAnchorEl) {
      setEmojiAnchorEl(null);
    }
  }, [emojiAnchorEl, isMobile, setEmojiAnchorEl]);

  return {
    emojiPickerOpen,
    handleOpenMenu,
    handleOpenComposerMenu,
    handleOpenEmojiPicker,
    handleCloseEmojiPicker,
    handleEmojiHoverStart,
    handleEmojiHoverEnd,
    handleComposerFocusChange,
  };
}
