import { Alert, Button, Snackbar, Typography } from '@mui/material';

import { useChatCalls } from './ChatCallsContext';

export default function CallNoticeSnackbar() {
  const { notice, dismissNotice, joinCall, session } = useChatCalls();
  const action = notice?.action;
  return (
    <Snackbar
      open={Boolean(notice)}
      onClose={(event, reason) => {
        if (reason === 'clickaway') return;
        dismissNotice();
      }}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      // Above the floating call panel (1250) and MUI modals.
      sx={{ zIndex: 1400, bottom: { xs: 'calc(88px + env(safe-area-inset-bottom))', sm: 24 } }}
    >
      {notice ? (
        <Alert
          severity={notice.severity || 'info'}
          variant="filled"
          onClose={dismissNotice}
          data-testid="chat-call-notice"
          action={action?.call && !session ? (
            <Button
              color="inherit"
              size="small"
              data-testid="chat-call-notice-join"
              onClick={() => {
                dismissNotice();
                void joinCall(action.call, action.media);
              }}
            >
              {action.label}
            </Button>
          ) : undefined}
          sx={{ alignItems: 'center', maxWidth: 520 }}
        >
          {notice.text}
          {notice.detail ? (
            <Typography
              variant="caption"
              data-testid="chat-call-notice-detail"
              sx={{ display: 'block', mt: 0.5, opacity: 0.8 }}
            >
              {notice.detail}
            </Typography>
          ) : null}
        </Alert>
      ) : null}
    </Snackbar>
  );
}
