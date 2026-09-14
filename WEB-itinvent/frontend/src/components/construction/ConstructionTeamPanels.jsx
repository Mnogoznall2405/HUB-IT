import { useMemo } from 'react';
import {
  Box,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import Groups2OutlinedIcon from '@mui/icons-material/Groups2Outlined';
import { formatConstructionDate } from './ConstructionRequestViews';
import { OBJECT_TEAM_ROLES, roleLabel } from './constructionShared';
import { ConstructionContactCard } from './ConstructionUiBits';
import ConstructionPersonLink from './ConstructionPersonLink';


export function ConstructionTeamStructure({
  team = [],
  history = [],
  detailed = false,
}) {
  const byRole = useMemo(() => new Map(team.map((member) => [member.role_key, member])), [team]);
  const objectHistory = useMemo(
    () => history.filter((member) => !member.group_ref),
    [history],
  );
  return (
    <Stack spacing={2}>
      <Box component="section" aria-labelledby="object-team-title">
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.25 }}>
          <Groups2OutlinedIcon color="primary" />
          <Box>
            <Typography id="object-team-title" component="h2" variant="h6" fontWeight={850}>Команда объекта</Typography>
            <Typography variant="body2" color="text.secondary">
              Постоянные роли объекта; ГИП наследуется всеми направлениями
            </Typography>
          </Box>
        </Stack>
        <Box
          component="ol"
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' },
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
                sx={{
                  minWidth: 0,
                  p: 1.5,
                  borderRadius: 3,
                  borderStyle: member ? 'solid' : 'dashed',
                  bgcolor: member ? 'background.paper' : 'action.hover',
                }}
              >
                <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: 'block', mb: 0.75, lineHeight: 1.4 }}>{role.label}</Typography>
                <Typography variant="subtitle1" fontWeight={850} sx={{ overflowWrap: 'anywhere' }}>
                  <ConstructionPersonLink member={member} />
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                  {member ? [member.position, member.department].filter(Boolean).join(' · ') || role.hint : role.hint}
                </Typography>
                {detailed && member?.employee_code ? (
                  <Typography variant="caption" color="text.secondary">Код ЗУП: {member.employee_code}</Typography>
                ) : null}
              </Paper>
            );
          })}
        </Box>
      </Box>

      {detailed ? (
        <Paper component="section" variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 3 }}>
          <Typography component="h2" variant="h6" fontWeight={850}>История назначений</Typography>
          {objectHistory.length ? (
            <Box component="ol" sx={{ m: 0, mt: 1, pl: 2.5 }}>
              {objectHistory.map((member, index) => (
                <Box component="li" key={`${member.role_key}-${member.employee_code}-${member.valid_from}-${index}`} sx={{ mb: 1 }}>
                  <Typography variant="body2" fontWeight={750}>
                    {roleLabel(member.role_key)}: <ConstructionPersonLink member={member} />
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatConstructionDate(member.valid_from)} — {member.valid_to ? formatConstructionDate(member.valid_to) : 'по настоящее время'}
                  </Typography>
                </Box>
              ))}
            </Box>
          ) : <Typography color="text.secondary" sx={{ mt: 1 }}>Изменений назначений пока нет.</Typography>}
        </Paper>
      ) : null}
    </Stack>
  );
}


export function ConstructionCompactTeam({ objectTeam = [] }) {
  const byRole = useMemo(() => new Map(objectTeam.map((member) => [member.role_key, member])), [objectTeam]);
  return (
    <Box
      component="section"
      aria-label="Команда объекта"
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' },
        gap: 0.75,
      }}
    >
      {OBJECT_TEAM_ROLES.map((role) => (
        <ConstructionContactCard
          compact
          key={role.key}
          title={role.label}
          member={byRole.get(role.key)}
          description={role.hint}
          icon={<Groups2OutlinedIcon fontSize="small" />}
        />
      ))}
    </Box>
  );
}
