import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText,
  DialogTitle, Stack, Tooltip,
} from '@mui/material';
import GroupRoundedIcon from '@mui/icons-material/GroupRounded';
import CloudDoneRoundedIcon from '@mui/icons-material/CloudDoneRounded';
import useMyFilesEditorSession from './useMyFilesEditorSession';

/** The same live document surface serves the dialog, browser tab and Desktop workspace. */
const MyFilesEditorSurface = forwardRef(function MyFilesEditorSurface({
  fileId, initialCompare = '', onError, onConfig, onStatusChange, onRequestClose, onTitleChange, onRequestHistory, onRequestRename, onRequestSharingSettings, active = true,
}, ref) {
  const session = useMyFilesEditorSession({ fileId, initialCompare, onError, onConfig, onStatusChange, onRequestClose, onTitleChange, onRequestHistory, onRequestRename, onRequestSharingSettings });
  const { status } = session;
  useEffect(() => { if (!active) session.cancelDiscard(); }, [active, session.cancelDiscard]);
  useImperativeHandle(ref, () => ({ requestClose: session.requestClose, setSharingSettings: session.setSharingSettings,
    startCompare: session.startCompare,
    focus: () => session.hostRef.current?.querySelector('iframe')?.focus(),
  }), [session.requestClose, session.setSharingSettings, session.startCompare, session.hostRef]);
  const stopped = status.phase === 'blocked' || status.phase === 'error';
  const message = stopped ? status.message : status.offline
    ? 'Нет сети. Не закрывайте документ: правки могут ещё не быть отправлены. После возвращения сети редактор попробует подключиться автоматически.'
    : status.message || status.warning;
  const canRetry = !status.offline && !stopped && status.save !== 'dirty' && Boolean(status.message);
  const canReopen = !status.offline && status.hasEditor && (stopped || status.warning || status.phase === 'refreshing');
  const coeditors = Array.isArray(status.others) ? status.others.filter(Boolean) : [];
  const coeditorsSignature = coeditors.join(' ');
  const coeditorsTotal = Math.max(coeditors.length, Number(status.othersCount) || 0);
  const extraCoeditors = coeditorsTotal - Math.min(coeditors.length, 3);
  const coeditorsLabel = coeditors.slice(0, 3).join(', ') + (extraCoeditors > 0 ? ` и ещё ${extraCoeditors}` : '');
  const [dismissedCoeditors, setDismissedCoeditors] = useState('');
  const showCoeditors = Boolean(coeditorsSignature) && coeditorsSignature !== dismissedCoeditors;
  const isSpreadsheet = status.docType === 'cell';
  const syncedAt = status.save === 'submitted' && status.savedAt
    ? new Date(status.savedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {message ? (
        <Alert
          severity={stopped ? 'error' : status.offline || status.warning ? 'warning' : 'info'}
          role={stopped ? 'alert' : 'status'}
          aria-live={stopped ? 'assertive' : 'polite'}
          data-testid="my-files-office-recovery"
          sx={{ flexShrink: 0, borderRadius: 0, '& .MuiAlert-message': { width: '100%' } }}
        >
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }}>
            <Box sx={{ flex: 1 }}>{message}</Box>
            {canRetry ? <Button size="small" color="inherit" disabled={status.busy} onClick={session.retry}>Повторить сейчас</Button> : null}
            {status.phase === 'error' && !status.hasEditor && !status.offline ? <Button size="small" color="inherit" onClick={session.reopen}>Повторить</Button> : null}
            {canReopen ? <Button size="small" color="inherit" onClick={session.reopen}>Переоткрыть документ</Button> : null}
          </Stack>
        </Alert>
      ) : null}
      <Box sx={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <Box ref={session.hostRef} data-testid="my-files-office-editor" sx={{ position: 'absolute', inset: 0 }} />
        <Stack direction="row" spacing={0.75} alignItems="center"
          sx={{ position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)', zIndex: 3 }}>
          {syncedAt ? (
            <Tooltip
              arrow
              title="Правки переданы серверу редактора. Файл в HUB обновляется при сохранении совместной сессии."
            >
              <Chip
                size="small"
                variant="outlined"
                icon={<CloudDoneRoundedIcon sx={{ fontSize: 16 }} />}
                label={`Синхронизировано ${syncedAt}`}
                data-testid="my-files-office-synced"
                aria-label={`Правки синхронизированы в ${syncedAt}`}
                sx={{ boxShadow: 3, bgcolor: 'background.paper' }}
              />
            </Tooltip>
          ) : null}
          {showCoeditors ? (
            <Tooltip
              arrow
              title={isSpreadsheet
                ? `Сейчас с вами в документе работают: ${coeditorsLabel}. Фильтры и сортировка видны всем участникам — для личной фильтрации используйте «Вид → Представление листа».`
                : `Сейчас с вами в документе работают: ${coeditorsLabel}.`}
            >
              <Chip
                size="small"
                color={isSpreadsheet ? 'warning' : 'info'}
                icon={<GroupRoundedIcon sx={{ fontSize: 16 }} />}
                label={isSpreadsheet ? `ещё ${coeditorsTotal} · фильтры общие` : `ещё ${coeditorsTotal}`}
                onDelete={() => setDismissedCoeditors(coeditorsSignature)}
                data-testid="my-files-office-coeditors"
                aria-label={isSpreadsheet
                  ? `В документе работают ещё ${coeditorsTotal}: ${coeditorsLabel}. Фильтры и сортировка видны всем участникам.`
                  : `В документе работают ещё ${coeditorsTotal}: ${coeditorsLabel}.`}
                sx={{ boxShadow: 3 }}
              />
            </Tooltip>
          ) : null}
        </Stack>
        {!status.frameReady && !stopped ? (
          <Stack alignItems="center" justifyContent="center" sx={{ position: 'absolute', inset: 0, bgcolor: 'background.paper' }}>
            <CircularProgress aria-label="Загрузка редактора" />
          </Stack>
        ) : null}
      </Box>
      <Dialog open={Boolean(session.discardAction)} onClose={session.cancelDiscard} aria-labelledby="office-discard-title">
        <DialogTitle id="office-discard-title">{session.discardAction === 'close' ? 'Закрыть документ?' : 'Переоткрыть документ?'}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Сначала сохраните копию средствами редактора или скопируйте важные правки. Неотправленные изменения будут потеряны.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={session.cancelDiscard} autoFocus>Продолжить работу</Button>
          <Button color="warning" onClick={session.confirmDiscard}>{session.discardAction === 'close' ? 'Закрыть' : 'Переоткрыть'}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
});

export default MyFilesEditorSurface;
