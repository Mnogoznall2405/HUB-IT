import { useCallback, useMemo } from 'react';

export default function useChatComposerUiController({
  composerRef,
  emojiAnchorEl,
  focusComposer,
  isMobile,
  loadChatDialogsModule,
  setComposerMenuAnchor,
  setEmojiAnchorEl,
  setThreadMenuAnchor,
  syncComposerSelection,
}) {
  const emojiPickerOpen = useMemo(() => Boolean(emojiAnchorEl), [emojiAnchorEl]);

  const handleOpenMenu = useCallback((event) => {
    void loadChatDialogsModule();
    setThreadMenuAnchor(event.currentTarget);
  }, [loadChatDialogsModule, setThreadMenuAnchor]);

  const handleOpenComposerMenu = useCallback((event) => {
    void loadChatDialogsModule();
    setComposerMenuAnchor(event.currentTarget);
    if (isMobile) focusComposer({ forceMobile: true });
  }, [focusComposer, isMobile, loadChatDialogsModule, setComposerMenuAnchor]);

  const handleOpenEmojiPicker = useCallback((event) => {
    void loadChatDialogsModule();
    syncComposerSelection();
    if (isMobile) {
      composerRef.current?.blur?.();
    }
    setEmojiAnchorEl(event.currentTarget);
  }, [composerRef, isMobile, loadChatDialogsModule, setEmojiAnchorEl, syncComposerSelection]);

  const handleCloseEmojiPicker = useCallback(() => {
    setEmojiAnchorEl(null);
    window.requestAnimationFrame(() => {
      composerRef.current?.focus?.();
    });
  }, [composerRef, setEmojiAnchorEl]);

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
    handleComposerFocusChange,
  };
}
