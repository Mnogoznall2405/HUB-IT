import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  FormControlLabel,
  FormGroup,
  Paper,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { settingsAPI } from '../../../../api/client';
import { useNotification } from '../../../../contexts/NotificationContext';
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
  ['chat_ai', 'Уведомления ИИ-агентов'],
];

export function NotificationChannelsSettingsCard({ embedded = false }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const { notifyApiError } = useNotification();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [channels, setChannels] = useState(() => normalizeNotificationPreferences());
  const channelsRef = useRef(channels);
  channelsRef.current = channels;
  // Номер последнего изменения по каждому полю и общий счётчик запросов:
  // откатываем поле, только если ошибка пришла по его последнему изменению,
  // а ответ сервера применяем, только если после него не было новых PATCH.
  const fieldVersionRef = useRef({});
  const requestSeqRef = useRef(0);
  const pendingSavesRef = useRef(0);

  const loadPreferences = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await settingsAPI.getNotificationPreferences();
      const nextChannels = normalizeNotificationPreferences(data?.channels);
      setChannels(nextChannels);
      dispatchNotificationPreferencesChanged(nextChannels);
    } catch {
      setLoadError(true);
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
        chat_ai: enabled,
      }
      : { [key]: enabled };
    const affectedKeys = Object.keys(optimisticPatch);
    const previousValues = {};
    const versions = {};
    affectedKeys.forEach((field) => {
      previousValues[field] = Boolean(channelsRef.current?.[field]);
      versions[field] = (fieldVersionRef.current[field] || 0) + 1;
      fieldVersionRef.current[field] = versions[field];
    });
    requestSeqRef.current += 1;
    const requestSeq = requestSeqRef.current;
    setChannels((prev) => ({ ...prev, ...optimisticPatch }));
    pendingSavesRef.current += 1;
    setSaving(true);
    try {
      const data = await settingsAPI.updateNotificationPreferences({ [key]: enabled });
      if (requestSeq === requestSeqRef.current) {
        const nextChannels = normalizeNotificationPreferences(data?.channels);
        setChannels(nextChannels);
        dispatchNotificationPreferencesChanged(nextChannels);
      }
    } catch (error) {
      const rollback = {};
      affectedKeys.forEach((field) => {
        if (fieldVersionRef.current[field] === versions[field]) rollback[field] = previousValues[field];
      });
      if (Object.keys(rollback).length > 0) {
        setChannels((prev) => ({ ...prev, ...rollback }));
      }
      notifyApiError(error, 'Не удалось сохранить настройку уведомлений.', { source: 'settings' });
    } finally {
      pendingSavesRef.current = Math.max(0, pendingSavesRef.current - 1);
      if (pendingSavesRef.current === 0) setSaving(false);
    }
  }, [notifyApiError]);

  const chatEnabled = CHAT_NOTIFICATION_CHANNELS.some(([key]) => Boolean(channels[key]));
  const switchesLocked = loading || saving || loadError;

  return (
    <SectionCard
      title={embedded ? 'Какие уведомления получать' : 'Уведомления'}
      description="Настройки сохраняются для учётной записи и одинаково действуют в браузере и HUB Desktop."
      sx={embedded ? { border: 0, borderRadius: 0, bgcolor: 'transparent' } : undefined}
      contentSx={{ p: 1.5 }}
    >
      <Stack spacing={1.1}>
        {loadError ? (
          <Alert
            severity="error"
            action={(
              <Button color="inherit" size="small" onClick={() => { void loadPreferences(); }} disabled={loading}>
                Повторить
              </Button>
            )}
          >
            Не удалось загрузить настройки уведомлений.
          </Alert>
        ) : null}
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
                    disabled={switchesLocked}
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
                Общий выключатель для личных сообщений, групповых бесед, диалогов задач и ответов ИИ-агентов.
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
                        disabled={switchesLocked || !chatEnabled}
                      />
                    )}
                    label={label}
                    sx={{ m: 0, minHeight: 40 }}
                  />
                ))}
                <FormControlLabel
                  control={(
                    <Switch
                      name="chat_sound"
                      checked={Boolean(channels.chat_sound)}
                      onChange={(event) => handleToggle('chat_sound', event?.target?.checked)}
                      disabled={switchesLocked || !chatEnabled}
                    />
                  )}
                  label="Звук сообщений"
                  sx={{ m: 0, minHeight: 40 }}
                />
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
                        disabled={switchesLocked}
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
