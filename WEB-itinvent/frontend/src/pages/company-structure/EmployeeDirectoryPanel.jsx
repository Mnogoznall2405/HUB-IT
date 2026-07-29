import { useMemo } from 'react';
import {
  Avatar,
  Box,
  CircularProgress,
  Divider,
  Link,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import LocationOnOutlinedIcon from '@mui/icons-material/LocationOnOutlined';
import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined';

function initials(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function PersonCard({ person, highlighted = false }) {
  const phones = Array.isArray(person?.work_phones) ? person.work_phones : [];
  const emails = Array.isArray(person?.work_emails) ? person.work_emails : [];
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        borderRadius: 2,
        borderColor: highlighted ? 'primary.main' : 'divider',
        bgcolor: highlighted ? 'action.selected' : 'background.paper',
      }}
    >
      <Stack direction="row" spacing={1.25} alignItems="flex-start">
        <Avatar sx={{ width: 36, height: 36, fontSize: 13, bgcolor: 'primary.main' }}>
          {initials(person?.full_name) || '—'}
        </Avatar>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle2" fontWeight={700}>{person?.full_name}</Typography>
          {person?.position ? (
            <Typography variant="body2" color="text.secondary">{person.position}</Typography>
          ) : null}
          {person?.department && person.department !== person?.position ? (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
              {person.department}
            </Typography>
          ) : null}
          {person?.department_location ? (
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.75 }}>
              <LocationOnOutlinedIcon sx={{ fontSize: 16 }} color="action" />
              <Typography variant="caption" color="text.secondary">
                {person.department_location}
              </Typography>
            </Stack>
          ) : null}
          {phones.length || emails.length ? (
            <Stack spacing={0.5} sx={{ mt: 1 }}>
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
  const grouped = useMemo(() => {
    const groups = new Map();
    (Array.isArray(people) ? people : []).forEach((person) => {
      const location = String(person?.department_location || '').trim() || 'Без указанного города';
      if (!groups.has(location)) groups.set(location, []);
      groups.get(location).push(person);
    });
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, 'ru'));
  }, [people]);

  return (
    <Stack spacing={1.5}>
      <Box>
        <Typography variant="subtitle1" fontWeight={700}>Сотрудники</Typography>
      </Box>
      <Divider />
      {focusedPerson ? (
        <Box>
          <Typography variant="overline" color="primary.main">Найденный сотрудник</Typography>
          <PersonCard person={focusedPerson} highlighted />
        </Box>
      ) : null}
      {loading ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">Загружаем сотрудников…</Typography>
        </Stack>
      ) : null}
      {!loading && grouped.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Сотрудники не указаны.
        </Typography>
      ) : null}
      {!loading && grouped.map(([location, locationPeople]) => (
        <Stack key={location} spacing={1}>
          <Typography variant="caption" color="text.secondary" fontWeight={700}>
            {location} · {locationPeople.length}
          </Typography>
          {locationPeople.map((person, index) => (
            <PersonCard
              key={`${person.full_name}-${person.position}-${index}`}
              person={person}
              highlighted={Boolean(focusedPerson?.full_name && focusedPerson.full_name === person.full_name)}
            />
          ))}
        </Stack>
      ))}
    </Stack>
  );
}
