import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FormControlLabel,
  FormGroup,
  Paper,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { settingsAPI } from '../../../../api/client';
import {
  dispatchNotificationPreferencesChanged,
  normalizeNotificationPreferences,
} from '../../../../lib/notificationPreferences';
import { buildOfficeUiTokens, getOfficeSubtlePanelSx } from '../../../../theme/officeUiTokens';
import SectionCard from '../../shared/SectionCard';

const PRIMARY_NOTIFICATION_CHANNELS = [
  ['mail', 'Почта'],
  ['tasks', 'Задачи'],
  ['task_email', 'Email по задачам'],
  ['announcements', 'Лента компании'],
];

const CHAT_NOTIFICATION_CHANNELS = [
  ['chat_direct', 'Личные сообщения'],
  ['chat_group', 'Групповые беседы'],
  ['chat_task', 'Диалоги задач'],
];

export function NotificationChannelsSettingsCard({ embedded = false }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [channels, setChannels] = useState(() => normalizeNotificationPreferences());

  const loadPreferences = useCallback(async () => {
    setLoading(true);
    try {
      const data = await settingsAPI.getNotificationPreferences();
      const nextChannels = normalizeNotificationPreferences(data?.channels);
      setChannels(nextChannels);
      dispatchNotificationPreferencesChanged(nextChannels);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

  const handleToggle = useCallback(async (key, value) => {
    const enabled = Boolean(value);
    const optimisticPatch = key === 'chat'
      ? {
        chat: enabled,
        chat_direct: enabled,
        chat_group: enabled,
        chat_task: enabled,
      }
      : { [key]: enabled };
    setChannels((prev) => ({ ...prev, ...optimisticPatch }));
    setSaving(true);
    try {
      const data = await settingsAPI.updateNotificationPreferences({ [key]: enabled });
      const nextChannels = normalizeNotificationPreferences(data?.channels);
      setChannels(nextChannels);
      dispatchNotificationPreferencesChanged(nextChannels);
    } finally {
      setSaving(false);
    }
  }, []);

  const chatEnabled = CHAT_NOTIFICATION_CHANNELS.some(([key]) => Boolean(channels[key]));

  return (
    <SectionCard
      title={embedded ? 'Какие уведомления получать' : 'Уведомления'}
      description="Настройки сохраняются для учётной записи и одинаково действуют в браузере и HUB Desktop."
      sx={embedded ? { border: 0, borderRadius: 0, bgcolor: 'transparent' } : undefined}
      contentSx={{ p: 1.5 }}
    >
      <Stack spacing={1.1}>
        <Paper
          variant="outlined"
          sx={getOfficeSubtlePanelSx(ui, {
            p: 1.2,
            borderRadius: '12px',
            bgcolor: ui.panelInset,
          })}
        >
          <Stack spacing={1.6}>
            <Stack spacing={0.45}>
              <FormControlLabel
                control={(
                  <Switch
                    name="chat"
                    checked={chatEnabled}
                    onChange={(event) => handleToggle('chat', event?.target?.checked)}
                    disabled={loading || saving}
                  />
                )}
                label="Получать уведомления о чатах"
                sx={{ m: 0, minHeight: 44, '& .MuiFormControlLabel-label': { fontWeight: 800 } }}
              />
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ pl: { xs: 0, sm: 6.5 }, lineHeight: 1.45 }}
              >
                Общий выключатель для личных сообщений, групповых бесед и диалогов задач.
              </Typography>
              <FormGroup sx={{ pl: { xs: 0.5, sm: 5.5 } }}>
                {CHAT_NOTIFICATION_CHANNELS.map(([key, label]) => (
                  <FormControlLabel
                    key={key}
                    control={(
                      <Switch
                        name={key}
                        checked={Boolean(channels[key])}
                        onChange={(event) => handleToggle(key, event?.target?.checked)}
                        disabled={loading || saving || !chatEnabled}
                      />
                    )}
                    label={label}
                    sx={{ m: 0, minHeight: 40 }}
                  />
                ))}
              </FormGroup>
            </Stack>

            <Stack spacing={0.35}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                Другие события
              </Typography>
              <FormGroup>
                {PRIMARY_NOTIFICATION_CHANNELS.map(([key, label]) => (
                  <FormControlLabel
                    key={key}
                    control={(
                      <Switch
                        name={key}
                        checked={Boolean(channels[key])}
                        onChange={(event) => handleToggle(key, event?.target?.checked)}
                        disabled={loading || saving}
                      />
                    )}
                    label={label}
                    sx={{ m: 0, minHeight: 40 }}
                  />
                ))}
              </FormGroup>
            </Stack>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35, lineHeight: 1.45 }}>
            Отключение уведомлений не скрывает диалоги и счётчики непрочитанных сообщений.
          </Typography>
        </Paper>
      </Stack>
    </SectionCard>
  );
}
