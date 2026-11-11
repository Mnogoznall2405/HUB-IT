import { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Stack, Typography } from '@mui/material';
import { docflowAPI } from '../../api/docflow';
import { useAuth } from '../../contexts/AuthContext';

const formatDate = (value) => {
  const parts = String(value || '').split('-');
  return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : 'дата не указана';
};

export default function DocflowAbsencesPanel({ employeeCode = '', employee = false }) {
  const { user, hasPermission } = useAuth();
  const allowed = Boolean(user?.id && hasPermission?.('docflow.read') && hasPermission?.('address_book.read'));
  const enabled = allowed && (!employee || Boolean(employeeCode));
  const scope = `${user?.id || ''}:${employee ? employeeCode : '*'}`;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    const controller = new AbortController();
    setState({ scope, loading: true });
    docflowAPI.listAbsences({ employeeCode: employee ? employeeCode : '', signal: controller.signal })
      .then((data) => {
        if (active) setState({ scope, data });
      })
      .catch((error) => {
        if (!active) return;
        const code = error?.response?.data?.detail?.code;
        setState({ scope, error: code === 'DOCFLOW_CREDENTIALS_REQUIRED' ? 'credentials' : 'unavailable' });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [enabled, scope, employee, employeeCode, attempt]);

  if (!enabled) return null;
  const current = state?.scope === scope ? state : null;
  if (current?.data?.status === 'disabled') return null;
  const items = Array.isArray(current?.data?.items) ? current.data.items : [];
  return (
    <Box sx={{ mt: 1.5 }} data-testid="docflow-absences">
      <Typography variant="subtitle2">Документооборот · отсутствия</Typography>
      {!current || current.loading ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }} role="status">
          <CircularProgress size={16} />
          <Typography variant="caption">Загружаем отсутствия…</Typography>
        </Stack>
      ) : current.error ? (
        <Alert severity="info" sx={{ mt: 0.5 }}>
          {current.error === 'credentials' ? (
            <>Подключите свою учётную запись 1С в разделе <a href="/docflow">«Документооборот»</a>.</>
          ) : (
            <>Отсутствия Документооборота недоступны. <Button size="small" onClick={() => setAttempt((value) => value + 1)}>Повторить</Button></>
          )}
        </Alert>
      ) : current.data?.status !== 'available' ? (
        <Alert severity="info">Не удалось подтвердить состояние списка отсутствий.</Alert>
      ) : (
        <Stack spacing={1} sx={{ mt: 0.5 }}>
          {!items.length ? <Typography variant="body2" color="text.secondary">{employee ? 'Связанных записей об отсутствии нет.' : 'На сегодня записей об отсутствии нет.'}</Typography> : null}
          {items.map((item) => (
            <Box key={item.id} sx={{ borderLeft: '2px solid', borderColor: 'divider', pl: 1 }}>
              {!employee ? <Typography variant="body2" fontWeight={600}>{item.display_name}</Typography> : null}
              <Typography variant="body2">{item.label} · {formatDate(item.starts_on)} — {formatDate(item.ends_on)} включительно</Typography>
              {item.comment ? <Typography variant="body2" sx={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{item.comment}</Typography> : null}
              <Typography variant="caption" color="text.secondary">{item.will_handle_tasks ? 'Будет разбирать задачи' : 'Не будет разбирать задачи'}</Typography>
              {item.differences?.length ? <Box><Chip size="small" color="warning" variant="outlined" label="Данные отличаются от ЗУП" /></Box> : null}
              {!employee && item.matching_status === 'unresolved' ? <Typography variant="caption" display="block" color="text.secondary">Связь с адресной книгой не подтверждена</Typography> : null}
            </Box>
          ))}
          {current.data.zup_comparison === 'unavailable' ? <Typography variant="caption" color="text.secondary">Сравнение с ЗУП недоступно: актуальность данных не подтверждена.</Typography> : null}
          {employee && current.data.unresolved_count > 0 ? <Typography variant="caption" color="text.secondary">Часть записей Документооборота не сопоставлена с адресной книгой.</Typography> : null}
          <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
            <Typography variant="caption" color="text.secondary">Источник: 1С:Документооборот · {current.data.count} записей{current.data.as_of ? ` · получено ${new Date(current.data.as_of).toLocaleTimeString('ru-RU')}` : ''}</Typography>
            <Button size="small" onClick={() => setAttempt((value) => value + 1)}>Обновить отсутствия</Button>
          </Stack>
        </Stack>
      )}
    </Box>
  );
}
