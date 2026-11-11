import { useEffect } from 'react';
import CallRoundedIcon from '@mui/icons-material/CallRounded';
import VideocamRoundedIcon from '@mui/icons-material/VideocamRounded';

import { useChatCalls } from './ChatCallsContext';

// Header actions of an open conversation. `ActionComponent` is the header's own
// icon-button (HeaderAction) so the buttons match the rest of the toolbar.
export default function ConversationCallButtons({
  conversation,
  ActionComponent,
  compactMobile = false,
  density,
}) {
  const {
    enabled,
    session,
    knownCalls,
    startCall,
    joinCall,
    refreshActiveCall,
  } = useChatCalls();
  const conversationId = String(conversation?.id || '').trim();
  const kind = String(conversation?.kind || '').trim();
  // A call needs someone on the other side: not with the AI assistant and not in the personal notes chat.
  const available = enabled && Boolean(conversationId) && kind !== 'ai' && kind !== 'notes';

  useEffect(() => {
    if (available) refreshActiveCall(conversationId);
  }, [available, conversationId, refreshActiveCall]);

  if (!available || !ActionComponent) return null;

  const common = { compactMobile, density };
  const inThisConversation = session && String(session.conversationId || '') === conversationId;
  const activeCall = knownCalls[conversationId];

  if (activeCall && !session) {
    return (
      <ActionComponent
        {...common}
        title="Присоединиться к звонку"
        active
        onClick={() => { void joinCall(activeCall, activeCall.media); }}
      >
        <CallRoundedIcon fontSize="small" />
      </ActionComponent>
    );
  }

  const disabled = Boolean(session);
  const hint = inThisConversation ? 'Звонок уже идёт' : 'Сначала завершите текущий звонок';
  return (
    <>
      <ActionComponent
        {...common}
        title={disabled ? hint : 'Аудиозвонок'}
        disabled={disabled}
        onClick={() => { void startCall(conversationId, 'audio'); }}
      >
        <CallRoundedIcon fontSize="small" />
      </ActionComponent>
      <ActionComponent
        {...common}
        title={disabled ? hint : 'Видеозвонок'}
        disabled={disabled}
        onClick={() => { void startCall(conversationId, 'video'); }}
      >
        <VideocamRoundedIcon fontSize="small" />
      </ActionComponent>
    </>
  );
}
