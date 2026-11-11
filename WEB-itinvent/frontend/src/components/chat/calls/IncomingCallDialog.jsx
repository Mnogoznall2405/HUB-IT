import { keyframes } from '@emotion/react';
import {
  Avatar,
  Box,
  Button,
  Dialog,
  Stack,
  Typography,
} from '@mui/material';
import CallEndRoundedIcon from '@mui/icons-material/CallEndRounded';
import CallRoundedIcon from '@mui/icons-material/CallRounded';
import VideocamRoundedIcon from '@mui/icons-material/VideocamRounded';

import { useChatCalls } from './ChatCallsContext';
import { callMediaLabel, getInitials } from './callsModel';

const pulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(46, 125, 50, 0.45); }
  70% { box-shadow: 0 0 0 18px rgba(46, 125, 50, 0); }
  100% { box-shadow: 0 0 0 0 rgba(46, 125, 50, 0); }
`;

export default function IncomingCallDialog() {
  const {
    incoming,
    session,
    incomingBusy,
    acceptIncoming,
    declineIncoming,
  } = useChatCalls();
  const open = Boolean(incoming) && !session;
  if (!incoming) return null;

  const name = incoming.initiator.display_name;
  const label = callMediaLabel(incoming.call.media);

  return (
    <Dialog
      open={open}
      // Only explicit buttons close it: a stray backdrop click must not
      // silently drop a call.
      onClose={() => {}}
      disableEscapeKeyDown
      role="alertdialog"
      aria-labelledby="chat-call-incoming-title"
      data-testid="chat-call-incoming-dialog"
      sx={{
        '& .MuiDialog-container': { alignItems: { xs: 'flex-end', sm: 'center' } },
        '& .MuiDialog-paper': {
          m: { xs: 0, sm: 2 },
          width: { xs: '100%', sm: 360 },
          maxWidth: '100%',
          borderRadius: { xs: '20px 20px 0 0', sm: '20px' },
          pb: 'env(safe-area-inset-bottom)',
        },
      }}
    >
      <Stack alignItems="center" spacing={1.5} sx={{ px: 3, pt: 3.5, pb: 2.5 }}>
        <Avatar
          sx={{
            width: 76,
            height: 76,
            fontSize: 28,
            fontWeight: 700,
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            animation: `${pulse} 1.6s ease-out infinite`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        >
          {getInitials(name)}
        </Avatar>
        <Box sx={{ textAlign: 'center', minWidth: 0, maxWidth: '100%' }}>
          <Typography
            id="chat-call-incoming-title"
            variant="h6"
            sx={{ fontWeight: 700, overflowWrap: 'anywhere', lineHeight: 1.25 }}
          >
            {name}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4 }}>
            {`Входящий ${label}`}
          </Typography>
        </Box>

        <Stack spacing={1} sx={{ width: '100%', pt: 1 }}>
          <Stack direction="row" spacing={1}>
            <Button
              fullWidth
              variant="contained"
              color="success"
              disabled={incomingBusy}
              startIcon={<CallRoundedIcon />}
              onClick={() => { void acceptIncoming('audio'); }}
              data-testid="chat-call-accept-audio"
              sx={{ minHeight: 48, textTransform: 'none', fontWeight: 700, borderRadius: 3 }}
            >
              Принять
            </Button>
            <Button
              fullWidth
              variant="outlined"
              color="success"
              disabled={incomingBusy}
              startIcon={<VideocamRoundedIcon />}
              onClick={() => { void acceptIncoming('video'); }}
              data-testid="chat-call-accept-video"
              sx={{ minHeight: 48, textTransform: 'none', fontWeight: 700, borderRadius: 3 }}
            >
              С видео
            </Button>
          </Stack>
          <Button
            fullWidth
            variant="contained"
            color="error"
            disabled={incomingBusy}
            startIcon={<CallEndRoundedIcon />}
            onClick={declineIncoming}
            data-testid="chat-call-decline"
            sx={{ minHeight: 48, textTransform: 'none', fontWeight: 700, borderRadius: 3 }}
          >
            Отклонить
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}
