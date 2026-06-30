import { useMemo } from 'react';

import { getConversationHeaderSubtitle } from '../../components/chat/chatHelpers';

export function resolveConversationHeaderSubtitle({
  typingUsers,
  activeConversation,
} = {}) {
  if (Array.isArray(typingUsers) && typingUsers.length > 0) {
    return `${typingUsers.join(', ')} печатает...`;
  }
  return getConversationHeaderSubtitle(activeConversation);
}

export function resolveAiAwareTypingLine({
  activeConversationKind,
  activeAiStatusDisplay,
  typingLine,
} = {}) {
  if (String(activeConversationKind || '').trim() === 'ai' && activeAiStatusDisplay?.visible) {
    return activeAiStatusDisplay.primaryText;
  }
  return typingLine;
}

export default function useChatThreadHeaderPresentation({
  activeConversation,
  activeAiStatusDisplay,
  typingLine,
  typingUsers,
}) {
  const conversationHeaderSubtitle = useMemo(
    () => resolveConversationHeaderSubtitle({ typingUsers, activeConversation }),
    [activeConversation, typingUsers],
  );

  const conversationMetaSubtitle = useMemo(
    () => getConversationHeaderSubtitle(activeConversation),
    [activeConversation],
  );

  const aiAwareTypingLine = useMemo(
    () => resolveAiAwareTypingLine({
      activeConversationKind: activeConversation?.kind,
      activeAiStatusDisplay,
      typingLine,
    }),
    [activeAiStatusDisplay, activeConversation?.kind, typingLine],
  );

  return {
    aiAwareTypingLine,
    conversationHeaderSubtitle,
    conversationMetaSubtitle,
  };
}
