import { useMemo } from 'react';
import {
  Avatar,
  Box,
  Chip,
  CircularProgress,
  Link,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import LocationOnOutlinedIcon from '@mui/icons-material/LocationOnOutlined';
import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined';
import { useTheme } from '@mui/material/styles';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';

function initials(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function employeeLeadershipRole(person) {
  const position = String(person?.position || '').trim().toLocaleLowerCase('ru-RU');
  const isDeputyHead = /(?:^|\s)(?:первый\s+)?(?:заместитель|зам\.?)\s+.*начальник/u.test(position);
  if (isDeputyHead) return 'deputy';
  if (/(?:^|\s)начальник(?:\s|$)/u.test(position)) return 'head';
  return 'staff';
}

function PersonCard({ person, highlighted = false, leadershipRole = 'staff', showLocation = false, ui }) {
  const phones = Array.isArray(person?.work_phones) ? person.work_phones : [];
  const emails = Array.isArray(person?.work_emails) ? person.work_emails : [];
  const isHead = leadershipRole === 'head';
  const isDeputy = leadershipRole === 'deputy';
  return (
    <Paper
      data-testid="employee-card"
      data-surface="employee-card"
      data-leadership-role={leadershipRole}
      variant="outlined"
      sx={{
        p: 1.5,
        borderRadius: 2,
        height: '100%',
        borderColor: highlighted || isHead
          ? ui.selectedBorder
          : (isDeputy ? ui.selectedBorder : ui.borderStrong),
        bgcolor: highlighted || isHead ? ui.selectedBg : ui.panelSolid,
        boxShadow: isHead
          ? (theme) => `inset 3px 0 0 ${theme.palette.primary.main}, ${ui.shellShadow}`
          : ui.shellShadow,
        transition: (theme) => theme.transitions.create(['border-color', 'background-color'], {
          duration: theme.transitions.duration.shorter,
        }),
      }}
    >
      <Stack direction="row" spacing={1.25} alignItems="flex-start">
        <Avatar
          sx={{
            width: 40,
            height: 40,
            fontSize: 13,
            bgcolor: 'primary.main',
            outline: (theme) => theme.palette.mode === 'dark'
              ? '1px solid rgba(255,255,255,0.10)'
              : '1px solid rgba(0,0,0,0.10)',
            outlineOffset: -1,
          }}
        >
          {initials(person?.full_name) || '—'}
        </Avatar>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          {isHead || isDeputy ? (
            <Chip
              size="small"
              color="primary"
              variant={isHead ? 'filled' : 'outlined'}
              label={isHead ? 'Начальник подразделения' : 'Заместитель начальника'}
              sx={{ height: 24, mb: 0.75, fontWeight: 700 }}
            />
          ) : null}
          <Typography variant="subtitle2" fontWeight={700} sx={{ lineHeight: 1.3 }}>
            {person?.full_name}
          </Typography>
          {person?.position ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{person.position}</Typography>
          ) : null}
          {person?.department && person.department !== person?.position ? (
            <Typography variant="caption" color="text.disabled" display="block" noWrap sx={{ mt: 0.25 }}>
              {person.department}
            </Typography>
          ) : null}
          {showLocation && person?.department_location ? (
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5, color: 'text.secondary' }}>
              <LocationOnOutlinedIcon sx={{ fontSize: 15 }} />
              <Typography variant="caption">{person.department_location}</Typography>
            </Stack>
          ) : null}
          {phones.length || emails.length ? (
            <Stack spacing={0.5} sx={{ mt: 0.875 }}>
              {phones.map((phone) => (
                <Stack key={phone} direction="row" spacing={0.75} alignItems="center">
                  <PhoneOutlinedIcon sx={{ fontSize: 16 }} color="action" />
                  <Link href={`tel:${String(phone).replace(/[^+\d]/g, '')}`} underline="hover" variant="body2">
                    {phone}
                  </Link>
                </Stack>
              ))}
              {emails.map((email) => (
                <Stack key={email} direction="row" spacing={0.75} alignItems="center">
                  <EmailOutlinedIcon sx={{ fontSize: 16 }} color="action" />
                  <Link href={`mailto:${email}`} underline="hover" variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                    {email}
                  </Link>
                </Stack>
              ))}
            </Stack>
          ) : null}
        </Box>
      </Stack>
    </Paper>
  );
}

export default function EmployeeDirectoryPanel({ people, loading, focusedPerson }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const peopleItems = Array.isArray(people) ? people : [];
  const { leadershipPeople, grouped } = useMemo(() => {
    const leadership = [];
    const groups = new Map();
    peopleItems.forEach((person) => {
      const role = employeeLeadershipRole(person);
      if (role !== 'staff') {
        leadership.push({ person, role });
        return;
      }
      const location = String(person?.department_location || '').trim() || 'Без указанного города';
      if (!groups.has(location)) groups.set(location, []);
      groups.get(location).push(person);
    });
    leadership.sort((left, right) => {
      const roleOrder = { head: 0, deputy: 1 };
      return roleOrder[left.role] - roleOrder[right.role]
        || String(left.person?.full_name || '').localeCompare(String(right.person?.full_name || ''), 'ru');
    });
    return {
      leadershipPeople: leadership,
      grouped: [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, 'ru')),
    };
  }, [peopleItems]);
  const focusedIsListed = Boolean(
    focusedPerson?.full_name
    && peopleItems.some((person) => person?.full_name === focusedPerson.full_name),
  );
  const sectionSx = {
    p: { xs: 1, sm: 1.25 },
    border: '1px solid',
    borderColor: ui.borderSoft,
    borderRadius: { xs: 3, sm: 3.25 },
    bgcolor: ui.panelBg,
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.5}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box
            sx={{
              width: 34,
              height: 34,
              display: 'grid',
              placeItems: 'center',
              borderRadius: 1.5,
              color: 'primary.main',
              bgcolor: 'action.selected',
            }}
          >
            <GroupsOutlinedIcon fontSize="small" />
          </Box>
          <Typography variant="subtitle1" fontWeight={750}>Сотрудники</Typography>
        </Stack>
        {!loading && peopleItems.length ? (
          <Chip size="small" variant="outlined" label={`${peopleItems.length} человек`} />
        ) : null}
      </Stack>
      {focusedPerson && !focusedIsListed ? (
        <Box>
          <Typography variant="overline" color="primary.main">Найденный сотрудник</Typography>
          <PersonCard person={focusedPerson} highlighted ui={ui} />
        </Box>
      ) : null}
      {loading ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">Загружаем сотрудников…</Typography>
        </Stack>
      ) : null}
      {!loading && peopleItems.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Сотрудники не указаны.
        </Typography>
      ) : null}
      {!loading && leadershipPeople.length ? (
        <Stack component="section" data-surface="employee-section" spacing={1.25} sx={sectionSx}>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Typography variant="subtitle2" fontWeight={750}>Руководство подразделения</Typography>
            <Chip size="small" label={leadershipPeople.length} sx={{ height: 22 }} />
          </Stack>
          <Box
            data-testid="employee-grid"
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
              gap: 1.25,
            }}
          >
            {leadershipPeople.map(({ person, role }, index) => (
              <PersonCard
                key={`${person.full_name}-${person.position}-${index}`}
                person={person}
                leadershipRole={role}
                showLocation
                ui={ui}
                highlighted={Boolean(focusedPerson?.full_name && focusedPerson.full_name === person.full_name)}
              />
            ))}
          </Box>
        </Stack>
      ) : null}
      {!loading && grouped.map(([location, locationPeople]) => (
        <Stack
          key={location}
          component="section"
          data-surface="employee-section"
          spacing={1.25}
          sx={sectionSx}
        >
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Box
              sx={{
                width: 28,
                height: 28,
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
                borderRadius: 1.25,
                color: 'text.secondary',
                bgcolor: ui.actionBg,
                border: '1px solid',
                borderColor: ui.actionBorder,
              }}
            >
              <LocationOnOutlinedIcon sx={{ fontSize: 17 }} />
            </Box>
            <Typography variant="subtitle2" fontWeight={700}>{location}</Typography>
            <Chip
              size="small"
              variant="outlined"
              label={locationPeople.length}
              sx={{ height: 22, bgcolor: ui.actionBg, borderColor: ui.actionBorder }}
            />
          </Stack>
          <Box
            data-testid="employee-grid"
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
              gap: 1.25,
            }}
          >
            {locationPeople.map((person, index) => (
              <PersonCard
                key={`${person.full_name}-${person.position}-${index}`}
                person={person}
                ui={ui}
                highlighted={Boolean(focusedPerson?.full_name && focusedPerson.full_name === person.full_name)}
              />
            ))}
          </Box>
        </Stack>
      ))}
    </Stack>
  );
}
