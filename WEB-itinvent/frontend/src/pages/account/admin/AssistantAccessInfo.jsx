import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { buildOfficeUiTokens, getOfficeSubtlePanelSx } from '../../../theme/officeUiTokens';
import {
  AI_ASSISTANT_FALLBACK_CAPABILITIES,
  aiAssistantCapabilities,
} from '../../../api/aiAssistantCapabilities';
import { SETTINGS_PERMISSION_GROUPS } from '../accountConstants';

const GROUP_LABELS = {
  files: 'Файлы и документы',
  kb: 'База знаний',
  itinvent: 'ITinvent',
  office: 'Почта, задачи и объявления',
  mfu: 'МФУ и принтеры',
  ad: 'Active Directory',
  network: 'Сеть',
  chat: 'Чат',
  self: 'Мои данные и обращения в IT',
  other: 'Прочее',
};
const GROUP_ORDER = ['self', 'files', 'kb', 'itinvent', 'office', 'mfu', 'ad', 'network', 'chat', 'other'];

const PERMISSION_LABELS = new Map(
  SETTINGS_PERMISSION_GROUPS.flatMap((group) =>
    (group.permissions || []).map((permission) => [permission.value, permission.label]),
  ),
);

export function permissionLabel(permissionId) {
  return PERMISSION_LABELS.get(permissionId) || permissionId;
}

export function groupCapabilities(capabilities) {
  const rows = Array.isArray(capabilities) ? capabilities : [];
  const grouped = new Map();
  for (const row of rows) {
    const group = String(row?.group || 'other');
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push(row);
  }
  const known = GROUP_ORDER.filter((group) => grouped.has(group));
  const rest = [...grouped.keys()].filter((group) => !GROUP_ORDER.includes(group));
  return [...known, ...rest].map((group) => ({
    group,
    label: GROUP_LABELS[group] || group,
    items: grouped.get(group),
  }));
}

export default function AssistantAccessInfo({ requiredPermission = 'chat.ai.use' }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    const version = ++generation.current;
    setLoading(true);
    setFallbackUsed(false);
    let cancelled = false;
    aiAssistantCapabilities.get()
      .then((data) => {
        if (cancelled || version !== generation.current) return;
        setPayload(data && typeof data === 'object' ? data : null);
      })
      .catch(() => {
        if (cancelled || version !== generation.current) return;
        // Старый backend без эндпоинта: показываем статичную карту прав.
        setPayload({ capabilities: AI_ASSISTANT_FALLBACK_CAPABILITIES, source: 'fallback' });
        setFallbackUsed(true);
      })
      .finally(() => {
        if (!cancelled && version === generation.current) setLoading(false);
      });
    return () => {
      cancelled = true;
      generation.current += 1;
    };
  }, []);

  const permission = String(requiredPermission || 'chat.ai.use').trim() || 'chat.ai.use';
  const groups = groupCapabilities(payload?.capabilities);

  return (
    <Stack spacing={2}>
      <Alert severity="info">
        HUB Ассистент доступен всем сотрудникам с правом «{permissionLabel(permission)}» ({permission}).
        Персональные допуски не нужны: ассистент видит и делает только то, что сотрудник может сам в портале.
      </Alert>
      {loading ? (
        <CircularProgress size={22} aria-label="Загрузка возможностей ассистента" />
      ) : (
        <Stack spacing={1.2}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
            Что умеет ассистент по правам сотрудника
          </Typography>
          {fallbackUsed ? (
            <Typography variant="caption" color="text.secondary">
              Показана встроенная карта прав — серверный список возможностей недоступен.
            </Typography>
          ) : null}
          {groups.map((group) => (
            <Paper key={group.group} variant="outlined" sx={getOfficeSubtlePanelSx(ui, { p: 1.2, borderRadius: '12px' })}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800 }}>
                {group.label}
              </Typography>
              <Stack spacing={0.9} sx={{ mt: 0.75 }}>
                {group.items.map((item) => (
                  <Stack
                    key={item.key || item.label}
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={{ xs: 0.5, md: 1 }}
                    alignItems={{ xs: 'flex-start', md: 'center' }}
                  >
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2">{item.label}</Typography>
                    </Box>
                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                      {(Array.isArray(item.permissions) ? item.permissions : []).map((permissionId) => (
                        <Chip
                          key={permissionId}
                          size="small"
                          variant="outlined"
                          label={permissionLabel(permissionId)}
                        />
                      ))}
                      {item.admin_only ? <Chip size="small" color="warning" label="только админ" /> : null}
                      {item.it_only ? <Chip size="small" color="warning" variant="outlined" label="только ИТ" /> : null}
                      {item.granted === true ? <Chip size="small" color="success" variant="outlined" label="есть у вас" /> : null}
                      {item.granted === false ? <Chip size="small" variant="outlined" label="нет у вас" /> : null}
                    </Stack>
                  </Stack>
                ))}
              </Stack>
            </Paper>
          ))}
          <Typography variant="caption" color="text.secondary">
            «Есть у вас» / «нет у вас» отражают права вашей учётной записи. У сотрудника без нужного права
            ассистент отвечает отказом по этой возможности, а не ищет обходной путь. Инструменты AD и сети
            доступны только ИТ (права ad_users.*, networks.*).
          </Typography>
        </Stack>
      )}
    </Stack>
  );
}
