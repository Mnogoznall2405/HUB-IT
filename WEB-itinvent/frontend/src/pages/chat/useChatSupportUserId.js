import { useEffect, useState } from 'react';

import chatConfigAPI from '../../api/chatConfig';
import { CHAT_FEATURE_ENABLED } from '../../lib/chatFeature';

// Ответ /chat/config зависит от пользователя, поэтому кеш ключуется по его id и живёт до перезагрузки страницы.
const supportUserIdByViewer = new Map();

// Id пользователя техподдержки из GET /chat/config (0 — поддержки нет или это сам специалист).
// Пока user временно null (silent refresh), прежнее значение не сбрасывается — иначе строка мигает.
export default function useChatSupportUserId(userId) {
  const viewerId = Number(userId) || 0;
  const [supportUserId, setSupportUserId] = useState(() => supportUserIdByViewer.get(viewerId) || 0);

  useEffect(() => {
    if (!CHAT_FEATURE_ENABLED || !viewerId) return undefined;
    setSupportUserId(supportUserIdByViewer.get(viewerId) || 0);
    let cancelled = false;
    Promise.resolve(chatConfigAPI.getConfig())
      .then((config) => {
        const id = Number(config?.support_user_id || 0);
        const resolved = Number.isFinite(id) && id > 0 ? id : 0;
        supportUserIdByViewer.set(viewerId, resolved);
        if (!cancelled) setSupportUserId(resolved);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [viewerId]);

  return supportUserId;
}
