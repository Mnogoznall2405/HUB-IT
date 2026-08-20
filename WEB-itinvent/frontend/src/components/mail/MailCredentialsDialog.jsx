import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material';
import {
  getMailDialogActionsSx,
  getMailDialogContentSx,
  getMailDialogPaperSx,
  getMailDialogTitleSx,
} from './mailUiTokens';
import {
  MAIL_COMPUTER_PASSWORD_HELPER,
  MAIL_COMPUTER_PASSWORD_HINT,
  MAIL_COMPUTER_PASSWORD_LABEL,
} from './mailCredentialsCopy';

function credentialsTitle(reason) {
  if (reason === 'expired') return 'Обновите корпоративный пароль';
  if (reason === 'shared') return 'Сохраните пароль для всех устройств';
  return 'Введите корпоративный пароль';
}

function credentialsAlertText(reason) {
  if (reason === 'expired') {
    return 'Exchange больше не принимает сохранённый пароль. Введите новый пароль от корпоративного компьютера — тот же, что вы используете для входа в Windows.';
  }
  if (reason === 'shared') {
    return 'После успешной проверки логин и пароль сохранятся в вашем профиле, и этот ящик будет работать на всех ваших устройствах.';
  }
  return 'После успешной проверки логин и пароль будут сохранены и почта откроется без повторного ввода.';
}

export default function MailCredentialsDialog({
  open = false,
  reason = 'missing',
  ui = {},
  login = '',
  email = '',
  password = '',
  error = '',
  saving = false,
  loginPlaceholder = '',
  emailPlaceholder = '',
  onLoginChange,
  onEmailChange,
  onPasswordChange,
  onSave,
} = {}) {
  return (
    <Dialog open={open} maxWidth="xs" fullWidth disableEscapeKeyDown PaperProps={{ sx: getMailDialogPaperSx(ui) }}>
      <DialogTitle sx={getMailDialogTitleSx(ui)}>
        {credentialsTitle(reason)}
      </DialogTitle>
      <DialogContent dividers sx={getMailDialogContentSx(ui)}>
        <Stack spacing={1.3} sx={{ mt: 0.5 }}>
          <Alert severity={reason === 'expired' ? 'warning' : 'info'} sx={{ borderRadius: ui.radiusMd }}>
            {credentialsAlertText(reason)}
          </Alert>
          <Alert severity="info" sx={{ borderRadius: ui.radiusMd }}>
            {MAIL_COMPUTER_PASSWORD_HINT}
          </Alert>
          <TextField
            fullWidth
            size="small"
            label="Логин Exchange"
            value={login}
            onChange={(event) => onLoginChange?.(event.target.value)}
            placeholder={loginPlaceholder || 'username@zsgp.corp'}
          />
          <TextField
            fullWidth
            size="small"
            label="Почта Exchange"
            value={email}
            onChange={(event) => onEmailChange?.(event.target.value)}
            placeholder={emailPlaceholder || ''}
          />
          <TextField
            fullWidth
            size="small"
            type="password"
            label={MAIL_COMPUTER_PASSWORD_LABEL}
            helperText={MAIL_COMPUTER_PASSWORD_HELPER}
            value={password}
            onChange={(event) => onPasswordChange?.(event.target.value)}
            autoFocus
          />
          {error ? <Alert severity="error" sx={{ borderRadius: ui.radiusMd }}>{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={getMailDialogActionsSx(ui)}>
        <Button variant="contained" onClick={onSave} disabled={saving}>
          {saving ? 'Проверяем...' : 'Сохранить и открыть почту'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
