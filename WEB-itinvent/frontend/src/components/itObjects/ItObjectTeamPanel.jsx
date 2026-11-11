import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import Groups2OutlinedIcon from '@mui/icons-material/Groups2Outlined';
import { itObjectsAPI } from '../../api/itObjects';
import { EmployeeSelect } from '../construction/ConstructionObjectSettingsDialog';
import { OBJECT_TEAM_ROLES, roleLabel } from '../construction/constructionShared';


const formatDate = (value) => {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short' }).format(parsed) : '';
};

const toCandidate = (member) => (member ? {
  employee_code: member.employee_code,
  full_name: member.full_name,
  position: member.position || '',
  department: member.department || '',
  department_location: member.department_location || '',
} : null);

function TeamEditDialog({ open, byRole, busy, onClose, onSave }) {
  const [draft, setDraft] = useState(() => Object.fromEntries(OBJECT_TEAM_ROLES.map(({ key }) => [key, toCandidate(byRole.get(key))])));
  const changes = useMemo(() => {
    const result = {};
    OBJECT_TEAM_ROLES.forEach(({ key }) => {
      const before = byRole.get(key)?.employee_code || null;
      const after = draft[key]?.employee_code || null;
      if (before !== after) result[key] = draft[key] || null;
    });
    return result;
  }, [byRole, draft]);
  const changed = Object.keys(changes).length > 0;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 800 }}>Команда объекта</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          {OBJECT_TEAM_ROLES.map((role) => (
            <EmployeeSelect
              key={role.key}
              label={role.label}
              value={draft[role.key]}
              disabled={busy}
              search={itObjectsAPI.searchEmployees}
              onChange={(next) => setDraft((prev) => ({ ...prev, [role.key]: next }))}
            />
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Отмена</Button>
        <Button variant="contained" disabled={busy || !changed} onClick={async () => { if (await onSave(changes)) onClose(); }}>
          Сохранить
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function ItObjectTeamPanel({ object, busy, onSave }) {
  const [editing, setEditing] = useState(false);
  const team = Array.isArray(object?.team) ? object.team : [];
  const history = Array.isArray(object?.team_history) ? object.team_history : [];
  const byRole = useMemo(() => new Map(team.map((member) => [member.role_key, member])), [team]);
  const canManage = Boolean(object?.can_manage_owner) && !object?.hidden;

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 1.25 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Groups2OutlinedIcon color="primary" />
          <Box>
            <Typography variant="subtitle2" fontWeight={800}>Команда объекта</Typography>
            <Typography variant="caption" color="text.secondary">Постоянные роли объекта, сотрудники из справочника ЗУП</Typography>
          </Box>
        </Stack>
        {canManage ? (
          <Button size="small" variant="outlined" disabled={busy} onClick={() => setEditing(true)} sx={{ textTransform: 'none' }}>
            Изменить
          </Button>
        ) : null}
      </Stack>
      <Box
        component="ol"
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
          gap: 1.25,
          m: 0,
          p: 0,
          listStyle: 'none',
        }}
      >
        {OBJECT_TEAM_ROLES.map((role) => {
          const member = byRole.get(role.key);
          return (
            <Paper
              component="li"
              key={role.key}
              variant="outlined"
              sx={{ minWidth: 0, p: 1.5, borderRadius: 2, borderStyle: member ? 'solid' : 'dashed', bgcolor: member ? 'background.paper' : 'action.hover' }}
            >
              <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: 'block', mb: 0.5 }}>{role.label}</Typography>
              <Typography fontWeight={800} sx={{ overflowWrap: 'anywhere' }}>{member ? member.full_name : 'Не назначен'}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                {member ? [member.position, member.department].filter(Boolean).join(' · ') || role.hint : role.hint}
              </Typography>
            </Paper>
          );
        })}
      </Box>
      {canManage ? (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 0.5 }}>История назначений</Typography>
          {history.length ? history.map((member) => (
            <Typography key={`${member.role_key}-${member.employee_code}-${member.valid_from}`} variant="body2" sx={{ py: 0.25 }}>
              {roleLabel(member.role_key)}: <b>{member.full_name}</b>
              <Typography component="span" variant="caption" color="text.secondary">
                {' '}· {formatDate(member.valid_from)} — {formatDate(member.valid_to) || 'по настоящее время'}
              </Typography>
            </Typography>
          )) : <Typography variant="body2" color="text.secondary">Изменений назначений пока нет.</Typography>}
        </Box>
      ) : null}
      {editing ? (
        <TeamEditDialog open byRole={byRole} busy={busy} onClose={() => setEditing(false)} onSave={onSave} />
      ) : null}
    </Paper>
  );
}
