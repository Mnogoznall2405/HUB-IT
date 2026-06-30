import { useMemo } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
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
import { useTheme } from '@mui/material/styles';
import BuildCircleOutlinedIcon from '@mui/icons-material/BuildCircleOutlined';
import CheckCircleOutlineOutlinedIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import OverflowMenu from '../../../components/common/OverflowMenu';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';
import { sessionStatusMeta } from '../accountConstants';
import { formatDateTime } from '../accountUserModel';
import MetricTile from '../shared/MetricTile';
import SectionCard from '../shared/SectionCard';

export default function SessionsTab({ sessions, loading, cleanupResult, cleaning, purging, onCleanup, onPurge, onTerminate }) {

  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const metrics = useMemo(() => ({
    active: sessions.filter((item) => item.status === 'active').length,
  }), [sessions]);
  const visibleSessions = sessions;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, minHeight: 0, height: '100%' }}>
      <SectionCard
        description="Живые и недавно закрытые сессии с единым lifecycle cleanup."
        action={(
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <Button
            variant="outlined"
            startIcon={cleaning ? <CircularProgress size={18} color="inherit" /> : <BuildCircleOutlinedIcon />}
            onClick={onCleanup}
            disabled={cleaning || purging}
          >
            {cleaning ? 'Очистка...' : 'Очистить устаревшие'}
          </Button>
          <Button
            variant="outlined"
            color="error"
            startIcon={purging ? <CircularProgress size={18} color="inherit" /> : <DeleteOutlineOutlinedIcon />}
            onClick={onPurge}
            disabled={purging || cleaning}
          >
            {purging ? 'Удаление...' : 'Удалить неактивные'}
          </Button>
          </Stack>
        )}
        sx={{ flexShrink: 0 }}
        contentSx={{ p: 1.05 }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.35 }}>
          Основные действия вынесены в компактное меню, чтобы таблица оставалась уже и чище.
        </Typography>
      </SectionCard>

      <Grid container spacing={0.85} sx={{ flexShrink: 0 }}>
        <Grid item xs={12} sm={6} lg={6}>
          <MetricTile compact icon={<CheckCircleOutlineOutlinedIcon fontSize="small" />} label="Активные" value={metrics.active} caption="Доступны прямо сейчас" />
        </Grid>
        <Grid item xs={12} sm={6} lg={6}>
          <MetricTile compact icon={<BuildCircleOutlinedIcon fontSize="small" />} label="Cleanup" value={cleanupResult.deleted} caption={`Удалено: ${cleanupResult.deleted}, деактивировано: ${cleanupResult.deactivated}`} />
        </Grid>
      </Grid>

      <SectionCard title="Список входов" action={<Chip size="small" label={`${visibleSessions.length} записей`} />} sx={{ minHeight: 0 }} contentSx={{ p: 0 }}>
        <TableContainer sx={{ minHeight: 0, height: '100%', overflowY: 'auto' }}>
          <Table
            stickyHeader
            size="small"
            sx={{
              minWidth: 980,
              '& .MuiTableCell-head': {
                py: 0.55,
                backgroundColor: ui.headerBandBg,
                fontSize: '0.76rem',
                borderBottomColor: ui.headerBandBorder,
              },
              '& .MuiTableCell-body': {
                py: 0.58,
              },
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell>Пользователь</TableCell>
                <TableCell>Устройство</TableCell>
                <TableCell>IP</TableCell>
                <TableCell>Создана</TableCell>
                <TableCell>Активность</TableCell>
                <TableCell>Истекает</TableCell>
                <TableCell>Статус</TableCell>
                <TableCell align="right">...</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} sx={{ py: 4, textAlign: 'center' }}>
                    <CircularProgress size={24} />
                  </TableCell>
                </TableRow>
              ) : visibleSessions.length > 0 ? visibleSessions.map((session) => {
                const meta = sessionStatusMeta[session.status] || sessionStatusMeta.terminated;
                return (
                  <TableRow key={session.session_id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{session.username}</Typography>
                      <Typography variant="caption" color="text.secondary">{session.role}</Typography>
                    </TableCell>
                    <TableCell sx={{ overflowWrap: 'anywhere' }}>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{session.device_label || 'Устройство'}</Typography>
                      <Typography variant="caption" color="text.secondary">{session.user_agent || '—'}</Typography>
                    </TableCell>
                    <TableCell>{session.ip_address || '—'}</TableCell>
                    <TableCell>{formatDateTime(session.created_at)}</TableCell>
                    <TableCell>{formatDateTime(session.last_seen_at)}</TableCell>
                    <TableCell>
                      <Typography variant="body2">{formatDateTime(session.expires_at)}</Typography>
                      <Typography variant="caption" color="text.secondary">{formatDateTime(session.idle_expires_at)}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" color={meta.color} label={meta.label} />
                    </TableCell>
                    <TableCell align="right">
                      <OverflowMenu
                        label="Действия с сессией"
                        items={[
                          { key: 'terminate', label: 'Завершить', tone: 'danger', disabled: session.status !== 'active', icon: <DeleteOutlineOutlinedIcon fontSize="small" /> },
                        ]}
                        onSelect={(key) => {
                          if (key === 'terminate') onTerminate(session.session_id);
                        }}
                      />
                    </TableCell>
                  </TableRow>
                );
              }) : (
                <TableRow>
                  <TableCell colSpan={8} sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                    Сессии не найдены.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>
    </Box>
  );
}
