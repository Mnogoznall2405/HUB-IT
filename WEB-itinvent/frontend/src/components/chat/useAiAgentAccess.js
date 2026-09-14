import { useEffect, useState } from 'react';
import { aiBotAccess } from '../../api/aiBotAccess';

export default function useAiAgentAccess(conversationId, isAi, userId) {
  const key = `${userId}:${conversationId}`;
  const [state, setState] = useState({ key: null, allowed: false, error: false });
  useEffect(() => {
    if (!isAi || !conversationId) return undefined;
    let active = true;
    let sequence = 0;
    const refresh = async () => {
      const request = ++sequence;
      try {
        const result = await aiBotAccess.conversation(conversationId);
        if (active && request === sequence) setState({ key, allowed: result.can_use === true, error: false });
      } catch {
        if (active && request === sequence) setState({ key, allowed: false, error: true });
      }
    };
    refresh();
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, 15000);
    window.addEventListener('focus', refresh);
    window.addEventListener('ai-agent-access-changed', refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('ai-agent-access-changed', refresh);
    };
  }, [conversationId, isAi, key]);
  if (!isAi) return { allowed: true, loading: false, error: false };
  return { allowed: state.key === key && state.allowed, loading: state.key !== key, error: state.key === key && state.error };
}
