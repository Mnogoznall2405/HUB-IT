import {
  Box,
  Chip,
  Divider,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { AD_PASSWORD_PORTAL_URL } from './adPasswordPortal';

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ru-RU');
};

const formatDaysRemaining = (user) => {
  if (user?.password_never_expires) return '—';
  if (user?.expired) return 0;
  return user?.days_to_expire ?? '—';
};

const statusChip = (user) => {
  if (user?.must_change_now) {
    return (
      <Chip
        size="small"
        color="error"
        label="Сменить сейчас"
        component={Link}
        href={AD_PASSWORD_PORTAL_URL}
        target="_blank"
        rel="noopener noreferrer"
        clickable
        underline="none"
        data-testid="password-expiry-change-link"
      />
    );
  }
  if (user?.password_never_expires) {
    return (
      <Chip
        size="small"
        color="default"
        variant="outlined"
        label="Бессрочный"
        data-testid="password-expiry-never-expires"
      />
    );
  }
  if (user?.expired) {
    return (
      <Chip
        size="small"
        color="error"
        label="Просрочен"
        component={Link}
        href={AD_PASSWORD_PORTAL_URL}
        target="_blank"
        rel="noopener noreferrer"
        clickable
        underline="none"
        data-testid="password-expiry-change-link"
      />
    );
  }
  if (Number(user?.days_to_expire) <= 7) {
    return <Chip size="small" color="warning" label="Скоро" />;
  }
  return <Chip size="small" color="success" variant="outlined" label="OK" />;
};

function PasswordExpiryCard({ user }) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 1.5,
        border: (theme) => `1px solid ${theme.palette.divider}`,
      }}
      data-testid="password-expiry-card"
    >
      <Stack spacing={1}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ wordBreak: 'break-word' }}>
              {user.display_name || '—'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
              {user.login || '—'}
            </Typography>
          </Box>
          {statusChip(user)}
        </Stack>
        <Divider />
        <Stack spacing={0.5}>
          <Typography variant="body2">
            <Box component="span" color="text.secondary">Отдел: </Box>
            {user.department || '—'}
          </Typography>
          <Typography variant="body2">
            <Box component="span" color="text.secondary">Филиал: </Box>
            {user.branch_name || '—'}
          </Typography>
          <Typography variant="body2">
            <Box component="span" color="text.secondary">Смена пароля: </Box>
            {formatDate(user.pwd_last_set_date)}
          </Typography>
          <Typography variant="body2">
            <Box component="span" color="text.secondary">Истекает: </Box>
            {user.password_never_expires ? '—' : formatDate(user.expiration_date)}
          </Typography>
          <Typography variant="body2" fontWeight={700}>
            Осталось: {formatDaysRemaining(user)} дн.
          </Typography>
        </Stack>
      </Stack>
    </Paper>
  );
}

export default function PasswordExpiryTable({ users = [], isMobile = false }) {
  if (!users.length) {
    return (
      <Paper
        elevation={0}
        sx={{
          p: 3,
          border: (theme) => `1px solid ${theme.palette.divider}`,
          textAlign: 'center',
        }}
        data-testid="password-expiry-empty"
      >
        <Typography color="text.secondary">Пользователи не найдены для выбранных фильтров.</Typography>
      </Paper>
    );
  }

  if (isMobile) {
    return (
      <Stack spacing={1} data-testid="password-expiry-cards">
        {users.map((user) => (
          <PasswordExpiryCard key={`${user.login}-${user.display_name}`} user={user} />
        ))}
      </Stack>
    );
  }

  return (
    <TableContainer
      component={Paper}
      elevation={0}
      sx={{ border: (theme) => `1px solid ${theme.palette.divider}` }}
      data-testid="password-expiry-table"
    >
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>ФИО</TableCell>
            <TableCell>Логин</TableCell>
            <TableCell>Отдел</TableCell>
            <TableCell>Филиал</TableCell>
            <TableCell>Смена пароля</TableCell>
            <TableCell>Истекает</TableCell>
            <TableCell align="right">Осталось, дн.</TableCell>
            <TableCell>Статус</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {users.map((user) => (
            <TableRow key={`${user.login}-${user.display_name}`} hover>
              <TableCell>{user.display_name || '—'}</TableCell>
              <TableCell>{user.login || '—'}</TableCell>
              <TableCell>{user.department || '—'}</TableCell>
              <TableCell>{user.branch_name || '—'}</TableCell>
              <TableCell>{formatDate(user.pwd_last_set_date)}</TableCell>
              <TableCell>{user.password_never_expires ? '—' : formatDate(user.expiration_date)}</TableCell>
              <TableCell align="right">{formatDaysRemaining(user)}</TableCell>
              <TableCell>{statusChip(user)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
