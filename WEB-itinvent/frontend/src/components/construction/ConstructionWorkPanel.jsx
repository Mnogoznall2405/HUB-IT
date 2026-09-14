import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, LinearProgress, MenuItem, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Typography, Slider,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import RestoreRoundedIcon from '@mui/icons-material/RestoreRounded';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import { useAuth } from '../../contexts/AuthContext';
import { constructionWorkAPI } from '../../api/constructionWork';
import { emptyWorkPlan, localWorkDate, PLAN_FIELDS, workCountLabel, workError, workNumber } from './constructionWorkUtils';
import { useConstructionWorkLeaveGuard } from './useConstructionWorkLeaveGuard';

const dayLabels = { quantity: 'Выполнено за смену', engineers: 'ИТР', installers: 'Монтажники', comment: 'Комментарий за смену' };

export function WorkTableScroll({ children, ...props }) {
  const viewport = useRef(null);
  const [scroll, setScroll] = useState({ left: 0, max: 0 });
  useEffect(() => {
    const table = viewport.current?.querySelector('table');
    const measure = () => {
      const element = viewport.current;
      if (element) setScroll({ left: element.scrollLeft, max: Math.max(0, element.scrollWidth - element.clientWidth) });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    if (table) observer.observe(table);
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  const move = (direction) => viewport.current?.scrollBy({ left: direction * viewport.current.clientWidth * 0.7, behavior: 'smooth' });
  return <Box sx={{ minWidth: 0 }}>
    <Stack direction="row" alignItems="center" spacing={2} role="region" aria-label="Горизонтальная прокрутка таблицы" sx={{ mb: 0.5 }}>
      <Button size="small" aria-label="Прокрутить таблицу влево" disabled={scroll.left <= 0} onClick={() => move(-1)} sx={{ minWidth: 32 }}><ArrowBackRoundedIcon fontSize="small" /></Button>
      <Slider aria-label="Положение горизонтальной прокрутки" min={0} max={Math.max(1, scroll.max)} value={Math.min(scroll.left, scroll.max)} disabled={!scroll.max}
        onChange={(_, value) => { if (viewport.current) viewport.current.scrollLeft = value; }}
        sx={{ flex: 1, minWidth: 0, py: 1, '& .MuiSlider-thumb': { width: 36, height: 12, borderRadius: 1 }, '& .MuiSlider-rail': { height: 6 }, '& .MuiSlider-track': { height: 6 } }} />
      <Button size="small" aria-label="Прокрутить таблицу вправо" disabled={scroll.left >= scroll.max - 1} onClick={() => move(1)} sx={{ minWidth: 32 }}><ArrowForwardRoundedIcon fontSize="small" /></Button>
    </Stack>
    <TableContainer {...props} ref={viewport} onScroll={(event) => { const element = event.currentTarget; setScroll({ left: element.scrollLeft, max: Math.max(0, element.scrollWidth - element.clientWidth) }); }}>{children}</TableContainer>
  </Box>;
}

function WorkComment({ text, label }) {
  const [open, setOpen] = useState(false);
  if (!text) return '—';
  return <>
    <Button color="inherit" onClick={() => setOpen(true)} aria-label={`Открыть ${label}`} sx={{ display: 'block', width: '100%', p: 0, textAlign: 'left', textTransform: 'none', fontSize: 'inherit', fontWeight: 400 }}>
      <Box component="span" sx={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 1, overflow: 'hidden', overflowWrap: 'anywhere', lineHeight: 1.4 }}>{text}</Box>
      <Box component="span" sx={{ color: 'primary.main', fontSize: 12 }}>Читать полностью</Box>
    </Button>
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm" aria-label={label}>
      <DialogTitle>{label}</DialogTitle>
      <DialogContent><Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</Typography></DialogContent>
      <DialogActions><Button onClick={() => setOpen(false)}>Закрыть</Button></DialogActions>
    </Dialog>
  </>;
}
const dateColumns = ['planned_start', 'revised_start', 'actual_start', 'planned_end', 'revised_end', 'actual_end'];
const historyValue = (value) => typeof value === 'boolean' ? (value ? 'Да' : 'Нет') : value == null || value === '' ? '—' : /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value).split('-').reverse().join('.') : String(value);
const calendarWeeks = (day) => Array.from({ length: 12 }, (_, index) => {
  const start = new Date(`${day.slice(0, 7)}-01T12:00:00`);
  start.setDate(start.getDate() + index * 7);
  const end = new Date(start); end.setDate(end.getDate() + 6);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { start: iso(start), end: iso(end), label: `${start.getDate()}.${start.getMonth() + 1}` };
});

function WorkHistory({ objectId, groupRef, item, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const loadId = useRef(0);
  const load = async (cursor) => {
    const id = ++loadId.current;
    setLoading(true); setError('');
    try {
      const result = await constructionWorkAPI.history(objectId, groupRef, item.id, cursor);
      if (loadId.current === id) setData((prev) => ({ ...result, items: cursor ? [...(prev?.items || []), ...result.items] : result.items }));
    } catch (err) { if (loadId.current === id) setError(workError(err)); }
    finally { if (loadId.current === id) setLoading(false); }
  };
  useEffect(() => { load(); return () => { loadId.current += 1; }; }, [item.id]);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" aria-labelledby="work-history-title">
      <DialogTitle id="work-history-title">История: {item.plan.name}</DialogTitle>
      <DialogContent>
        {loading ? <LinearProgress /> : null}
        {error ? <Alert severity="error" action={<Button onClick={() => load()}>Повторить</Button>}>{error}</Alert> : null}
        {!loading && data?.items.length === 0 ? <Typography>Изменений пока нет.</Typography> : null}
        <Stack spacing={2} sx={{ mt: 1 }}>
          {data?.items.map((entry) => {
            const daily = entry.action === 'day';
            const before = daily ? entry.before?.values : entry.before;
            const after = daily ? entry.after?.values : entry.after;
            const fields = daily ? Object.entries(dayLabels) : [...PLAN_FIELDS, ['archived', 'В архиве']];
            return <Paper key={entry.id} variant="outlined" sx={{ p: 1.5 }}>
              <Typography fontWeight={750}>{entry.actor_name} · {new Date(entry.changed_at).toLocaleString('ru-RU')}</Typography>
              <Typography color="text.secondary">{daily ? `Факт за ${historyValue(entry.after.date)}` : 'План работ'}</Typography>
              {fields.filter(([key]) => before?.[key] !== after?.[key]).map(([key, label]) => (
                <Typography key={key} variant="body2" sx={{ overflowWrap: 'anywhere' }}>{label}: {historyValue(before?.[key])} → {historyValue(after?.[key])}</Typography>
              ))}
            </Paper>;
          })}
        </Stack>
        {data?.next_cursor ? <Button disabled={loading} onClick={() => load(data.next_cursor)}>Более ранние изменения</Button> : null}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Закрыть</Button></DialogActions>
    </Dialog>
  );
}

export default function ConstructionWorkPanel({ objectId, groupRef, initialSection = '', active = true }) {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('construction.write');
  const [day, setDay] = useState(localWorkDate);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [readFailed, setReadFailed] = useState(false);
  const [draft, setDraft] = useState({});
  const [section, setSection] = useState(initialSection);
  const [collapsed, setCollapsed] = useState({});
  const [calendar, setCalendar] = useState(false);
  const [editor, setEditor] = useState(null);
  const [history, setHistory] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [discard, setDiscard] = useState(false);
  const sequence = useRef(0);
  const loadedScope = useRef('');
  const scopeKey = `${objectId}/${groupRef}/${day}`;
  const dirty = Object.keys(draft).length > 0 || Boolean(editor);
  const leaveGuard = useConstructionWorkLeaveGuard(dirty || saving);
  const load = async () => {
    const id = ++sequence.current;
    setLoading(true); setError(''); setReadFailed(false);
    try {
      const result = await constructionWorkAPI.read(objectId, groupRef, { asOf: day, includeArchived: true });
      if (sequence.current === id) { setData(result); loadedScope.current = scopeKey; }
    } catch (err) { if (sequence.current === id) { setError(workError(err)); setReadFailed(true); } }
    finally { if (sequence.current === id) setLoading(false); }
  };
  useEffect(() => {
    if (!active || loadedScope.current === scopeKey) return;
    setData(null); load();
  }, [objectId, groupRef, day, active]);
  useEffect(() => () => { sequence.current += 1; }, []);
  useEffect(() => { setSection(initialSection); }, [initialSection]);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const groups = useMemo(() => {
    const result = new Map();
    for (const item of data?.items || []) {
      if (Boolean(item.plan.archived) !== showArchived) continue;
      if (!result.has(item.plan.section)) result.set(item.plan.section, []);
      result.get(item.plan.section).push(item);
    }
    return [...result.entries()];
  }, [data, showArchived]);
  const visibleSection = groups.some(([name]) => name === section) ? section : '';
  const visibleCount = groups.reduce((count, [, items]) => count + items.length, 0);
  const archivedCount = data?.items.filter((item) => item.plan.archived).length || 0;
  const weeks = useMemo(() => calendarWeeks(day), [day]);
  const changeDay = (item, key, value) => {
    setNotice('');
    if (!draft[item.id] && Object.keys(draft).length >= 300) {
      setError('За одно сохранение можно изменить до 300 работ. Сохраните текущие изменения и продолжите.');
      return;
    }
    setDraft((prev) => ({ ...prev, [item.id]: { ...(prev[item.id] || item.day), [key]: value } }));
  };
  const saveDay = async () => {
    setSaving(true); setError(''); setNotice('');
    try {
      const items = Object.entries(draft).map(([id, values]) => ({
        id, expected_version: data.items.find((i) => i.id === id).version,
        ...values, quantity: String(values.quantity), engineers: Number(values.engineers), installers: Number(values.installers),
      }));
      await constructionWorkAPI.saveDay(objectId, groupRef, day, items);
      setDraft({}); setNotice('Факт за выбранную дату сохранён.'); await load();
    } catch (err) { setError(workError(err)); }
    finally { setSaving(false); }
  };
  const savePlan = async (event) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      await constructionWorkAPI.savePlan(objectId, groupRef, [{ id: editor.id, expected_version: editor.version, plan: editor.plan }]);
      setEditor(null); setNotice('План работы сохранён.'); await load();
    } catch (err) { setError(workError(err)); }
    finally { setSaving(false); }
  };
  const saveArchive = async () => {
    setSaving(true); setError(''); setNotice('');
    try {
      await constructionWorkAPI.savePlan(objectId, groupRef, [{
        id: archiveTarget.id, expected_version: archiveTarget.version,
        plan: { ...archiveTarget.plan, archived: !archiveTarget.plan.archived },
      }]);
      setNotice(archiveTarget.plan.archived ? 'Работа восстановлена в плане.' : 'Работа перенесена в архив. Объёмы и история сохранены.');
      setArchiveTarget(null); await load();
    } catch (err) { setError(workError(err)); }
    finally { setSaving(false); }
  };
  const disabled = loading || saving || readFailed;
  const columns = 19 + (calendar ? 12 : 0);
  return (
    <Stack spacing={1} sx={{ minWidth: 0, maxWidth: '100%', '& .MuiButton-root': { textTransform: 'none', fontWeight: 600, borderRadius: 2 }, '& .MuiAlert-root': { borderRadius: 2 } }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Box sx={(theme) => ({ p: 0.75, display: 'flex', borderRadius: 2, color: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.08) })}><AssignmentOutlinedIcon /></Box>
        <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
            <Typography component="h2" variant="h6" sx={{ fontWeight: 750, letterSpacing: '-0.02em' }}>Ход работ</Typography>
            {data ? <Chip size="small" variant="outlined" label={`${workCountLabel(visibleCount)}${showArchived ? ' в архиве' : ''}`} sx={{ height: 23, borderColor: 'divider', fontSize: 12 }} /> : null}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12, lineHeight: 1.4 }}>Ввод за выбранную дату · выполнение и остаток рассчитываются автоматически.</Typography>
        </Box>
      </Stack>
      <Paper variant="outlined" sx={{ p: 1, borderRadius: 1.5, backgroundImage: 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ flex: '1 1 560px', minWidth: 0 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '140px minmax(0, 1fr)', sm: '150px minmax(160px, 1fr)' }, gap: 1, minWidth: 0, flex: 1, '& .MuiInputBase-root': { fontSize: 13 }, '& .MuiInputBase-input': { py: 0.75 } }}>
        <TextField label="Дата учёта" type="date" size="small" value={day} disabled={dirty || saving}
          sx={{ minWidth: 0, '& input': { fontSize: { xs: 16, sm: 14 }, fontVariantNumeric: 'tabular-nums' } }}
          InputLabelProps={{ shrink: true }} inputProps={{ min: '2000-01-01', max: localWorkDate() }}
          onChange={(e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { setNotice(''); setDay(e.target.value); } }} />
        <TextField select label="Раздел" size="small" value={visibleSection} InputLabelProps={{ shrink: true }} SelectProps={{ displayEmpty: true }} onChange={(e) => setSection(e.target.value)} sx={{ minWidth: 0, maxWidth: '100%' }}>
          <MenuItem value="">Все разделы</MenuItem>{groups.map(([name]) => <MenuItem key={name} value={name}>{name}</MenuItem>)}
        </TextField>
      </Box>
      <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center" sx={{ '& .MuiButton-root': { flex: { xs: 1, sm: 'initial' }, whiteSpace: 'nowrap' } }}>
        <Button size="small" startIcon={<RefreshRoundedIcon />} disabled={loading || saving || dirty} onClick={load}>Обновить таблицу</Button>
        {canWrite && !showArchived ? <Button size="small" startIcon={<AddRoundedIcon />} variant="contained" disableElevation disabled={disabled || dirty} onClick={() => { setNotice(''); setEditor({ id: crypto.randomUUID(), version: 0, plan: { ...emptyWorkPlan(), section: visibleSection } }); }}>Добавить работу</Button> : null}
      </Stack>
      </Stack>
      <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap" sx={{ flex: '0 1 auto', '& .MuiFormControlLabel-label': { fontSize: 12 } }}>
        <FormControlLabel control={<Checkbox size="small" checked={calendar} onChange={(e) => setCalendar(e.target.checked)} />} label={<Typography variant="body2">Календарь по неделям</Typography>} sx={{ ml: -0.75, my: -0.5 }} />
        <FormControlLabel control={<Checkbox size="small" checked={showArchived} disabled={dirty || saving} onChange={(e) => { setShowArchived(e.target.checked); setSection(''); }} />} label={<Typography variant="body2">Архив работ ({archivedCount})</Typography>} sx={{ ml: -0.75, my: -0.5 }} />
        
      </Stack>
      </Paper>
      {loading ? <LinearProgress aria-label="Загрузка таблицы работ" /> : null}
      {error ? <Alert severity="error">{error}{Object.keys(draft).length ? ' Ваши правки сохранены в открытой таблице; при конфликте сверьте их через историю перед отменой и обновлением.' : ''}</Alert> : null}
      {notice ? <Alert severity="success">{notice}</Alert> : null}
      {canWrite && Object.keys(draft).length > 0 ? <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center" sx={(theme) => ({ p: 1.5, border: '1px solid', borderColor: alpha(theme.palette.primary.main, 0.25), bgcolor: alpha(theme.palette.primary.main, 0.05), borderRadius: 2 })}>
        <Typography variant="body2" fontWeight={600} sx={{ flex: { xs: '1 1 100%', sm: 1 } }}>Есть несохранённые изменения</Typography>
        <Button variant="contained" disableElevation startIcon={<SaveOutlinedIcon />} disabled={saving || loading} onClick={saveDay}>Сохранить за {day} ({Object.keys(draft).length})</Button>
        <Button disabled={saving} onClick={() => setDiscard(true)}>Отменить правки</Button>
      </Stack> : null}
      {showArchived ? <Alert severity="info">Архивные работы сохраняют объёмы и историю, но не участвуют в расчёте готовности. Для внесения факта восстановите работу.</Alert> : null}
      {!loading && data && !visibleCount ? <Alert severity="info">{showArchived ? 'В архиве пока нет работ.' : 'План пока пуст. Добавьте раздел и первую работу. Для уже начатых работ укажите начальный выполненный объём и его дату.'}</Alert> : null}
      {visibleCount > 100 && !visibleSection ? <Typography variant="body2" color="text.secondary">Большой план показан по разделам. Выберите раздел сверху или раскройте его строку для ввода.</Typography> : null}
      {visibleCount > 0 ? (
        <WorkTableScroll component={Paper} variant="outlined" tabIndex={0} role="region" aria-label="Таблица хода работ с горизонтальной прокруткой"
          sx={{ maxHeight: '65vh', overflow: 'auto', width: '100%', borderRadius: 1.5, backgroundImage: 'none', '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } }}>
          <Table stickyHeader size="small" sx={(theme) => ({ tableLayout: 'fixed', width: calendar ? 2958 : 2238, minWidth: '100%', fontVariantNumeric: 'tabular-nums', '& td, & th': { verticalAlign: 'middle', px: 0.75, py: 0.5, fontSize: 13, lineHeight: 1.4, borderRight: '1px solid', borderRightColor: alpha(theme.palette.divider, 0.5) }, '& thead th': { bgcolor: theme.palette.mode === 'dark' ? theme.palette.background.default : theme.palette.grey[50], fontWeight: 650, color: 'text.secondary', fontSize: 12, py: 1 }, '& tbody tr:last-child td, & tbody tr:last-child th': { borderBottom: 0 } })}>
            <colgroup>{[260, 54, 100, 104, 88, 72, 100, 76, 98, ...Array(6).fill(96), 160, 160, 160, 230, ...(calendar ? Array(12).fill(60) : [])].map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
            <TableHead>
              <TableRow sx={{ '& th': { height: 32, boxSizing: 'border-box', whiteSpace: 'nowrap' } }}>
                <TableCell rowSpan={2} sx={{ position: 'sticky', left: { xs: 'auto', sm: 0 }, zIndex: 4, minWidth: 0 }}>Вид работ</TableCell>
                <TableCell rowSpan={2} align="center" sx={{ minWidth: 0 }}>Ед. изм.</TableCell>
                <TableCell colSpan={5} align="center">Объёмы и выполнение</TableCell>
                <TableCell colSpan={2} align="center">Персонал за смену</TableCell>
                <TableCell colSpan={3} align="center">Начало работ</TableCell>
                <TableCell colSpan={3} align="center">Окончание работ</TableCell>
                <TableCell colSpan={3} align="center">Комментарии</TableCell>
                <TableCell rowSpan={2}>Действия</TableCell>
                {calendar ? <TableCell colSpan={12} align="center">Календарь по неделям</TableCell> : null}
              </TableRow>
              <TableRow sx={{ '& th': { top: 32, whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.25 } }}>
                {['По проекту', 'Выполнено всего', 'За смену', 'Остаток', '% выполнения', 'ИТР', 'Монтажники', 'План', 'Корректировка', 'Факт', 'План', 'Корректировка', 'Факт', 'Поставка ТМЦ', 'Производство', 'За смену'].map((label, index) => <TableCell key={`${index}-${label}`}
                  sx={(theme) => ({ ...(index === 2 || index === 5 || index === 6 || index === 15 ? { color: `${theme.palette.primary.main} !important`, boxShadow: `inset 0 -2px ${alpha(theme.palette.primary.main, 0.4)}` } : {}) })}>{label}</TableCell>)}
                {calendar ? weeks.map((week) => <TableCell key={week.start} align="center">{week.label}</TableCell>) : null}
              </TableRow>
            </TableHead>
            <TableBody>
              {groups.filter(([name]) => !visibleSection || name === visibleSection).map(([name, items]) => (
                <WorkSection key={name} {...{ name, items, collapsed, setCollapsed, columns, calendar, weeks, draft, changeDay, disabled, canWrite, setEditor, setHistory, setArchiveTarget }} defaultCollapsed={visibleCount > 100 && !visibleSection} hasDraft={Object.keys(draft).length > 0} />
              ))}
            </TableBody>
          </Table>
        </WorkTableScroll>
      ) : null}
      {data?.items.length > 0 ? <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>Таблица прокручивается по горизонтали. Объёмы «всего» и остаток показаны на {day.split('-').reverse().join('.')}.</Typography> : null}
      {calendar ? <Typography variant="caption">Календарь: синий — план, оранжевый — скорректированные сроки, зелёный — фактические сроки. Показаны 12 недель с начала выбранного месяца.</Typography> : null}
      <Dialog open={Boolean(editor)} onClose={() => { if (!saving) setDiscard(true); }} fullWidth maxWidth="md" aria-labelledby="work-plan-title" PaperProps={{ sx: { borderRadius: 1.5, backgroundImage: 'none' } }}>
        <Box component="form" onSubmit={savePlan}>
          <DialogTitle id="work-plan-title" sx={{ fontWeight: 700, borderBottom: '1px solid', borderColor: 'divider', mb: 2 }}>{editor?.version ? 'Изменить план работы' : 'Добавить работу'}</DialogTitle>
          <DialogContent>
            {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2, lineHeight: 1.6 }}>Вес определяет вклад работы в общую готовность. Используйте единый принцип для всех работ объекта, например плановые трудозатраты.</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, pt: 1 }}>
              {PLAN_FIELDS.map(([key, label, type = 'text']) => (
                <TextField key={key} label={label} type={type} value={editor?.plan[key] ?? ''} disabled={saving}
                  size="small" sx={{ '& input': { fontSize: { xs: 16, sm: 14 } }, ...(key === 'name' || key.endsWith('comment') ? { gridColumn: '1 / -1' } : {}) }}
                  required={['section', 'name', 'unit', 'planned_quantity'].includes(key)}
                  multiline={type === 'text' && key.endsWith('comment')} minRows={type === 'text' && key.endsWith('comment') ? 2 : undefined}
                  InputLabelProps={type === 'date' ? { shrink: true } : undefined}
                  inputProps={type === 'number' ? { min: 0, max: 999999999, step: '0.0001' } : type === 'date' ? { min: '2000-01-01', max: key === 'initial_date' || key.startsWith('actual_') ? localWorkDate() : '2100-12-31' } : { maxLength: key.endsWith('comment') ? 2000 : key === 'name' ? 500 : key === 'unit' ? 32 : 200 }}
                  onChange={(e) => { const value = e.target.value; setEditor((prev) => ({ ...prev, plan: { ...prev.plan, [key]: value === '' && (type === 'date' || key === 'weight') ? null : value } })); }} />
              ))}
            </Box>
          </DialogContent>
          <DialogActions sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}><Button disabled={saving} onClick={() => setDiscard(true)}>Отмена</Button><Button type="submit" variant="contained" disableElevation startIcon={<SaveOutlinedIcon />} disabled={saving}>Сохранить план</Button></DialogActions>
        </Box>
      </Dialog>
      <Dialog open={Boolean(archiveTarget)} onClose={() => { if (!saving) setArchiveTarget(null); }} aria-labelledby="archive-work-title">
        <DialogTitle id="archive-work-title">{archiveTarget?.plan.archived ? 'Восстановить работу?' : 'Перенести работу в архив?'}</DialogTitle>
        <DialogContent>
          {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
          <Typography fontWeight={600} sx={{ mb: 1 }}>{archiveTarget?.plan.name}</Typography>
          <Typography>{archiveTarget?.plan.archived ? 'Работа снова появится в плане и будет учитываться в общей готовности.' : 'Объёмы и история сохранятся. Работа перестанет учитываться в общей готовности; её можно восстановить из архива.'}</Typography>
        </DialogContent>
        <DialogActions><Button disabled={saving} onClick={() => setArchiveTarget(null)}>Отмена</Button><Button variant="contained" disabled={saving} onClick={saveArchive}>{archiveTarget?.plan.archived ? 'Восстановить' : 'В архив'}</Button></DialogActions>
      </Dialog>
      <Dialog open={discard} onClose={() => setDiscard(false)} aria-labelledby="discard-work-title">
        <DialogTitle id="discard-work-title">Отменить несохранённые правки?</DialogTitle>
        <DialogActions><Button onClick={() => setDiscard(false)}>Продолжить ввод</Button><Button onClick={() => { setDraft({}); setEditor(null); setDiscard(false); load(); }}>Отменить правки</Button></DialogActions>
      </Dialog>
      <Dialog open={leaveGuard.pending} onClose={leaveGuard.cancel} aria-labelledby="leave-work-title">
        <DialogTitle id="leave-work-title">В таблице остались несохранённые изменения</DialogTitle>
        <DialogContent>{saving ? 'Дождитесь завершения сохранения.' : 'При переходе введённые правки будут потеряны.'}</DialogContent>
        <DialogActions><Button onClick={leaveGuard.cancel}>Остаться в таблице</Button><Button disabled={saving} onClick={() => { setDraft({}); setEditor(null); leaveGuard.leave(); }}>Уйти без сохранения</Button></DialogActions>
      </Dialog>
      {history ? <WorkHistory key={history.id} {...{ objectId, groupRef }} item={history} onClose={() => setHistory(null)} /> : null}
    </Stack>
  );
}

function WorkSection({ name, items, collapsed, setCollapsed, columns, calendar, weeks, draft, changeDay, disabled, canWrite, setEditor, setHistory, setArchiveTarget, hasDraft, defaultCollapsed = false }) {
  const isCollapsed = collapsed[name] ?? defaultCollapsed;
  return <>
    <TableRow><TableCell colSpan={columns} sx={(theme) => ({ bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.12 : 0.055), py: '2px !important' })}>
      <Button size="small" color="inherit" startIcon={<ExpandMoreRoundedIcon sx={{ transform: isCollapsed ? 'rotate(-90deg)' : 'none' }} />}
        onClick={() => setCollapsed((prev) => ({ ...prev, [name]: !isCollapsed }))} aria-expanded={!isCollapsed} sx={{ textTransform: 'none', fontWeight: 700, textAlign: 'left', lineHeight: 1.4 }}>
        {name}<Chip component="span" size="small" label={workCountLabel(items.length)} sx={{ ml: 1.5, height: 21, fontSize: 11, bgcolor: 'background.paper', color: 'text.secondary' }} />
      </Button>
    </TableCell></TableRow>
    {!isCollapsed ? items.map((item, index) => {
      const day = draft[item.id] || item.day;
      const input = (key, label) => canWrite && !item.plan.archived ? <TextField size="small" value={day[key]} type={key === 'comment' ? 'text' : 'number'} disabled={disabled}
        inputProps={{ 'aria-label': `${label}: ${item.plan.name}`, ...(key === 'comment' ? { maxLength: 2000 } : { min: 0, step: key === 'quantity' ? '0.0001' : '1', max: key === 'quantity' ? 999999999 : 10000 }) }}
        onChange={(e) => changeDay(item, key, e.target.value)} sx={(theme) => ({ width: '100%', minWidth: 0, '& .MuiOutlinedInput-root': { borderRadius: 1.5, bgcolor: 'background.paper', '& fieldset': { borderColor: alpha(theme.palette.primary.main, 0.24) } }, '& input': { px: 0.75, py: 0.5, fontSize: { xs: 16, sm: 13 }, textAlign: key === 'comment' ? 'left' : 'right', fontVariantNumeric: 'tabular-nums' } })} /> : key === 'comment' ? <WorkComment text={day[key]} label={`Комментарий за смену: ${item.plan.name}`} /> : workNumber(day[key]);
      return <TableRow key={item.id} sx={(theme) => ({ bgcolor: draft[item.id] ? alpha(theme.palette.primary.main, 0.07) : undefined, '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.035) } })}>
        <TableCell component="th" scope="row" sx={{ position: { xs: 'static', sm: 'sticky' }, left: { xs: 'auto', sm: 0 }, bgcolor: 'background.paper', zIndex: 1, maxWidth: 320, overflowWrap: 'anywhere', borderLeft: '3px solid', borderLeftColor: draft[item.id] ? 'primary.main' : 'transparent' }}>
          <Stack direction="row" spacing={1.25} alignItems="flex-start"><Typography variant="caption" color="text.secondary" sx={{ mt: 0.15, flexShrink: 0 }}>{String(index + 1).padStart(2, '0')}</Typography><Typography variant="body2" fontWeight={600} sx={{ lineHeight: 1.45 }}>{item.plan.name}</Typography></Stack>
        </TableCell>
        <TableCell align="center" sx={{ color: 'text.secondary' }}>{item.plan.unit}</TableCell><TableCell align="right">{workNumber(item.plan.planned_quantity)}</TableCell><TableCell align="right" sx={{ fontWeight: 700 }}>{workNumber(item.total_quantity)}</TableCell>
        <TableCell sx={(theme) => ({ bgcolor: alpha(theme.palette.primary.main, 0.035) })}>{input('quantity', 'За смену')}</TableCell><TableCell align="right">{workNumber(item.remaining_quantity)}</TableCell>
        <TableCell sx={{ minWidth: 0, color: item.percent > 100 || item.overdue ? 'warning.main' : undefined }}>
          <Typography variant="body2" fontWeight={700}>{item.percent == null ? '—' : `${workNumber(item.percent, 2)}%`}</Typography>
          {item.percent != null ? <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, item.percent))} color={item.percent > 100 || item.overdue ? 'warning' : item.percent >= 100 ? 'success' : 'primary'} aria-label={`Выполнение: ${item.plan.name}`} sx={{ height: 4, borderRadius: 1, mt: 0.75, mb: 0.25 }} /> : null}
          {item.overdue ? <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>Просрочено</Typography> : null}
        </TableCell>
        <TableCell>{input('engineers', 'ИТР')}</TableCell><TableCell>{input('installers', 'Монтажники')}</TableCell>
        {dateColumns.map((key) => <TableCell key={key} sx={{ whiteSpace: 'nowrap', color: item.plan[key] ? 'text.primary' : 'text.disabled' }}>{item.plan[key]?.split('-').reverse().join('.') || '—'}</TableCell>)}
        <TableCell sx={{ minWidth: 0, maxWidth: 160, overflowWrap: 'anywhere', color: 'text.secondary' }}>{<WorkComment text={item.plan.material_comment} label={`Материалы: ${item.plan.name}`} />}</TableCell><TableCell sx={{ minWidth: 0, maxWidth: 160, overflowWrap: 'anywhere', color: 'text.secondary' }}>{<WorkComment text={item.plan.production_comment} label={`Производство: ${item.plan.name}`} />}</TableCell>
        <TableCell>{input('comment', 'Комментарий за смену')}</TableCell>
        <TableCell><Stack direction="row" spacing={0.5} sx={{ '& .MuiButton-root': { whiteSpace: 'nowrap', minWidth: 0, fontSize: 12 } }}>
          {canWrite && !item.plan.archived ? <Button size="small" startIcon={<EditOutlinedIcon sx={{ fontSize: '16px !important' }} />} disabled={disabled || hasDraft} onClick={() => setEditor({ id: item.id, version: item.version, plan: { ...item.plan } })}>План</Button> : null}
          <Button size="small" color="inherit" startIcon={<HistoryRoundedIcon sx={{ fontSize: '16px !important' }} />} onClick={() => setHistory(item)}>История</Button>
          {canWrite ? <Button size="small" color="inherit" startIcon={item.plan.archived ? <RestoreRoundedIcon /> : <ArchiveOutlinedIcon />} disabled={disabled || hasDraft} onClick={() => setArchiveTarget(item)}>{item.plan.archived ? 'Восстановить' : 'В архив'}</Button> : null}
        </Stack></TableCell>
        {calendar ? weeks.map((week) => <TableCell key={week.start} sx={{ minWidth: 55 }}>
          {['planned', 'revised', 'actual'].map((prefix, index) => {
            const start = item.plan[`${prefix}_start`], end = item.plan[`${prefix}_end`];
            const active = start && end && start <= week.end && end >= week.start;
            return <Box key={prefix} title={`${['План', 'Корректировка', 'Факт'][index]}: ${start || '—'} — ${end || '—'}`} sx={{ height: 6, my: 0.75, borderRadius: 1, bgcolor: active ? ['primary.main', 'warning.main', 'success.main'][index] : 'action.hover' }} />;
          })}
        </TableCell>) : null}
      </TableRow>;
    }) : null}
  </>;
}
