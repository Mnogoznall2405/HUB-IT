import { Box, Chip, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import ToastViewport from '../feedback/ToastViewport';
import {
  executeToastAction,
  resolveToastHistoryAction,
} from '../feedback/toastActions';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';

const TOAST_SOURCE_LABELS = {
  hub: 'Центр управления',
  mail: 'Почта',
  settings: 'Настройки',
  database: 'IT-invent WEB',
  networks: 'Сети',
  tasks: 'Задачи',
  statistics: 'Статистика',
  mfu: 'МФУ',
  'ad-users': 'Пользователи AD',
  vcs: 'ВКС',
  'database-switch': 'Переключение БД',
};

const TOAST_SEVERITY_META = {
  success: { color: '#22c55e' },
  error: { color: '#ef4444' },
  warning: { color: '#f59e0b' },
  info: { color: '#3b82f6' },
};

const formatPanelDateTime = (value) => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  const now = new Date();
  const sameDay = parsed.toDateString() === now.toDateString();
  return sameDay
    ? parsed.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : parsed.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
};

function ToastHistoryList({ items }) {
  const theme = useTheme();
  const ui = buildOfficeUiTokens(theme);
  const navigate = useNavigate();

  return (
    <Stack spacing={0.9}>
      {(Array.isArray(items) ? items : []).map((item) => {
        const severityMeta = TOAST_SEVERITY_META[item?.severity] || TOAST_SEVERITY_META.info;
        const sourceLabel = TOAST_SOURCE_LABELS[item?.source] || 'Система';
        const title = String(item?.title || '').trim() || sourceLabel;
        const message = String(item?.message || '').trim();
        const duplicated = title === message;
        const displayTitle = duplicated ? sourceLabel : title;
        const resolvedAction = resolveToastHistoryAction(item);
        const handleActivate = () => {
          if (!resolvedAction) return;
          executeToastAction(resolvedAction, { navigate });
        };

        return (
          <Box
            key={item.id}
            data-testid={`toast-history-${item?.id || 'item'}`}
            onClick={resolvedAction ? handleActivate : undefined}
            onKeyDown={resolvedAction ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleActivate();
              }
            } : undefined}
            role={resolvedAction ? 'button' : undefined}
            tabIndex={resolvedAction ? 0 : undefined}
            sx={{
              borderRadius: '14px',
              cursor: resolvedAction ? 'pointer' : 'default',
              outline: 'none',
            }}
          >
            <ToastViewport
              inline
              open
              hideClose
              toast={{
                ...item,
                severity: item?.severity || 'info',
                title: displayTitle,
                message,
                persist: true,
                action: resolvedAction,
                onAction: resolvedAction ? handleActivate : undefined,
              }}
              sx={{
                width: '100%',
                maxWidth: '100%',
                boxShadow: 'none',
                backdropFilter: 'none',
                transition: 'transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
                ...(resolvedAction ? {
                  '&:hover': {
                    borderColor: alpha(severityMeta.color, 0.3),
                    boxShadow: `0 8px 24px ${alpha(severityMeta.color, 0.12)}`,
                    transform: 'translateY(-1px)',
                  },
                } : null),
              }}
              footer={(
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.15 }}>
                  <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
                    <Chip
                      size="small"
                      label={sourceLabel}
                      sx={{
                        height: 20,
                        fontSize: '0.62rem',
                        fontWeight: 600,
                        bgcolor: ui.actionBg,
                        border: '1px solid',
                        borderColor: ui.borderSoft,
                      }}
                    />
                    {Number(item?.statusCode || 0) > 0 && (
                      <Chip
                        size="small"
                        label={`HTTP ${item.statusCode}`}
                        sx={{
                          height: 20,
                          fontSize: '0.62rem',
                          fontWeight: 600,
                          bgcolor: ui.actionBg,
                          border: '1px solid',
                          borderColor: ui.borderSoft,
                        }}
                      />
                    )}
                    {Number(item?.suppressedCount || 0) > 0 && (
                      <Chip
                        size="small"
                        label={`Подавлено: ${item.suppressedCount}`}
                        sx={{
                          height: 20,
                          fontSize: '0.62rem',
                          fontWeight: 600,
                          color: severityMeta.color,
                          bgcolor: alpha(severityMeta.color, 0.1),
                        }}
                      />
                    )}
                  </Stack>
                  <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.65rem', pl: 1 }}>
                    {formatPanelDateTime(item?.lastSeenAt)}
                  </Typography>
                </Stack>
              )}
            />
          </Box>
        );
      })}
    </Stack>
  );
}

export default ToastHistoryList;
