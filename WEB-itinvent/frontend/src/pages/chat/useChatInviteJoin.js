import { useEffect, useRef } from 'react';

import { chatAPI } from '../../api/client';

// Opens a group from an invite link (/chat?join=<token>): previews it, asks once, joins and
// opens the conversation. The token is dropped from the URL before anything else happens.
export default function useChatInviteJoin({
  locationPathname,
  locationSearch,
  navigate,
  confirmDialog,
  notifyApiError,
  notifyInfo,
  onJoined,
}) {
  const handledTokenRef = useRef('');
  // Latest callbacks live in a ref so a re-render never aborts a join that is already in flight.
  const callbacksRef = useRef({});
  callbacksRef.current = { navigate, confirmDialog, notifyApiError, notifyInfo, onJoined };

  useEffect(() => {
    const params = new URLSearchParams(locationSearch || '');
    const token = String(params.get('join') || '').trim();
    if (!token || handledTokenRef.current === token) return;
    handledTokenRef.current = token;

    params.delete('join');
    const search = params.toString();
    callbacksRef.current.navigate?.(`${locationPathname}${search ? `?${search}` : ''}`, { replace: true });

    (async () => {
      try {
        const preview = await chatAPI.previewGroupInvite(token);
        let conversation = null;
        if (preview?.already_member && preview?.conversation_id) {
          conversation = await chatAPI.getConversation(preview.conversation_id);
        } else {
          const confirmed = await callbacksRef.current.confirmDialog?.({
            title: `Вступить в беседу «${String(preview?.title || 'без названия').trim()}»?`,
            message: `Участников: ${Number(preview?.member_count || 0)}. Вы увидите историю беседы.`,
            confirmLabel: 'Вступить',
          });
          if (!confirmed) return;
          const joined = await chatAPI.joinGroupByInvite(token);
          conversation = joined?.conversation || null;
          if (joined?.joined) callbacksRef.current.notifyInfo?.('Вы вступили в беседу.', { title: 'Беседа' });
        }
        if (conversation?.id) callbacksRef.current.onJoined?.(conversation);
      } catch (error) {
        callbacksRef.current.notifyApiError?.(error, 'Ссылка-приглашение недействительна или устарела.');
      }
    })();
  }, [locationPathname, locationSearch]);
}
