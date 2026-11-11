import { useEffect, useState } from 'react';
import chatConversationDetailsAPI from '../../api/chatConversationDetails';

export default function useChatPanelMembers(conversation, open) {
  const [state, setState] = useState({ id: '', members: null, loading: false, error: '' });
  const [retryVersion, setRetryVersion] = useState(0);
  const id = conversation?.id;
  const source = conversation?.members;
  const incomplete = !Array.isArray(source) || source.length < Number(conversation?.member_count || 0);
  const eligible = conversation?.kind === 'group' || conversation?.kind === 'task';
  useEffect(() => {
    if (!open || !id || !eligible || !incomplete) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    setState({ id, members: null, loading: true, error: '' });
    chatConversationDetailsAPI.getConversation(id, { signal: controller.signal }).then((detail) => {
      if (!cancelled) setState({ id, members: Array.isArray(detail?.members) ? detail.members : [], loading: false, error: '' });
    }).catch((error) => {
      if (!cancelled) setState({ id, members: null, loading: false, error: error?.message || 'Не удалось загрузить участников.' });
    });
    return () => { cancelled = true; controller.abort(); };
  }, [id, eligible, incomplete, open, retryVersion]);
  return {
    ...state,
    members: !incomplete ? source : state.id === id ? state.members : null,
    loading: incomplete && state.id === id && state.loading,
    error: incomplete && state.id === id ? state.error : '',
    retry: () => setRetryVersion((value) => value + 1),
  };
}
