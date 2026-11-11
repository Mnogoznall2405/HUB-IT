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
        const title = String(preview?.title || 'без названия').trim();
        if (preview?.already_member && preview?.conversation_id) {
          conversation = await chatAPI.getConversation(preview.conversation_id);
        } else if (preview?.requires_approval && preview?.request_status === 'pending') {
          callbacksRef.current.notifyInfo?.(
            `Заявка в беседу «${title}» уже отправлена: дождитесь решения владельца или модератора.`,
            { title: 'Беседа' },
          );
        } else {
          const requiresApproval = Boolean(preview?.requires_approval);
          const confirmed = await callbacksRef.current.confirmDialog?.({
            title: requiresApproval ? `Отправить заявку в беседу «${title}»?` : `Вступить в беседу «${title}»?`,
            message: requiresApproval
              ? `Участников: ${Number(preview?.member_count || 0)}. Войти можно после одобрения владельца или модератора.`
              : `Участников: ${Number(preview?.member_count || 0)}. Вы увидите историю беседы.`,
            confirmLabel: requiresApproval ? 'Отправить заявку' : 'Вступить',
          });
          if (!confirmed) return;
          const joined = await chatAPI.joinGroupByInvite(token);
          conversation = joined?.conversation || null;
          if (joined?.joined) callbacksRef.current.notifyInfo?.('Вы вступили в беседу.', { title: 'Беседа' });
          if (joined?.requested) {
            callbacksRef.current.notifyInfo?.(
              'Заявка отправлена. Беседа появится в списке, когда её одобрят.',
              { title: 'Беседа' },
            );
          }
        }
        if (conversation?.id) callbacksRef.current.onJoined?.(conversation);
      } catch (error) {
        callbacksRef.current.notifyApiError?.(error, 'Ссылка-приглашение недействительна или устарела.');
      }
    })();
  }, [locationPathname, locationSearch]);
}
