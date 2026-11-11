export const MAIL_MOVE_UNDO_DURATION_MS = 5000;
export const MAIL_MOVE_UNDO_ACTION_LABEL = 'Отменить';

export function buildMailMoveUndoMessage({ count = 1, folderLabel = '' } = {}) {
  const n = Math.max(1, Number(count) || 1);
  const name = String(folderLabel || '').trim() || 'папку';
  if (n > 1) return `${n} писем перемещено в «${name}»`;
  return `Письмо перемещено в «${name}»`;
}

export function buildMailMoveRestoredMessage({ count = 1 } = {}) {
  const n = Math.max(1, Number(count) || 1);
  return n > 1 ? 'Перемещение писем отменено.' : 'Перемещение письма отменено.';
}

export function createMailMoveUndoNotifier({
  notifySuccess,
  mailAPI,
  withActiveMailboxPayload,
  afterUndo,
  handleMailCredentialsRequired,
  getMailErrorDetail,
  onError,
} = {}) {
  let restoring = false;

  return function notifyRecoverableMove({
    messageIds = [],
    restoreFolder = 'inbox',
    folderLabel = '',
    count,
  } = {}) {
    const ids = (Array.isArray(messageIds) ? messageIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    const n = Math.max(ids.length, Number(count) || 0, 1);
    const targetFolder = String(restoreFolder || 'inbox');
    const options = {
      durationMs: MAIL_MOVE_UNDO_DURATION_MS,
    };
    if (ids.length > 0 && targetFolder) {
      options.actionLabel = MAIL_MOVE_UNDO_ACTION_LABEL;
      options.onAction = async () => {
        if (restoring) return;
        restoring = true;
        try {
          for (const id of ids) {
            await mailAPI?.moveMessage?.(
              id,
              withActiveMailboxPayload?.({ target_folder: targetFolder }) || { target_folder: targetFolder },
            );
          }
          await afterUndo?.();
          notifySuccess?.(buildMailMoveRestoredMessage({ count: ids.length }));
        } catch (requestError) {
          const fallback = 'Не удалось отменить перемещение.';
          if (!(await handleMailCredentialsRequired?.(requestError, fallback))) {
            onError?.(getMailErrorDetail?.(requestError, fallback) || fallback);
          }
        } finally {
          restoring = false;
        }
      };
    }
    notifySuccess?.(buildMailMoveUndoMessage({ count: n, folderLabel }), options);
  };
}
