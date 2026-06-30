import { useCallback, useEffect } from 'react';

import { chatAPI } from '../../api/client';
import { CHAT_FEATURE_ENABLED } from '../../lib/chatFeature';

export function resolveChatHealthErrorMessage(error, fallback = 'Не удалось проверить состояние chat backend.') {
  return String(error?.response?.data?.detail || fallback).trim() || fallback;
}

export default function useChatHealthBootstrap({
  setHealth,
  setHealthError,
}) {
  const loadHealth = useCallback(async () => {
    if (!CHAT_FEATURE_ENABLED) return;
    try {
      setHealth(await chatAPI.getHealth());
      setHealthError('');
    } catch (error) {
      setHealth(null);
      setHealthError(resolveChatHealthErrorMessage(error));
    }
  }, [setHealth, setHealthError]);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  return { loadHealth };
}
