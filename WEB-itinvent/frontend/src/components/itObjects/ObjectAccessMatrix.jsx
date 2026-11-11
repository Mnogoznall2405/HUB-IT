import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, IconButton, MenuItem, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material';
import PersonRemoveOutlinedIcon from '@mui/icons-material/PersonRemoveOutlined';
import ItObjectUserPicker from './ItObjectUserPicker';
import { LEVEL_LABELS, SECTION_KEYS, SECTION_LABELS } from './itObjectsShared';

const NONE = 'none';
const PRESETS = [
  { label: 'Просмотр всего', level: 'view' },
  { label: 'Управление всем', level: 'manage' },
  { label: 'Ничего', level: NONE },
];

const allSections = (keys, level) => Object.fromEntries(keys.map((key) => [key, level]));
const toPayload = (keys, values) => Object.fromEntries(keys.map((key) => [key, values[key] === NONE ? null : values[key]]));

// По одному выбору на раздел: «Нет / Просмотр / Управление».
function SectionLevels({ keys, values, onChange, disabled }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: `repeat(${keys.length}, minmax(0, 1fr))` }, gap: 1, flex: 1, minWidth: 0 }}>
      {keys.map((key) => (
        <TextField
          key={key}
          select
          size="small"
          label={SECTION_LABELS[key]}
          value={values[key]}
          disabled={disabled}
          onChange={(event) => onChange({ ...values, [key]: event.target.value })}
          sx={{ '& .MuiInputBase-root': { minHeight: 44 } }}
        >
          <MenuItem value={NONE}>Нет доступа</MenuItem>
          {Object.entries(LEVEL_LABELS).map(([level, label]) => <MenuItem key={level} value={level}>{label}</MenuItem>)}
        </TextField>
      ))}
    </Box>
  );
}

function PersonRow({ keys, person, busy, onSave }) {
  const serverValues = useMemo(
    () => Object.fromEntries(keys.map((key) => [key, person.sections[key] || NONE])),
    [keys, person.sections],
  );
  const [values, setValues] = useState(serverValues);
  useEffect(() => setValues(serverValues), [serverValues]);
  const dirty = keys.some((key) => values[key] !== serverValues[key]);

  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'center' }} sx={{ pt: 1 }}>
      <Typography sx={{ width: { md: 220 }, flexShrink: 0, overflowWrap: 'anywhere' }} fontWeight={650}>{person.name}</Typography>
      <SectionLevels keys={keys} values={values} onChange={setValues} disabled={busy} />
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
        {dirty ? (
          <Button variant="contained" size="small" disabled={busy} onClick={() => void onSave(person.userId, toPayload(keys, values))} sx={{ minHeight: 40, textTransform: 'none' }}>
            Сохранить
          </Button>
        ) : null}
        <Tooltip title="Забрать весь доступ">
          <span>
            <IconButton
              disabled={busy}
              aria-label={`Забрать весь доступ: ${person.name}`}
              onClick={() => void onSave(person.userId, toPayload(keys, allSections(keys, NONE)))}
              sx={{ width: 40, height: 40 }}
            >
              <PersonRemoveOutlinedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    </Stack>
  );
}

/**
 * Доступ к объекту: одна строка на человека, по выбору на каждый раздел, быстрые наборы и одно сохранение.
 * `onSave(userId, { раздел: 'view' | 'manage' | null })` меняет все разделы человека за один запрос.
 */
export default function ObjectAccessMatrix({ object, busy, onSave, sectionKeys = SECTION_KEYS }) {
  const keys = sectionKeys;
  const [candidate, setCandidate] = useState(null);
  const [values, setValues] = useState(allSections(keys, 'view'));

  const people = useMemo(() => {
    const byUser = new Map();
    (object.grants || []).forEach((grant) => {
      const entry = byUser.get(grant.user_id) || { userId: grant.user_id, name: grant.user_name, sections: {} };
      entry.sections[grant.section] = grant.level;
      byUser.set(grant.user_id, entry);
    });
    return [...byUser.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
  }, [object.grants]);

  const candidateIsOwner = Boolean(candidate && object.owner && Number(object.owner.user_id) === Number(candidate.id));
  const hasAny = keys.some((key) => values[key] !== NONE);

  return (
    <Stack spacing={1.5}>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>Выдать доступ</Typography>
        <Stack spacing={1.25}>
          <ItObjectUserPicker label="Сотрудник" value={candidate} onChange={setCandidate} disabled={busy} />
          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" alignItems="center">
            <Typography variant="body2" color="text.secondary">Быстро:</Typography>
            {PRESETS.map((preset) => (
              <Chip key={preset.label} label={preset.label} variant="outlined" clickable disabled={busy} onClick={() => setValues(allSections(keys, preset.level))} />
            ))}
          </Stack>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'center' }}>
            <SectionLevels keys={keys} values={values} onChange={setValues} disabled={busy} />
            <Button
              variant="contained"
              disabled={busy || !candidate || !hasAny || candidateIsOwner}
              onClick={async () => {
                if (await onSave(candidate.id, toPayload(keys, values))) {
                  setCandidate(null);
                  setValues(allSections(keys, 'view'));
                }
              }}
              sx={{ minHeight: 44, flexShrink: 0, textTransform: 'none' }}
            >
              Выдать
            </Button>
          </Stack>
          {candidateIsOwner ? <Alert severity="info">Этот человек — айтишник объекта, у него уже есть все разделы.</Alert> : null}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>Кто что видит</Typography>
        <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />} spacing={1}>
          {object.owner ? (
            <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
              <Typography fontWeight={650} sx={{ overflowWrap: 'anywhere' }}>{object.owner.user_name}</Typography>
              <Chip size="small" color="primary" label="Айтишник — все разделы" />
            </Stack>
          ) : null}
          {people.map((person) => <PersonRow key={person.userId} keys={keys} person={person} busy={busy} onSave={onSave} />)}
        </Stack>
        {!people.length ? (
          <Typography color="text.secondary" sx={{ mt: object.owner ? 1 : 0 }}>Доступ пока никому не выдан.</Typography>
        ) : null}
      </Paper>
    </Stack>
  );
}
