export const MAIL_TRASH_UNDO_DURATION_MS = 5000;
export const MAIL_TRASH_UNDO_ACTION_LABEL = 'Отменить';

export function buildMailTrashUndoMessage({ count = 1 } = {}) {
  const n = Math.max(1, Number(count) || 1);
  if (n > 1) {
    return `Выбранные письма перемещены в удаленные (${n}).`;
  }
  return 'Письмо перемещено в удаленные.';
}

export function buildMailTrashRestoredMessage({ count = 1 } = {}) {
  const n = Math.max(1, Number(count) || 1);
  return n > 1 ? 'Письма восстановлены.' : 'Письмо восстановлено.';
}

export function extractTrashRestoreMessageId(result) {
  if (!result || typeof result !== 'object' || result.permanent === true) return '';
  const id = String(result.message_id || '').trim();
  if (!id) return '';
  const folder = String(result.folder || '').trim().toLowerCase();
  if (folder && folder !== 'trash') return '';
  return id;
}

export function extractBulkTrashRestoreIds(bulkResult) {
  const rows = Array.isArray(bulkResult?.results) ? bulkResult.results : [];
  return rows
    .map((row) => extractTrashRestoreMessageId(row?.result))
    .filter(Boolean);
}

export function createMailTrashUndoNotifier({
  notifySuccess,
  mailAPI,
  withActiveMailboxPayload,
  afterUndo,
  handleMailCredentialsRequired,
  getMailErrorDetail,
  onError,
} = {}) {
  let restoring = false;

  return function notifyRecoverableDelete({
    messageIds = [],
    restoreFolder = 'inbox',
    count,
  } = {}) {
    const ids = (Array.isArray(messageIds) ? messageIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    const n = Math.max(ids.length, Number(count) || 0, 1);
    const targetFolder = String(restoreFolder || 'inbox');
    const options = {
      durationMs: MAIL_TRASH_UNDO_DURATION_MS,
    };
    if (ids.length > 0) {
      options.actionLabel = MAIL_TRASH_UNDO_ACTION_LABEL;
      options.onAction = async () => {
        if (restoring) return;
        restoring = true;
        try {
          for (const id of ids) {
            await mailAPI?.restoreMessage?.(
              id,
              withActiveMailboxPayload?.({ target_folder: targetFolder }) || { target_folder: targetFolder },
            );
          }
          await afterUndo?.();
          notifySuccess?.(buildMailTrashRestoredMessage({ count: ids.length }));
        } catch (requestError) {
          const fallback = 'Не удалось восстановить письмо.';
          if (!(await handleMailCredentialsRequired?.(requestError, fallback))) {
            onError?.(getMailErrorDetail?.(requestError, fallback) || fallback);
          }
        } finally {
          restoring = false;
        }
      };
    }
    notifySuccess?.(buildMailTrashUndoMessage({ count: n }), options);
  };
}
