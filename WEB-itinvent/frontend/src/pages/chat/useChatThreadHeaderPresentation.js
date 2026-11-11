import { useMemo } from 'react';

import { getConversationHeaderSubtitle } from '../../components/chat/chatHelpers';

export function resolveConversationHeaderSubtitle({
  typingUsers,
  activeConversation,
  aiStatus,
} = {}) {
  if (Array.isArray(typingUsers) && typingUsers.length > 0) {
    return `${typingUsers.join(', ')} печатает...`;
  }
  return getConversationHeaderSubtitle(activeConversation, aiStatus);
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
  activeAiStatus,
  activeAiStatusDisplay,
  typingLine,
  typingUsers,
}) {
  const conversationHeaderSubtitle = useMemo(
    () => resolveConversationHeaderSubtitle({ typingUsers, activeConversation, aiStatus: activeAiStatus }),
    [activeAiStatus, activeConversation, typingUsers],
  );

  const conversationMetaSubtitle = useMemo(
    () => getConversationHeaderSubtitle(activeConversation, activeAiStatus),
    [activeAiStatus, activeConversation],
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
