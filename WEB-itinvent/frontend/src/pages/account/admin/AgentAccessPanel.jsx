import { useEffect, useRef, useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Button, CircularProgress, FormControlLabel, Stack, Switch, TextField, Typography } from '@mui/material';
import ExpandMoreOutlinedIcon from '@mui/icons-material/ExpandMoreOutlined';
import { aiBotAccess } from '../../../api/aiBotAccess';

export default function AgentAccessPanel({ botId, userId, embedded = false }) {
  const [open, setOpen] = useState(embedded);
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const version = ++generation.current;
    if (!open) return undefined;
    setLoading(true);
    setError('');
    const timer = setTimeout(async () => {
      try {
        const result = botId ? await aiBotAccess.users(botId, { q: query, offset, limit: 30 }) : await aiBotAccess.agents(userId);
        if (version !== generation.current) return;
        setItems(botId ? result.items : result);
        setHasMore(Boolean(result.has_more));
      } catch (err) {
        if (version === generation.current) setError(err.response?.data?.detail || 'Не удалось загрузить доступ');
      } finally {
        if (version === generation.current) setLoading(false);
      }
    }, query ? 250 : 0);
    return () => { clearTimeout(timer); generation.current += 1; };
  }, [botId, userId, open, query, offset, revision]);

  const update = async (item, allowed) => {
    const key = botId ? item.user_id : item.bot_id;
    const version = generation.current;
    setSaving(key);
    setError('');
    try {
      await aiBotAccess.set(botId || item.bot_id, userId || item.user_id, allowed);
      if (version === generation.current) setItems((rows) => rows.map((row) =>
        (botId ? row.user_id : row.bot_id) === key ? { ...row, allowed } : row));
    } catch (err) {
      setError(err.response?.data?.detail || 'Не удалось изменить доступ');
    } finally {
      setSaving(null);
    }
  };
  return (
    <Accordion expanded={open} onChange={(_, expanded) => setOpen(expanded)} disableGutters>
      <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}><Typography>Доступ к агентам</Typography></AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">
            Администраторам доступны все агенты. Обычный ИИ-чат доступен всем. Изменения доступа сохраняются сразу.
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Отзыв доступа отменяет текущие задания и ожидающие подтверждения. История и полученные файлы сохраняются.
          </Typography>
          {botId && <TextField size="small" label="Найти сотрудника" value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0); }} />}
          {error && <Alert severity="error" action={<Button onClick={() => setRevision((value) => value + 1)}>Повторить</Button>}>{error}</Alert>}
          {loading ? <CircularProgress size={22} aria-label="Загрузка доступа" /> : items.map((item) => {
            const key = botId ? item.user_id : item.bot_id;
            return <FormControlLabel key={key} control={<Switch checked={Boolean(item.allowed)} disabled={item.automatic || saving !== null} onChange={(_, checked) => update(item, checked)} />}
              label={`${item.title}${botId && item.username ? ` (${item.username})` : ''}${item.automatic ? ' — автоматически' : ''}`} />;
          })}
          {!loading && !error && items.length === 0 && <Typography color="text.secondary">Ничего не найдено</Typography>}
          {botId && <Stack direction="row" spacing={1}>
            <Button disabled={!offset || loading || saving !== null} onClick={() => setOffset((value) => Math.max(0, value - 30))}>Назад</Button>
            <Button disabled={!hasMore || loading || saving !== null} onClick={() => setOffset((value) => value + 30)}>Далее</Button>
          </Stack>}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
