import { useCallback, useMemo } from 'react';

export default function useChatComposerUiController({
  composerRef,
  emojiAnchorEl,
  focusComposer,
  handleComposerSend,
  isMobile,
  loadChatDialogsModule,
  queueSelectedFiles,
  setComposerMenuAnchor,
  setEmojiAnchorEl,
  setMessageText,
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

  const handleSendGif = useCallback(async (gif) => {
    if (!gif?.fullUrl) return;
    try {
      const resp = await fetch(gif.fullUrl);
      const blob = await resp.blob();
      const name = (gif.title || 'animation').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) + '.gif';
      const file = new File([blob], name, { type: 'image/gif' });
      setEmojiAnchorEl(null);
      await queueSelectedFiles([file]);
    } catch {
      setMessageText(gif.fullUrl);
      window.requestAnimationFrame(() => handleComposerSend());
    }
  }, [handleComposerSend, queueSelectedFiles, setEmojiAnchorEl, setMessageText]);

  return {
    emojiPickerOpen,
    handleOpenMenu,
    handleOpenComposerMenu,
    handleOpenEmojiPicker,
    handleCloseEmojiPicker,
    handleComposerFocusChange,
    handleSendGif,
  };
}
