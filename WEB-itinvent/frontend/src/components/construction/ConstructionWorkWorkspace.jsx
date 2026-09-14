import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, LinearProgress, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useAuth } from '../../contexts/AuthContext';
import { constructionWorkAPI as api } from '../../api/constructionWork';
import ConstructionWorkPanel, { WorkTableScroll } from './ConstructionWorkPanel';
import { localWorkDate, workError, workNumber } from './constructionWorkUtils';
import { useConstructionWorkLeaveGuard } from './useConstructionWorkLeaveGuard';

const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const monday = (day) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return iso(d); };
const plus = (day, count) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + count); return iso(d); };
const label = (day) => day.slice(5).split('-').reverse().join('.');
const num = (value) => Number(value || 0);
const numeric = { min: 0, max: 999999999, step: '0.0001' };

export default function ConstructionWorkWorkspace({ objectId, groupRef, active = true, initialSection = '' }) {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('construction.write');
  // Default to the existing journal so the work tab stays usable before weekly
  // planning tables/API are deployed; users can switch to plan/day after that.
  const [mode, setMode] = useState('details');
  const [day, setDay] = useState(localWorkDate);
  const [section, setSection] = useState(initialSection);
  const [search, setSearch] = useState('');
  const [all, setAll] = useState(false);
  const [data, setData] = useState(null);
  const [plan, setPlan] = useState(null);
  const [planDirty, setPlanDirty] = useState(false);
  const [daily, setDaily] = useState({});
  const [attendance, setAttendance] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [crewEditor, setCrewEditor] = useState(null);
  const [history, setHistory] = useState(null);
  const [discard, setDiscard] = useState(false);
  const sequence = useRef(0);
  const dirty = planDirty || Object.keys(daily).length > 0 || Object.keys(attendance).length > 0 || Boolean(crewEditor);
  const leave = useConstructionWorkLeaveGuard(dirty || saving);
  useEffect(() => { if (initialSection) setSection(initialSection); }, [initialSection]);
  useEffect(() => {
    if (!active || mode === 'details' || dirty) return undefined;
    const controller = new AbortController(); const id = ++sequence.current;
    setLoading(true); setError(''); setData(null);
    api.planning(objectId, groupRef, day, controller.signal).then((result) => {
      if (id !== sequence.current || controller.signal.aborted) return;
      setData(result); setPlan(result.plan);
    }).catch((err) => { if (!controller.signal.aborted) setError(workError(err)); })
      .finally(() => { if (id === sequence.current && !controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); };
    // Draft edits must not cancel an in-flight save or refetch the journal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectId, groupRef, day, active, mode === 'details', revision]);
  const sections = useMemo(() => [...new Set((data?.items || []).map(i => i.plan.section))], [data]);
  const targets = Object.fromEntries((plan?.targets || []).map(t => [t.work_id, t.quantity]));
  const weeks = useMemo(() => {
    const first = day.slice(0, 8) + '01'; const next = new Date(`${first}T12:00:00`); next.setMonth(next.getMonth() + 1);
    const result = []; for (let cursor = monday(first); cursor < iso(next); cursor = plus(cursor, 7)) result.push(cursor);
    return result;
  }, [day]);
  const visible = (data?.items || []).filter(i => !i.plan.archived && (!section || i.plan.section === section) && (!search || `${i.plan.name} ${i.plan.section}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) &&
    (mode === 'plan' || all || Object.hasOwn(targets, i.id) || ((i.percent == null || i.percent < 100) && (!i.plan.planned_start || i.plan.planned_start <= day)) || data.recorded_ids.includes(i.id)));
  const rows = visible.slice(0, 200);
  const assignments = (plan?.crews || []).flatMap(c => c.assignments.filter(a => a.group_ref === groupRef).map(a => ({ ...a, crew: c })));
  const editPlan = (next) => { setPlan(next); setPlanDirty(true); setNotice(''); };
  const target = (id, value) => editPlan({ ...plan, targets: [...plan.targets.filter(t => t.work_id !== id), ...(value === '' ? [] : [{ work_id: id, quantity: value }])] });
  const editDay = (item, key, value) => { setDaily(prev => ({ ...prev, [item.id]: { ...item.day, ...prev[item.id], [key]: value } })); setNotice(''); };
  const reset = () => { setPlanDirty(false); setDaily({}); setAttendance({}); setCrewEditor(null); setRevision(n => n + 1); setDiscard(false); };
  const save = async () => {
    setSaving(true); setError('');
    try {
      if (planDirty) await api.saveWeek(objectId, groupRef, { week_start: data.week_start, expected_version: data.week_version, plan });
      else await api.saveSummary(objectId, groupRef, { work_date: day, expected_week_version: data.week_version, expected_crew_version: data.crew_version,
        items: Object.entries(daily).map(([id, values]) => ({ id, expected_version: data.items.find(i => i.id === id).version, ...values })),
        crews: Object.entries(attendance).map(([id, values]) => ({ assignment_id: id, ...values })) });
      reset(); setNotice(planDirty ? 'Недельный план сохранён. Первый вариант сохранён как исходный.' : 'Сводка сохранена. Недельный факт обновлён.');
    } catch (err) { setError(workError(err)); } finally { setSaving(false); }
  };
  const openHistory = async () => {
    setHistory({ items: [], loading: true });
    try { setHistory({ ...await api.planningHistory(objectId, groupRef, mode === 'plan' ? data.week_start : day), loading: false }); }
    catch (err) { setHistory({ items: [], error: workError(err) }); }
  };
  const copyPrevious = async () => {
    setSaving(true); setError('');
    try {
      const previous = await api.planning(objectId, groupRef, plus(data.week_start, -7));
      if (!previous.week_version) { setNotice('За предыдущую неделю план не заполнен.'); return; }
      editPlan(structuredClone(previous.plan));
      setNotice('План предыдущей недели скопирован в черновик для всего объекта. Проверьте объёмы и назначения перед сохранением.');
    } catch (err) { setError(workError(err)); } finally { setSaving(false); }
  };
  const saveCrew = () => {
    const draft = crewEditor;
    const workIds = data.items.filter(i => i.plan.section === draft.section && !i.plan.archived).map(i => i.id);
    if (!workIds.length || !draft.name.trim() || !draft.specialty.trim()) { setCrewEditor({ ...draft, error: 'Укажите бригаду, специальность и раздел работ' }); return; }
    const crew = plan.crews.find(c => c.id === draft.crewId);
    if (['available', 'required', 'assigned'].some(k => !Number.isInteger(Number(draft[k])) || Number(draft[k]) < 0 || Number(draft[k]) > 10000) || num(draft.assigned) + (crew?.assignments || []).reduce((s, a) => s + num(a.assigned), 0) > num(draft.available)) {
      setCrewEditor({ ...draft, error: 'Укажите целое число людей от 0 до 10 000. Назначения не должны превышать доступный состав бригады.' }); return;
    }
    const assignment = { id: crypto.randomUUID(), name: draft.section, group_ref: groupRef, work_ids: workIds, required: num(draft.required), assigned: num(draft.assigned) };
    const updated = crew ? { ...crew, assignments: [...crew.assignments, assignment] } : { id: crypto.randomUUID(), name: draft.name, specialty: draft.specialty, available: num(draft.available), assignments: [assignment] };
    editPlan({ ...plan, crews: [...plan.crews.filter(c => c.id !== updated.id), updated] }); setCrewEditor(null);
  };
  const disabled = !canWrite || loading || saving || !data;
  return <Stack spacing={1} sx={{ minWidth: 0, '& .MuiButton-root': { textTransform: 'none' } }}>
    <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
      <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, value) => { if (value) { setMode(value); if (value === 'day' && day > localWorkDate()) setDay(localWorkDate()); } }} disabled={dirty || saving} sx={{ width: { xs: '100%', sm: 'auto' }, '& button': { flex: { xs: 1, sm: 'initial' }, px: 1, lineHeight: 1.3 } }}>
        <ToggleButton value="plan">Планирование</ToggleButton><ToggleButton value="day">Сводка за день</ToggleButton><ToggleButton value="details">Работы и история</ToggleButton>
      </ToggleButtonGroup>
      {mode !== 'details' ? <><TextField size="small" type="date" label={mode === 'plan' ? 'Дата недели' : 'Дата сводки'} value={day} disabled={dirty || saving} InputLabelProps={{ shrink: true }} inputProps={{ min: '2000-01-01', max: mode === 'day' ? localWorkDate() : '2100-12-31' }} onChange={e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) setDay(e.target.value); }} sx={{ width: 165 }} />
        <Button disabled={dirty || saving || loading} onClick={() => setRevision(n => n + 1)}>Обновить</Button></> : null}
    </Stack>
    {mode === 'details' ? <ConstructionWorkPanel {...{ objectId, groupRef, active, initialSection }} /> : <>
      {loading ? <LinearProgress aria-label="Загрузка планирования" /> : null}
      {error ? <Alert severity="error">{error}{dirty ? ' Введённые значения сохранены в открытом черновике.' : ''}</Alert> : null}
      {notice ? <Alert severity="success">{notice}</Alert> : null}
      {data && plan ? <>
        <Typography variant="body2" color="text.secondary">{mode === 'plan' ? 'Задайте объёмы недели и назначьте людей. Факт поступает из ежедневных сводок.' : 'Вводите только выполненное за выбранный день. Пусто — сводка не заполнена; 0 — не работали.'}</Typography>
        <Stack direction="row" gap={1} flexWrap="wrap">
          <TextField select size="small" label="Раздел работ" value={sections.includes(section) ? section : ''} onChange={e => setSection(e.target.value)} sx={{ width: { xs: '100%', sm: 350 } }}><MenuItem value="">Все разделы</MenuItem>{sections.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}</TextField>
          <TextField size="small" label="Поиск работы" value={search} onChange={e => setSearch(e.target.value)} />
          {mode === 'day' ? <FormControlLabel control={<Checkbox checked={all} onChange={e => setAll(e.target.checked)} />} label="Все работы, включая завершённые" /> : null}
          <Button onClick={openHistory}>История {mode === 'plan' ? 'плана' : 'состава'}</Button>
          {mode === 'plan' && canWrite && !data.week_version ? <Button disabled={dirty || saving} onClick={copyPrevious}>Скопировать прошлую неделю</Button> : null}
        </Stack>
        {visible.length > 200 ? <Alert severity="info">Показаны первые 200 из {visible.length} работ. Выберите раздел или уточните поиск.</Alert> : null}
        {!rows.length ? <Alert severity="info">Работ по выбранному фильтру нет. Создать работу можно в режиме «Работы и история».</Alert> : null}
        <Typography variant="caption" color="text.secondary">Факт недель и месяца — по дневным сводкам. Исходный выполненный объём входит в общий процент и остаток.</Typography>
        <WorkTableScroll component={Paper} variant="outlined" tabIndex={0} role="region" aria-label="План и ежедневная сводка" sx={{ maxHeight: '60vh', overflow: 'auto', borderRadius: 1.5 }}>
          <Table size="small" stickyHeader sx={{ minWidth: mode === 'plan' ? 1100 : 1050, '& th, & td': { py: 0.5, px: 1, fontSize: 13 }, '& input': { py: 0.75, px: 1 }, '& .MuiTextField-root': { minWidth: 85 } }}>
            <TableHead><TableRow><TableCell sx={{ minWidth: 260 }}>Работа</TableCell><TableCell>Ед.</TableCell><TableCell>Общий план</TableCell>
              {mode === 'plan' ? <><TableCell>Остаток работ</TableCell><TableCell>По сводкам за месяц</TableCell>{weeks.map(w => <TableCell key={w}><Button size="small" disabled={dirty || saving} variant={w === data.week_start ? 'contained' : 'text'} onClick={() => setDay(w < day.slice(0, 8) + '01' ? day.slice(0, 8) + '01' : w)}>{label(w)}–{label(plus(w, 6))}</Button><Typography variant="caption" display="block">План / факт</Typography></TableCell>)}</> : <><TableCell>План недели</TableCell><TableCell>За день</TableCell><TableCell>Факт недели</TableCell><TableCell>Всего / %</TableCell><TableCell>Остаток</TableCell><TableCell>Комментарий</TableCell></>}
            </TableRow></TableHead>
            <TableBody>{rows.map(item => {
              const draft = daily[item.id]; const initialBlocked = item.plan.initial_date && day <= item.plan.initial_date;
              const left = item.remaining_quantity;
              return <TableRow key={item.id}><TableCell component="th" scope="row" sx={{ position: { sm: 'sticky' }, left: 0, bgcolor: 'background.paper', zIndex: 1, maxWidth: 300 }}><Typography variant="body2" fontWeight={600}>{item.plan.name}</Typography></TableCell><TableCell>{item.plan.unit}</TableCell><TableCell>{workNumber(item.plan.planned_quantity)}</TableCell>
                {mode === 'plan' ? <><TableCell sx={{ color: left < 0 ? 'warning.main' : 'text.secondary' }}>{workNumber(left)}</TableCell><TableCell>{workNumber(data.month_totals?.[item.id] ?? 0)}</TableCell>{weeks.map(w => <TableCell key={w}>{w === data.week_start ? <TextField type="number" size="small" disabled={disabled} value={targets[item.id] ?? ''} inputProps={{ ...numeric, 'aria-label': `План недели: ${item.plan.name}` }} onChange={e => target(item.id, e.target.value)} /> : workNumber((data.month_plans[w] || []).find(t => t.work_id === item.id)?.quantity ?? 0)}{w === data.week_start && data.baseline ? <Typography variant="caption" display="block" color="text.secondary">Первый план: {workNumber(data.baseline.targets.find(t => t.work_id === item.id)?.quantity ?? 0)}</Typography> : null}<Typography variant="caption" display="block" color="text.secondary">Факт: {Object.hasOwn(data.month_actual[w] || {}, item.id) ? workNumber(data.month_actual[w][item.id]) : '—'}</Typography></TableCell>)}</> : <>
                  <TableCell>{Object.hasOwn(targets, item.id) ? workNumber(targets[item.id]) : 'Вне плана'}</TableCell>
                  <TableCell><TextField type="number" size="small" disabled={disabled || initialBlocked} value={draft?.quantity ?? (data.recorded_ids.includes(item.id) ? item.day.quantity : '')} inputProps={{ ...numeric, 'aria-label': `За день: ${item.plan.name}` }} onChange={e => editDay(item, 'quantity', e.target.value)} />{initialBlocked ? <Typography variant="caption" display="block">Включено в исходный срез {label(item.plan.initial_date)}</Typography> : null}</TableCell>
                  <TableCell>{Object.hasOwn(data.weekly_actual, item.id) ? workNumber(data.weekly_actual[item.id]) : '—'}{num(targets[item.id]) > 0 ? <Typography variant="caption" display="block" color={data.week_end < localWorkDate() && num(data.weekly_actual[item.id]) < num(targets[item.id]) ? 'warning.main' : 'text.secondary'}>{data.week_end < localWorkDate() ? 'Недовыполнено' : 'До плана'}: {workNumber(Math.max(0, num(targets[item.id]) - num(data.weekly_actual[item.id])))}</Typography> : null}</TableCell><TableCell>{workNumber(item.total_quantity)} / {item.percent == null ? '—' : `${workNumber(item.percent, 2)}%`}</TableCell><TableCell>{workNumber(item.remaining_quantity)}</TableCell>
                  <TableCell><TextField size="small" disabled={disabled || initialBlocked} value={draft?.comment ?? item.day.comment} inputProps={{ maxLength: 2000, 'aria-label': `Комментарий: ${item.plan.name}` }} onChange={e => editDay(item, 'comment', e.target.value)} /></TableCell>
                </>}
              </TableRow>;
            })}</TableBody>
          </Table>
        </WorkTableScroll>
        <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 1.5 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center"><Typography fontWeight={700}>Люди · {label(data.week_start)}–{label(data.week_end)}</Typography>{mode === 'plan' && canWrite ? <Button disabled={saving} onClick={() => setCrewEditor({ name: '', specialty: '', available: '', required: '', assigned: '', section: section || sections[0] || '' })}>Добавить бригаду</Button> : null}</Stack>
          <Typography variant="caption" color="text.secondary">Назначение резервирует людей на всю неделю. Одни и те же люди не складываются по строкам работ.</Typography>
          {mode === 'plan' ? (plan.crews || []).map(crew => <Box key={crew.id} sx={{ mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
            <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap"><Typography fontWeight={600}>{crew.name} · {crew.specialty}</Typography><TextField type="number" size="small" label="Доступно" disabled={disabled} value={crew.available} inputProps={{ min: 0, max: 10000 }} sx={{ width: 110 }} onChange={e => editPlan({ ...plan, crews: plan.crews.map(c => c.id === crew.id ? { ...c, available: num(e.target.value) } : c) })} /><Typography color={crew.available < crew.assignments.reduce((s, a) => s + num(a.assigned), 0) ? 'error.main' : 'text.secondary'}>Свободно: {crew.available - crew.assignments.reduce((s, a) => s + num(a.assigned), 0)}</Typography><Button disabled={disabled} onClick={() => setCrewEditor({ crewId: crew.id, name: crew.name, specialty: crew.specialty, available: crew.available, required: '', assigned: '', section: section || sections[0] || '' })}>Назначить на раздел</Button></Stack>
            {crew.assignments.map(a => <Stack key={a.id} direction={{ xs: 'column', sm: 'row' }} gap={1} alignItems={{ sm: 'center' }} sx={{ mt: 1 }}><Typography variant="body2" sx={{ flex: 1 }}>{a.name}{a.group_ref !== groupRef ? ' · другое направление' : ''}</Typography>{['required', 'assigned'].map(key => <TextField key={key} type="number" size="small" label={key === 'required' ? 'Требуется' : 'Назначено'} value={a[key]} disabled={disabled} inputProps={{ min: 0, max: 10000 }} sx={{ width: 120 }} onChange={e => editPlan({ ...plan, crews: plan.crews.map(c => c.id === crew.id ? { ...c, assignments: c.assignments.map(x => x.id === a.id ? { ...x, [key]: num(e.target.value) } : x) } : c) })} />)}<Typography color={a.required > a.assigned ? 'warning.main' : 'text.secondary'}>Не хватает: {Math.max(0, a.required - a.assigned)}</Typography><Button disabled={disabled} onClick={() => editPlan({ ...plan, crews: plan.crews.map(c => c.id === crew.id ? { ...c, assignments: c.assignments.filter(x => x.id !== a.id) } : c) })}>Убрать</Button></Stack>)}
          </Box>) : assignments.map(a => <Stack key={a.id} direction={{ xs: 'column', sm: 'row' }} gap={1} alignItems={{ sm: 'center' }} sx={{ mt: 1 }}><Box sx={{ flex: 1 }}><Typography variant="body2" fontWeight={600}>{a.crew.name} · {a.crew.specialty}</Typography><Typography variant="caption">{a.name} · требуется {a.required}, назначено {a.assigned}</Typography></Box><TextField type="number" size="small" label="Вышло за день" value={attendance[a.id]?.actual ?? data.crew_day[a.id]?.actual ?? ''} disabled={disabled} inputProps={{ min: 0, max: 10000, 'aria-label': `Вышло: ${a.crew.name}: ${a.name}` }} onChange={e => setAttendance(prev => ({ ...prev, [a.id]: { actual: e.target.value, comment: prev[a.id]?.comment ?? data.crew_day[a.id]?.comment ?? '' } }))} /><TextField size="small" label="Примечание по людям" value={attendance[a.id]?.comment ?? data.crew_day[a.id]?.comment ?? ''} disabled={disabled} onChange={e => setAttendance(prev => ({ ...prev, [a.id]: { actual: prev[a.id]?.actual ?? data.crew_day[a.id]?.actual ?? '', comment: e.target.value } }))} /></Stack>)}
          {!plan.crews.length ? <Typography variant="body2" color="text.secondary">Состав пока не запланирован. Добавьте бригады в режиме «Планирование».</Typography> : null}
        </Paper>
        {canWrite && (planDirty || Object.keys(daily).length || Object.keys(attendance).length) ? <Stack direction="row" gap={1}><Button variant="contained" disabled={saving} onClick={save}>{saving ? 'Сохранение…' : planDirty ? 'Сохранить план недели' : 'Сохранить сводку'}</Button><Button disabled={saving} onClick={() => setDiscard(true)}>Отменить изменения</Button></Stack> : null}
      </> : null}
    </>}
    <Dialog open={Boolean(crewEditor)} onClose={() => setCrewEditor(null)} fullWidth maxWidth="sm"><DialogTitle>Назначение бригады</DialogTitle><DialogContent>{crewEditor?.error ? <Alert severity="error">{crewEditor.error}</Alert> : null}<Stack spacing={2} sx={{ pt: 1 }}>{[['name','Бригада'],['specialty','Специальность'],['available','Доступно людей'],['required','Требуется'],['assigned','Назначено']].map(([key, title]) => <TextField key={key} label={title} disabled={Boolean(crewEditor?.crewId) && ['name','specialty','available'].includes(key)} type={['available','required','assigned'].includes(key) ? 'number' : 'text'} value={crewEditor?.[key] ?? ''} onChange={e => setCrewEditor(prev => ({ ...prev, [key]: e.target.value }))} />)}<TextField select label="Группа работ" value={crewEditor?.section ?? ''} onChange={e => setCrewEditor(prev => ({ ...prev, section: e.target.value }))}>{sections.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}</TextField></Stack></DialogContent><DialogActions><Button onClick={() => setCrewEditor(null)}>Отмена</Button><Button onClick={saveCrew}>Добавить в план</Button></DialogActions></Dialog>
    <Dialog open={Boolean(history)} onClose={() => setHistory(null)} fullWidth maxWidth="md"><DialogTitle>История планирования</DialogTitle><DialogContent>{history?.loading ? <LinearProgress /> : null}{history?.error ? <Alert severity="error">{history.error}</Alert> : null}{history?.items?.map(entry => <Box component="details" key={entry.id} sx={{ mb: 1 }}><Typography component="summary">{new Date(entry.changed_at).toLocaleString('ru-RU')} · {entry.actor_name} · {entry.kind === 'week' ? 'Недельный план' : 'Состав за день'}</Typography>{entry.kind === 'week' ? <><Typography variant="body2">Работ в плане: {entry.before?.targets?.length || 0} → {entry.after.targets.length}</Typography>{entry.after.targets.filter(t => entry.before?.targets?.find(p => p.work_id === t.work_id)?.quantity !== t.quantity).map(t => <Typography key={t.work_id} variant="body2">{data?.items.find(i => i.id === t.work_id)?.plan.name || 'Работа другого направления'}: {entry.before?.targets?.find(p => p.work_id === t.work_id)?.quantity ?? '—'} → {t.quantity}</Typography>)}<Typography variant="body2">Бригад: {entry.before?.crews?.length || 0} → {entry.after.crews.length}</Typography></> : Object.values(entry.after).map(a => <Typography key={a.id} variant="body2">{a.crew_name} · {a.name}: вышло {a.actual}</Typography>)}</Box>)}{history && !history.loading && !history.items?.length ? <Typography>Изменений пока нет.</Typography> : null}{history?.next_cursor ? <Button onClick={async () => { try { const next = await api.planningHistory(objectId, groupRef, mode === 'plan' ? data.week_start : day, history.next_cursor); setHistory(prev => ({ ...next, items: [...prev.items, ...next.items] })); } catch (err) { setHistory(prev => ({ ...prev, error: workError(err) })); } }}>Более ранние изменения</Button> : null}</DialogContent><DialogActions><Button onClick={() => setHistory(null)}>Закрыть</Button></DialogActions></Dialog>
    <Dialog open={discard || Boolean(leave.pending)} onClose={() => { setDiscard(false); leave.cancel(); }}><DialogTitle>Есть несохранённая сводка или план</DialogTitle><DialogActions><Button onClick={() => { setDiscard(false); leave.cancel(); }}>Продолжить ввод</Button><Button disabled={saving} onClick={() => { reset(); if (leave.pending) leave.leave(); }}>Отменить изменения</Button></DialogActions></Dialog>
  </Stack>;
}
