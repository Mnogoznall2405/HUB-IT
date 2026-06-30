import { useEffect, useRef } from 'react';

import { chatAPI } from '../../api/client';
import { sortSidebarConversations } from '../../components/chat/chatHelpers';
import { CHAT_FEATURE_ENABLED } from '../../lib/chatFeature';

export default function useChatNotesConversationBootstrap({
  conversationsLoading,
  setConversations,
  upsertSearchConversation,
}) {
  const notesEnsuredRef = useRef(false);

  useEffect(() => {
    if (!CHAT_FEATURE_ENABLED || notesEnsuredRef.current || conversationsLoading) return;
    notesEnsuredRef.current = true;
    void chatAPI.ensureNotesConversation()
      .then((notes) => {
        const normalizedConversationId = String(notes?.id || '').trim();
        if (!normalizedConversationId) return;
        setConversations((current) => {
          const exists = current.some((item) => String(item?.id || '').trim() === normalizedConversationId);
          const next = exists
            ? current.map((item) => (
              String(item?.id || '').trim() === normalizedConversationId ? { ...item, ...notes } : item
            ))
            : [{ ...notes }, ...current];
          return sortSidebarConversations(next);
        });
        upsertSearchConversation(notes);
      })
      .catch(() => {
        notesEnsuredRef.current = false;
      });
  }, [conversationsLoading, setConversations, upsertSearchConversation]);
}
