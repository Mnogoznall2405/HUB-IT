import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import { aiBalanceAPI } from '../../../api/aiBalance';

const formatNumber = (value) => (
  Number.isFinite(Number(value)) ? Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) : '—'
);
const formatTime = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString('ru-RU') : 'ещё не проверялся';
};

// The line of the AI settings that shows the provider balance and the warning threshold.
export function describeBalanceState(state) {
  if (!state) return { severity: 'info', text: 'Баланс не загружен.' };
  if (state.status === 'error') {
    return { severity: 'warning', text: `Не удалось получить баланс у провайдера${state.error ? `: ${state.error}` : ''}.` };
  }
  if (state.balance === null || state.balance === undefined) {
    return {
      severity: 'info',
      text: state.check_enabled
        ? 'Провайдер не вернул остаток, проверьте формат ответа /credits.'
        : 'Автопроверка баланса выключена (AI_BALANCE_CHECK_ENABLED). Можно проверить вручную.',
    };
  }
  if (state.low) {
    return { severity: 'error', text: `Остаток ${formatNumber(state.balance)} ниже порога ${formatNumber(state.threshold)}. Пополните баланс провайдера.` };
  }
  return {
    severity: 'success',
    text: `Остаток ${formatNumber(state.balance)}${state.threshold > 0 ? `, порог предупреждения ${formatNumber(state.threshold)}` : ', порог не задан'}.`,
  };
}

export default function AiBalanceCard() {
  const [state, setState] = useState(null);
  const [threshold, setThreshold] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const apply = useCallback((next) => {
    setState(next);
    setThreshold(String(next?.threshold ?? 0));
  }, []);

  useEffect(() => {
    let alive = true;
    aiBalanceAPI.get().then((next) => { if (alive) apply(next); }).catch(() => {
      if (alive) setError('Не удалось загрузить состояние баланса.');
    });
    return () => { alive = false; };
  }, [apply]);

  const run = async (key, action) => {
    setBusy(key);
    setError('');
    try {
      apply(await action());
    } catch {
      setError(key === 'save' ? 'Не удалось сохранить порог.' : 'Не удалось проверить баланс.');
    } finally {
      setBusy('');
    }
  };

  const line = describeBalanceState(state);
  const thresholdValid = threshold.trim() !== '' && Number(threshold) >= 0 && Number.isFinite(Number(threshold));
  return (
    <Box data-testid="ai-balance-card" sx={{ mb: 1.5, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 2 }}>
      <Typography variant="subtitle2" fontWeight={800}>Баланс провайдера ИИ</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Лимитов на сотрудников нет: при остатке ниже порога уведомление получают управляющие ИИ.
      </Typography>
      {!state && !error ? <CircularProgress size={18} /> : null}
      {state ? <Alert severity={line.severity} sx={{ mb: 1 }}>{line.text}</Alert> : null}
      {error ? <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert> : null}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
        <TextField
          size="small"
          type="number"
          label="Порог предупреждения"
          value={threshold}
          onChange={(event) => setThreshold(event.target.value)}
          inputProps={{ min: 0, step: 'any', 'aria-label': 'Порог предупреждения о балансе' }}
          sx={{ maxWidth: 240 }}
        />
        <Button
          variant="contained"
          disabled={!thresholdValid || busy !== ''}
          onClick={() => run('save', () => aiBalanceAPI.setThreshold(threshold))}
        >
          Сохранить порог
        </Button>
        <Button disabled={busy !== ''} onClick={() => run('check', () => aiBalanceAPI.check())}>
          Проверить сейчас
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
        Последняя проверка: {formatTime(state?.checked_at)}
      </Typography>
    </Box>
  );
}
