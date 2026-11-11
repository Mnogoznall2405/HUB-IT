import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { MAIL_COMPUTER_PASSWORD_HINT } from './mailCredentialsCopy';

export default function MailCredentialsGate({
  ui = {},
  requiresRelogin = false,
  canSaveForAllDevices = false,
  reason = 'missing',
  login = '',
  email = '',
  onEnterPassword,
} = {}) {
  return (
    <Paper
      elevation={0}
      sx={{
        flex: 1,
        minHeight: 0,
        borderRadius: '16px',
        border: '1px solid',
        borderColor: ui.borderSoft,
        bgcolor: ui.panelBg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: { xs: 2, md: 3 },
      }}
    >
      <Stack spacing={1.4} sx={{ maxWidth: 540, width: '100%' }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {requiresRelogin
            ? (canSaveForAllDevices ? 'Сохраните пароль корпоративной почты' : 'Для доступа к почте войдите заново')
            : 'Требуется корпоративный пароль'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {requiresRelogin
            ? (
              canSaveForAllDevices
                ? 'Вход в HUB с доверенного устройства не передаёт пароль в Exchange. Введите актуальный пароль от Windows один раз — полный повторный вход в систему не нужен.'
                : 'Текущая веб-сессия больше не может автоматически подтвердить доступ к Exchange. Выйдите и войдите заново.'
            )
            : reason === 'expired'
              ? 'Пароль от корпоративного компьютера изменился. Логин сохранён — введите только новый пароль от Windows. Полный повторный вход в HUB не нужен.'
              : 'При первом входе в раздел Почта нужно один раз подтвердить логин и пароль от корпоративного компьютера. После этого почта откроется без повторного ввода.'}
        </Typography>
        {!requiresRelogin || canSaveForAllDevices ? (
          <>
            <Alert severity="info" sx={{ borderRadius: ui.radiusMd }}>
              {MAIL_COMPUTER_PASSWORD_HINT}
            </Alert>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Chip size="small" variant="outlined" label={`Логин: ${login || 'не указан'}`} />
              <Chip size="small" variant="outlined" label={`Ящик: ${email || 'не указан'}`} />
            </Stack>
            <Box>
              <Button variant="contained" onClick={onEnterPassword}>
                {canSaveForAllDevices ? 'Сохранить пароль для всех устройств' : 'Ввести пароль'}
              </Button>
            </Box>
          </>
        ) : null}
      </Stack>
    </Paper>
  );
}
