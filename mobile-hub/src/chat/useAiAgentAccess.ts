import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getAiConversationAccess } from '../api/chatApi';

export function useAiAgentAccess(conversationId: string, isAi: boolean, userId: number | undefined, offline: boolean) {
  const key = `${userId}:${conversationId}:${offline}`;
  const currentKey = useRef(key);
  currentKey.current = key;
  const [state, setState] = useState({ key: '', allowed: false, error: false });
  useFocusEffect(useCallback(() => {
    if (!isAi || !conversationId || offline) return;
    let active = true;
    let pending = false;
    let generation = 0;
    const refresh = async () => {
      if (pending || (AppState.currentState && AppState.currentState !== 'active')) return;
      pending = true;
      const request = generation;
      const current = () => active && currentKey.current === key && request === generation;
      try {
        const result = await getAiConversationAccess(conversationId);
        if (current()) setState({ key, allowed: result.can_use === true, error: false });
      } catch {
        if (current()) setState({ key, allowed: false, error: true });
      } finally {
        if (request === generation) pending = false;
      }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 15000);
    const subscription = AppState.addEventListener('change', (next) => {
      generation += 1;
      pending = false;
      if (next === 'active') void refresh();
    });
    return () => { active = false; clearInterval(timer); subscription.remove(); };
  }, [conversationId, isAi, key, offline]));
  if (!isAi) return { allowed: true, loading: false, error: false };
  return {
    allowed: !offline && state.key === key && state.allowed,
    loading: !offline && state.key !== key,
    error: state.key === key && state.error,
  };
}
