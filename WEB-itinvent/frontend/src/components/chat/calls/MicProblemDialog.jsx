import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';

import { requestDesktopOpenMediaSettings } from '../../../lib/desktopBridge';
import { useChatCalls } from './ChatCallsContext';

// Shown before a call is placed or accepted when the microphone cannot be opened.
// In HUB-IT Desktop the text comes from the Windows diagnosis of the host and the
// dialog offers the Windows Settings pages (there is no system consent prompt
// for unpackaged desktop apps that the host could raise instead).
export default function MicProblemDialog() {
  const { micPrompt, resolveMicPrompt } = useChatCalls();
  if (!micPrompt) return null;
  const desktop = Boolean(micPrompt.desktop);
  return (
    <Dialog
      open
      onClose={() => resolveMicPrompt('cancel')}
      aria-labelledby="chat-call-mic-title"
      data-testid="chat-call-mic-dialog"
      fullWidth
      maxWidth="xs"
      sx={{ zIndex: 1350 }}
    >
      <DialogTitle id="chat-call-mic-title" sx={{ fontWeight: 700 }}>
        {desktop ? 'HUB-IT нужен доступ к микрофону' : 'Проблема с микрофоном'}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" data-testid="chat-call-mic-text" sx={{ overflowWrap: 'anywhere' }}>
          {micPrompt.text}
        </Typography>
        {micPrompt.diagnosing ? (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.25 }} data-testid="chat-call-mic-diagnosing">
            <CircularProgress size={14} />
            <Typography variant="caption" color="text.secondary">
              Проверяем микрофон в Windows…
            </Typography>
          </Stack>
        ) : null}
        {micPrompt.detail ? (
          <Typography
            variant="caption"
            color="text.secondary"
            data-testid="chat-call-mic-detail"
            sx={{ display: 'block', mt: 1.25, overflowWrap: 'anywhere' }}
          >
            {micPrompt.detail}
          </Typography>
        ) : null}
        {desktop ? (
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1.5 }}>
            {micPrompt.settingsKind === 'privacy-microphone' ? (
              <Button
                size="small"
                variant="outlined"
                onClick={() => requestDesktopOpenMediaSettings('privacy-microphone')}
                data-testid="chat-call-mic-open-privacy"
                sx={{ textTransform: 'none' }}
              >
                Открыть настройки Windows
              </Button>
            ) : null}
            <Button
              size="small"
              variant="outlined"
              onClick={() => requestDesktopOpenMediaSettings('sound')}
              data-testid="chat-call-mic-open-sound"
              sx={{ textTransform: 'none' }}
            >
              Открыть настройки звука Windows
            </Button>
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, flexWrap: 'wrap', gap: 0.5 }}>
        <Button onClick={() => resolveMicPrompt('cancel')} data-testid="chat-call-mic-cancel" sx={{ textTransform: 'none' }}>
          Отмена
        </Button>
        {micPrompt.canSkip ? (
          <Button onClick={() => resolveMicPrompt('skip')} data-testid="chat-call-mic-skip" sx={{ textTransform: 'none' }}>
            {desktop ? 'Без микрофона' : 'Войти без микрофона'}
          </Button>
        ) : null}
        <Button
          variant="contained"
          onClick={() => resolveMicPrompt('retry')}
          data-testid="chat-call-mic-retry"
          sx={{ textTransform: 'none' }}
        >
          Повторить
        </Button>
      </DialogActions>
    </Dialog>
  );
}
