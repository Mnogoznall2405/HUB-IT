import { forwardRef, useEffect, useImperativeHandle } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText,
  DialogTitle, Stack,
} from '@mui/material';
import useMyFilesEditorSession from './useMyFilesEditorSession';

/** The same live document surface serves the dialog, browser tab and Desktop workspace. */
const MyFilesEditorSurface = forwardRef(function MyFilesEditorSurface({
  fileId, onError, onConfig, onStatusChange, onRequestClose, onTitleChange, onRequestHistory, onRequestRename, onRequestSharingSettings, active = true,
}, ref) {
  const session = useMyFilesEditorSession({ fileId, onError, onConfig, onStatusChange, onRequestClose, onTitleChange, onRequestHistory, onRequestRename, onRequestSharingSettings });
  const { status } = session;
  useEffect(() => { if (!active) session.cancelDiscard(); }, [active, session.cancelDiscard]);
  useImperativeHandle(ref, () => ({ requestClose: session.requestClose, setSharingSettings: session.setSharingSettings,
    focus: () => session.hostRef.current?.querySelector('iframe')?.focus(),
  }), [session.requestClose, session.setSharingSettings, session.hostRef]);
  const stopped = status.phase === 'blocked' || status.phase === 'error';
  const message = stopped ? status.message : status.offline
    ? 'Нет сети. Не закрывайте документ: правки могут ещё не быть отправлены. После возвращения сети редактор попробует подключиться автоматически.'
    : status.message || status.warning;
  const canRetry = !status.offline && !stopped && status.save !== 'dirty' && Boolean(status.message);
  const canReopen = !status.offline && status.hasEditor && (stopped || status.warning || status.phase === 'refreshing');

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
