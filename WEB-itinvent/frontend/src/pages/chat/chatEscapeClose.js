export function hasChatBlockingOverlay(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc?.querySelectorAll) return false;
  const modals = doc.querySelectorAll('.MuiModal-root');
  for (let index = 0; index < modals.length; index += 1) {
    const modal = modals[index];
    if (modal.getAttribute('aria-hidden') === 'true') continue;
    return true;
  }
  return false;
}

/**
 * Resolve Escape handling for the chat page.
 * Priority: emoji → selection → side panels → close open thread.
 */
export function resolveChatEscapeAction({
  hasBlockingOverlay = false,
  emojiPickerOpen = false,
  hasSelectedMessages = false,
  contextPanelOpen = false,
  taskPanelOpen = false,
  infoOpen = false,
  hasActiveConversation = false,
  isMobile = false,
  mobileThreadOpen = false,
} = {}) {
  if (hasBlockingOverlay) return null;
  if (emojiPickerOpen) return 'close-emoji';
  if (hasSelectedMessages) return 'clear-selection';
  if (contextPanelOpen || taskPanelOpen || infoOpen) return 'close-panels';
  if (isMobile && mobileThreadOpen) return 'close-mobile-thread';
  if (hasActiveConversation) return 'close-desktop-thread';
  return null;
}
