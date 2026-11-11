import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { dlpWorkSchedulesAPI } from '../../../api/dlpWorkSchedules';

const WEEKDAYS = [
  { bit: 0, label: 'Пн' },
  { bit: 1, label: 'Вт' },
  { bit: 2, label: 'Ср' },
  { bit: 3, label: 'Чт' },
  { bit: 4, label: 'Пт' },
  { bit: 5, label: 'Сб' },
  { bit: 6, label: 'Вс' },
];

function minToHHMM(value) {
  if (value === null || value === undefined || value === '') return '';
  const v = Number(value);
  if (!Number.isFinite(v)) return '';
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

function hhmmToMin(value) {
  const text = String(value || '').trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

function formatOffset(minutes) {
  const v = Number(minutes) || 0;
  if (!v) return 'как на сервере';
  const sign = v > 0 ? '+' : '−';
  return `${sign}${Math.abs(v) / 60} ч`;
}

const EMPTY_DRAFT = {
  workStart: '09:00',
  workEnd: '18:00',
  lunchStart: '13:00',
  lunchEnd: '13:45',
  lunchEnabled: true,
  tzOffset: '0',
  workdaysMask: 31,
};

function draftFromSchedule(schedule) {
  if (!schedule) return { ...EMPTY_DRAFT };
  return {
    workStart: minToHHMM(schedule.work_start_min) || '09:00',
    workEnd: minToHHMM(schedule.work_end_min) || '18:00',
    lunchStart: minToHHMM(schedule.lunch_start_min) || '13:00',
    lunchEnd: minToHHMM(schedule.lunch_end_min) || '13:45',
    lunchEnabled: schedule.lunch_start_min != null && schedule.lunch_end_min != null,
    tzOffset: String(Number(schedule.tz_offset_minutes) || 0),
    workdaysMask: schedule.workdays_mask == null ? 31 : Number(schedule.workdays_mask),
  };
}

export default function WorkSchedulesAdminSection() {
  const [data, setData] = useState({ items: [], branches: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [editing, setEditing] = useState(null); // branch_name -> draft
  const [savingBranch, setSavingBranch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await dlpWorkSchedulesAPI.getSchedules();
      setData({
        items: Array.isArray(result?.items) ? result.items : [],
        branches: Array.isArray(result?.branches) ? result.branches : [],
      });
    } catch (err) {
      setError('Не удалось загрузить графики работы');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const byBranch = useMemo(() => {
    const map = new Map();
    for (const item of data.items) map.set(String(item.branch_name || ''), item);
    return map;
  }, [data.items]);

  const rows = useMemo(() => {
    const names = new Set(data.branches);
    for (const item of data.items) names.add(String(item.branch_name || ''));
    return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [data.branches, data.items]);

  const save = async (branch) => {
    const draft = editing;
    if (!draft) return;
    const workStart = hhmmToMin(draft.workStart);
    const workEnd = hhmmToMin(draft.workEnd);
    const lunchStart = draft.lunchEnabled ? hhmmToMin(draft.lunchStart) : null;
    const lunchEnd = draft.lunchEnabled ? hhmmToMin(draft.lunchEnd) : null;
    if (workStart == null || workEnd == null || workStart >= workEnd) {
      setNotice({ severity: 'error', text: `${branch}: проверьте начало и конец рабочего дня` });
      return;
    }
    if (draft.lunchEnabled && (lunchStart == null || lunchEnd == null || lunchStart >= lunchEnd)) {
      setNotice({ severity: 'error', text: `${branch}: проверьте интервал обеда` });
      return;
    }
    const tzOffset = parseInt(draft.tzOffset, 10);
    if (!Number.isFinite(tzOffset) || Math.abs(tzOffset) > 14 * 60) {
      setNotice({ severity: 'error', text: `${branch}: смещение должно быть в пределах ±14 ч` });
      return;
    }
    setSavingBranch(branch);
    try {
      await dlpWorkSchedulesAPI.saveSchedule(branch, {
        work_start_min: workStart,
        work_end_min: workEnd,
        lunch_start_min: lunchStart,
        lunch_end_min: lunchEnd,
        tz_offset_minutes: tzOffset,
        workdays_mask: draft.workdaysMask,
      });
      setNotice({ severity: 'success', text: `${branch}: график сохранён` });
      setEditing(null);
      await load();
    } catch (err) {
      setNotice({ severity: 'error', text: `${branch}: не удалось сохранить график` });
    } finally {
      setSavingBranch('');
    }
  };

  const reset = async (branch) => {
    setSavingBranch(branch);
    try {
      await dlpWorkSchedulesAPI.deleteSchedule(branch);
      setNotice({ severity: 'success', text: `${branch}: график сброшен, простой считается как раньше` });
      setEditing(null);
      await load();
    } catch (err) {
      setNotice({ severity: 'error', text: `${branch}: не удалось сбросить график` });
    } finally {
      setSavingBranch('');
    }
  };

  const patchDraft = (patch) => setEditing((prev) => ({ ...(prev || EMPTY_DRAFT), ...patch }));

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>Графики работы филиалов</Typography>
          <Typography variant="body2" color="text.secondary">
            Применяется к активности ПК на странице DLP: простой в обед считается «перерывом», простой вне рабочего дня — «вне смены» и не идёт в «отошёл». Смещение — относительно времени сервера (Тюмень), например Москва = −120 мин.
          </Typography>
        </Box>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {notice ? <Alert severity={notice.severity} onClose={() => setNotice(null)}>{notice.text}</Alert> : null}
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}><CircularProgress /></Box>
        ) : (
          <Box sx={{ overflow: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Филиал</TableCell>
                  <TableCell>Рабочий день</TableCell>
                  <TableCell>Обед</TableCell>
                  <TableCell>Смещение</TableCell>
                  <TableCell>Дни</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((branch) => {
                  const schedule = byBranch.get(branch);
                  const isEditing = editing?._branch === branch;
                  return (
                    <TableRow key={branch} hover>
                      <TableCell>
                        <Typography fontWeight={600}>{branch}</Typography>
                        {schedule?.updated_at ? (
                          <Typography variant="caption" color="text.secondary">
                            {schedule.updated_by ? `${schedule.updated_by} · ` : ''}{new Date(schedule.updated_at).toLocaleDateString('ru-RU')}
                          </Typography>
                        ) : (
                          <Typography variant="caption" color="text.secondary">по умолчанию</Typography>
                        )}
                      </TableCell>
                      {isEditing ? (
                        <>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            <TextField size="small" type="time" value={editing.workStart} onChange={(e) => patchDraft({ workStart: e.target.value })} inputProps={{ 'aria-label': 'начало дня' }} sx={{ width: 100 }} />
                            {' — '}
                            <TextField size="small" type="time" value={editing.workEnd} onChange={(e) => patchDraft({ workEnd: e.target.value })} inputProps={{ 'aria-label': 'конец дня' }} sx={{ width: 100 }} />
                          </TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            <TextField size="small" type="time" value={editing.lunchStart} disabled={!editing.lunchEnabled} onChange={(e) => patchDraft({ lunchStart: e.target.value })} inputProps={{ 'aria-label': 'начало обеда' }} sx={{ width: 100 }} />
                            {' — '}
                            <TextField size="small" type="time" value={editing.lunchEnd} disabled={!editing.lunchEnabled} onChange={(e) => patchDraft({ lunchEnd: e.target.value })} inputProps={{ 'aria-label': 'конец обеда' }} sx={{ width: 100 }} />
                            <Chip
                              size="small"
                              variant={editing.lunchEnabled ? 'filled' : 'outlined'}
                              color={editing.lunchEnabled ? 'primary' : 'default'}
                              label={editing.lunchEnabled ? 'есть' : 'нет'}
                              onClick={() => patchDraft({ lunchEnabled: !editing.lunchEnabled })}
                              sx={{ ml: 1 }}
                            />
                          </TableCell>
                          <TableCell>
                            <TextField
                              size="small"
                              type="number"
                              value={editing.tzOffset}
                              onChange={(e) => patchDraft({ tzOffset: e.target.value })}
                              inputProps={{ 'aria-label': 'смещение в минутах', step: 60 }}
                              sx={{ width: 90 }}
                            />
                          </TableCell>
                          <TableCell>
                            <Stack direction="row" spacing={0.5}>
                              {WEEKDAYS.map((day) => {
                                const on = Boolean((editing.workdaysMask >> day.bit) & 1);
                                return (
                                  <Chip
                                    key={day.bit}
                                    size="small"
                                    variant={on ? 'filled' : 'outlined'}
                                    color={on ? 'primary' : 'default'}
                                    label={day.label}
                                    onClick={() => patchDraft({ workdaysMask: editing.workdaysMask ^ (1 << day.bit) })}
                                  />
                                );
                              })}
                            </Stack>
                          </TableCell>
                          <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                            <Button size="small" variant="contained" disabled={savingBranch === branch} onClick={() => save(branch)}>
                              {savingBranch === branch ? 'Сохраняю…' : 'Сохранить'}
                            </Button>
                            <Button size="small" onClick={() => setEditing(null)}>Отмена</Button>
                          </TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell>
                            {schedule ? `${minToHHMM(schedule.work_start_min)} — ${minToHHMM(schedule.work_end_min)}` : '—'}
                          </TableCell>
                          <TableCell>
                            {schedule?.lunch_start_min != null ? `${minToHHMM(schedule.lunch_start_min)} — ${minToHHMM(schedule.lunch_end_min)}` : '—'}
                          </TableCell>
                          <TableCell>{schedule ? formatOffset(schedule.tz_offset_minutes) : '—'}</TableCell>
                          <TableCell>
                            {schedule
                              ? WEEKDAYS.filter((d) => (schedule.workdays_mask >> d.bit) & 1).map((d) => d.label).join(' ') || '—'
                              : '—'}
                          </TableCell>
                          <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                            <Button
                              size="small"
                              disabled={Boolean(editing)}
                              onClick={() => setEditing({ _branch: branch, ...draftFromSchedule(schedule) })}
                            >
                              {schedule ? 'Изменить' : 'Задать'}
                            </Button>
                            {schedule ? (
                              <Tooltip title="Удалить график — простой снова считается одинаково круглые сутки">
                                <span>
                                  <IconButton size="small" aria-label={`сбросить ${branch}`} disabled={savingBranch === branch} onClick={() => reset(branch)}>
                                    <RestartAltIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                            ) : null}
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  );
                })}
                {!rows.length ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Typography color="text.secondary" sx={{ py: 2 }}>Филиалы не найдены — появятся после инвентаризации компьютеров.</Typography>
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </Box>
        )}
      </Stack>
    </Paper>
  );
}
