import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import { buildOfficeUiTokens, getOfficeSubtlePanelSx } from '../../../theme/officeUiTokens';
import SectionCard from '../shared/SectionCard';

export function TransferActReminderSettingsCard({ appSettings, loading, saving, onSave }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const [draftUsername, setDraftUsername] = useState('');

  useEffect(() => {
    setDraftUsername(String(appSettings?.transfer_act_reminder_controller_username || '').trim().toLowerCase());
  }, [appSettings?.transfer_act_reminder_controller_username]);

  const controllers = useMemo(
    () => (Array.isArray(appSettings?.available_controllers) ? appSettings.available_controllers : []),
    [appSettings?.available_controllers],
  );

  const currentUsername = String(appSettings?.transfer_act_reminder_controller_username || '').trim().toLowerCase();
  const resolvedController = appSettings?.resolved_controller || null;
  const resolvedSource = String(appSettings?.resolved_controller_source || 'none').trim().toLowerCase();
  const warning = String(appSettings?.warning || '').trim();
  const dirty = draftUsername !== currentUsername;
  const hasCurrentOption = controllers.some((item) => String(item?.username || '').trim().toLowerCase() === currentUsername);

  return (
    <SectionCard
      title="Web-настройки reminder-задач"
      action={
        <Chip
          size="small"
          color={resolvedSource === 'configured' ? 'success' : (resolvedSource === 'fallback' ? 'warning' : 'default')}
          label={resolvedSource === 'configured' ? 'Из настройки' : (resolvedSource === 'fallback' ? 'Fallback' : 'Не разрешён')}
        />
      }
      sx={{ flexShrink: 0 }}
      contentSx={{ p: 1.1 }}
    >
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.4 }}>
          Здесь задаётся контролёр по умолчанию для reminder-задач о загрузке подписанных актов перемещения.
          Исполнителем задачи останется создатель перемещения.
        </Typography>

        <FormControl fullWidth size="small" disabled={loading || saving}>
          <InputLabel>Контролёр по умолчанию</InputLabel>
          <Select
            value={draftUsername}
            label="Контролёр по умолчанию"
            onChange={(event) => setDraftUsername(String(event.target.value || '').trim().toLowerCase())}
          >
            {!hasCurrentOption && currentUsername ? (
              <MenuItem value={currentUsername}>
                {currentUsername} (недоступен)
              </MenuItem>
            ) : null}
            {controllers.map((item) => (
              <MenuItem key={item.username} value={String(item.username || '').trim().toLowerCase()}>
                {(item.full_name || item.username)} (@{item.username})
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Button
            variant="contained"
            startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveOutlinedIcon />}
            onClick={() => onSave({ transfer_act_reminder_controller_username: draftUsername || null })}
            disabled={loading || saving || !dirty}
          >
            {saving ? 'Сохранение...' : 'Сохранить контролёра'}
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.35 }}>
            Разрешены активные admin или пользователи с правом <strong>`tasks.review`</strong>.
          </Typography>
        </Stack>

        {warning ? (
          <Alert severity="warning">{warning}</Alert>
        ) : null}

        {resolvedController ? (
          <Paper
            variant="outlined"
            sx={getOfficeSubtlePanelSx(ui, { p: 1.05, borderRadius: '12px', bgcolor: ui.actionBg })}
          >
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }}>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>
                  Сейчас будет использован
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 800 }}>
                  {resolvedController.full_name || resolvedController.username}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  @{resolvedController.username} • роль: {resolvedController.role || 'viewer'}
                </Typography>
              </Box>
              <Chip
                size="small"
                color={resolvedSource === 'configured' ? 'success' : 'warning'}
                label={resolvedSource === 'configured' ? 'Из настройки' : 'Авто fallback'}
              />
            </Stack>
          </Paper>
        ) : (
          <Alert severity="error">
            Не найден ни один активный admin или пользователь с правом <strong>`tasks.review`</strong>.
          </Alert>
        )}
      </Stack>
    </SectionCard>
  );
}
