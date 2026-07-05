import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Chip,
  FormControlLabel,
  FormGroup,
  Paper,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import { useTheme } from '@mui/material/styles';
import { settingsAPI } from '../../../../api/client';
import { getChatNotificationState, subscribeChatNotificationState } from '../../../../lib/chatNotifications';
import { buildOfficeUiTokens, getOfficeSubtlePanelSx } from '../../../../theme/officeUiTokens';
import SectionCard from '../../shared/SectionCard';

export function NotificationChannelsSettingsCard() {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [chatNotificationState, setChatNotificationState] = useState(() => getChatNotificationState());
  const [channels, setChannels] = useState({
    mail: true,
    tasks: true,
    task_email: true,
    announcements: true,
    chat: true,
  });

  useEffect(() => subscribeChatNotificationState(setChatNotificationState), []);

  const loadPreferences = useCallback(async () => {
    setLoading(true);
    try {
      const data = await settingsAPI.getNotificationPreferences();
      setChannels({
        mail: Boolean(data?.channels?.mail ?? true),
        tasks: Boolean(data?.channels?.tasks ?? true),
        task_email: Boolean(data?.channels?.task_email ?? true),
        announcements: Boolean(data?.channels?.announcements ?? true),
        chat: Boolean(data?.channels?.chat ?? true),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

  const handleToggle = useCallback(async (key, value) => {
    setChannels((prev) => ({ ...prev, [key]: Boolean(value) }));
    setSaving(true);
    try {
      const data = await settingsAPI.updateNotificationPreferences({ [key]: Boolean(value) });
      setChannels({
        mail: Boolean(data?.channels?.mail ?? true),
        tasks: Boolean(data?.channels?.tasks ?? true),
        task_email: Boolean(data?.channels?.task_email ?? true),
        announcements: Boolean(data?.channels?.announcements ?? true),
        chat: Boolean(data?.channels?.chat ?? true),
      });
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <SectionCard
      title="Каналы уведомлений"
      description="Один push/browser-permission для сайта и отдельные переключатели каналов: почта, задачи, объявления, chat."
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
          <FormGroup>
            {[
              ['mail', 'Почта'],
              ['tasks', 'Задачи'],
              ['task_email', 'Email по задачам'],
              ['announcements', 'Объявления'],
              ['chat', 'Chat'],
            ].map(([key, label]) => (
              <FormControlLabel
                key={key}
                control={(
                  <Switch
                    checked={Boolean(channels[key])}
                    onChange={(event) => handleToggle(key, event?.target?.checked)}
                    disabled={loading || saving}
                  />
                )}
                label={label}
              />
            ))}
          </FormGroup>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35, lineHeight: 1.45 }}>
            Если разрешение браузера уже выдано, desktop/pwa push будет приходить только по включённым каналам.
            Почта использует ту же push-подписку браузера, что и chat.
          </Typography>
          <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap" sx={{ mt: 0.75 }}>
            <Chip
              size="small"
              icon={<NotificationsActiveOutlinedIcon sx={{ fontSize: '14px !important' }} />}
              label={chatNotificationState.pushSubscribed
                ? 'Push подключен'
                : chatNotificationState.permission === 'granted'
                  ? 'Разрешение выдано, push не активен'
                  : 'Push не подключен'}
              color={chatNotificationState.pushSubscribed ? 'success' : 'default'}
              variant={chatNotificationState.pushSubscribed ? 'filled' : 'outlined'}
            />
          </Stack>
        </Paper>
      </Stack>
    </SectionCard>
  );
}
