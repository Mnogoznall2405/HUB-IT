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
    moves,
  } = {}) {
    // `moves` carries the authoritative undo plan: the NEW message id the
    // server returned for each moved message plus that message's own source
    // folder. Legacy `messageIds`+`restoreFolder` callers still work.
    const entries = (Array.isArray(moves) ? moves : [])
      .map((entry) => ({
        id: String(entry?.id || '').trim(),
        restoreFolder: String(entry?.restoreFolder || '').trim(),
      }))
      .filter((entry) => entry.id && entry.restoreFolder);
    if (entries.length === 0) {
      const targetFolder = String(restoreFolder || '').trim();
      for (const id of (Array.isArray(messageIds) ? messageIds : [])) {
        const normalized = String(id || '').trim();
        if (normalized && targetFolder) entries.push({ id: normalized, restoreFolder: targetFolder });
      }
    }
    const n = Math.max(entries.length, Number(count) || 0, 1);
    const options = {
      durationMs: MAIL_MOVE_UNDO_DURATION_MS,
    };
    if (entries.length > 0) {
      options.actionLabel = MAIL_MOVE_UNDO_ACTION_LABEL;
      options.onAction = async () => {
        if (restoring) return;
        restoring = true;
        try {
          for (const entry of entries) {
            await mailAPI?.moveMessage?.(
              entry.id,
              withActiveMailboxPayload?.({ target_folder: entry.restoreFolder }) || { target_folder: entry.restoreFolder },
            );
          }
          await afterUndo?.();
          notifySuccess?.(buildMailMoveRestoredMessage({ count: entries.length }));
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
