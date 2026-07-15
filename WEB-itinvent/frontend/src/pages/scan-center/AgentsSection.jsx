import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { PlayArrow as PlayArrowIcon } from '@mui/icons-material';
import { useTheme } from '@mui/material/styles';

function agentCapabilities(agent) {
  const metadata = agent?.last_heartbeat?.metadata || {};
  return {
    version: String(agent?.version || agent?.agent_version || metadata.agent_version || '').trim(),
    analysisVersion: String(agent?.analysis_version || metadata.analysis_version || '').trim(),
  };
}

export default function AgentsSection({
  visible,
  rows,
  total,
  loading,
  page,
  rowsPerPage,
  rowsPerPageOptions,
  query,
  online,
  taskStatus,
  sortBy,
  sortDir,
  canScanTasks,
  busyTaskAgent,
  expectedAgentVersion,
  formatters,
  onQueryChange,
  onOnlineChange,
  onTaskStatusChange,
  onSort,
  onPageChange,
  onRowsPerPageChange,
  onOpenScan,
  onPing,
  onOpenHost,
}) {
  const {
    commandLabel,
    formatLastSeen,
    formatTaskTimestamp,
    formatTs,
    isActiveTask,
    renderTaskStatusLabel,
    renderTaskSummary,
    taskStatusColor,
    taskStatusLabel,
    taskTimestampLabel,
  } = formatters;

  const theme = useTheme();
  const mobileLayout = useMediaQuery(theme.breakpoints.down('md'));

  if (!visible) return null;

  const renderActions = (agent, mobile = false) => (
    <Stack direction={mobile ? 'column' : 'row'} spacing={0.75} justifyContent="flex-end">
      <Button type="button" size="small" variant="contained" startIcon={<PlayArrowIcon />} disabled={!canScanTasks || busyTaskAgent === agent.agent_id || isActiveTask(agent.active_task)} onClick={() => onOpenScan(agent.agent_id, false)}>Сканировать</Button>
      <Button type="button" size="small" variant="outlined" disabled={!canScanTasks || busyTaskAgent === agent.agent_id || isActiveTask(agent.active_task)} onClick={() => onOpenScan(agent.agent_id, true)}>Скан с 0</Button>
      <Button type="button" size="small" variant="text" disabled={!canScanTasks || busyTaskAgent === agent.agent_id || isActiveTask(agent.active_task)} onClick={() => onPing(agent.agent_id)}>Проверить связь</Button>
      <Button type="button" size="small" variant="text" onClick={() => onOpenHost(agent.hostname || agent.agent_id)}>Инциденты</Button>
    </Stack>
  );

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Stack spacing={1.5}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>Агенты и задания</Typography>
            <Typography variant="body2" color="text.secondary">Связь, версия, локальная очередь и результат последней команды.</Typography>
          </Box>
          <Chip size="small" label={`Всего: ${total}`} />
        </Box>
        <Alert severity="info" sx={{ py: 0.25 }}>
          Ожидаемая версия агента: {expectedAgentVersion || 'не указана сервером'}. Ненулевая локальная очередь означает, что результаты ещё не дошли до сервера.
        </Alert>
        <Grid container spacing={1.2}>
          <Grid item xs={12} md={5}>
            <TextField
              size="small"
              fullWidth
              label="Поиск по агентам"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Hostname, agent_id, IP, филиал"
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl size="small" fullWidth>
              <InputLabel>Сеть</InputLabel>
              <Select value={online} label="Сеть" onChange={(event) => onOnlineChange(event.target.value)}>
                <MenuItem value="all">Все</MenuItem>
                <MenuItem value="online">В сети</MenuItem>
                <MenuItem value="offline">Не в сети</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControl size="small" fullWidth>
              <InputLabel>Статус задачи</InputLabel>
              <Select value={taskStatus} label="Статус задачи" onChange={(event) => onTaskStatusChange(event.target.value)}>
                <MenuItem value="all">Все</MenuItem>
                <MenuItem value="active">Любая активная</MenuItem>
                <MenuItem value="queued">В очереди</MenuItem>
                <MenuItem value="delivered">Доставлено</MenuItem>
                <MenuItem value="acknowledged">Выполняется</MenuItem>
                <MenuItem value="completed">Завершено</MenuItem>
                <MenuItem value="failed">Ошибка</MenuItem>
                <MenuItem value="expired">Просрочено</MenuItem>
                <MenuItem value="none">Без активной задачи</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>
        {mobileLayout ? <Stack spacing={1}>
          {loading && rows.length === 0 ? <Box sx={{ py: 3, textAlign: 'center' }}><CircularProgress size={24} /></Box> : null}
          {!loading && rows.length === 0 ? <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>Нет данных по агентам.</Typography> : null}
          {rows.map((agent) => {
            const capabilities = agentCapabilities(agent);
            const pending = Number(agent?.last_heartbeat?.metadata?.outbox_depth || 0);
            const dead = Number(agent?.last_heartbeat?.metadata?.dead_letter_depth || 0);
            return (
              <Paper key={agent.agent_id} variant="outlined" sx={{ p: 1.25, borderRadius: 1.5 }}>
                <Stack spacing={1.1}>
                  <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="flex-start">
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{String(agent.hostname || agent.agent_id || '').trim() || '-'}</Typography>
                      <Typography variant="caption" color="text.secondary">{String(agent.branch || '').trim() || 'Без филиала'} · {String(agent.ip_address || '').trim() || 'IP неизвестен'}</Typography>
                    </Box>
                    <Chip size="small" color={agent.is_online ? 'success' : 'default'} label={agent.is_online ? 'В сети' : 'Не в сети'} />
                  </Stack>
                  <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
                    <Chip size="small" variant="outlined" color={capabilities.version && capabilities.version !== expectedAgentVersion ? 'warning' : 'default'} label={`Агент ${capabilities.version || 'без версии'}`} />
                    {capabilities.analysisVersion ? <Chip size="small" variant="outlined" label={capabilities.analysisVersion} /> : null}
                    <Chip size="small" color={pending > 0 ? 'warning' : 'default'} label={`К отправке: ${pending}`} />
                    {dead > 0 ? <Chip size="small" color="error" label={`Dead-letter: ${dead}`} /> : null}
                  </Stack>
                  <Typography variant="caption" color="text.secondary">Heartbeat: {formatTs(agent.last_seen_at)} · {formatLastSeen(agent.age_seconds, agent.is_online)}</Typography>
                  {agent.active_task ? <Alert severity="info" icon={false} sx={{ py: 0.35 }}>{commandLabel(agent.active_task.command, agent.active_task)} · {renderTaskStatusLabel(agent.active_task)}</Alert> : null}
                  {renderActions(agent, true)}
                </Stack>
              </Paper>
            );
          })}
        </Stack> : (

        <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 560 }}>
          <Table stickyHeader size="small" sx={{ minWidth: 1160 }}>
            <TableHead>
              <TableRow>
                {[
                  ['hostname', 'Hostname'],
                  ['branch', 'Филиал'],
                  ['ip_address', 'IP'],
                  ['online', 'Связь'],
                  ['last_seen_at', 'Последний heartbeat'],
                  ['active_task', 'Активная задача'],
                  ['queue_size', 'Очередь'],
                  ['last_result', 'Последняя задача'],
                ].map(([key, label]) => (
                  <TableCell key={key} sortDirection={sortBy === key ? sortDir : false}>
                    <TableSortLabel active={sortBy === key} direction={sortBy === key ? sortDir : 'desc'} onClick={() => onSort(key)}>
                      {label}
                    </TableSortLabel>
                  </TableCell>
                ))}
                <TableCell align="right">Действия</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && rows.length === 0 ? (
                <TableRow><TableCell colSpan={9} align="center"><CircularProgress size={24} /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={9} align="center">Нет данных по агентам.</TableCell></TableRow>
              ) : rows.map((agent) => (
                <TableRow hover key={agent.agent_id}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{String(agent.hostname || agent.agent_id || '').trim() || '-'}</Typography>
                    <Typography variant="caption" color="text.secondary">{String(agent.agent_id || '').trim() || '-'}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      Агент {agentCapabilities(agent).version || 'без версии'}{agentCapabilities(agent).analysisVersion ? ` · ${agentCapabilities(agent).analysisVersion}` : ''}
                    </Typography>
                  </TableCell>
                  <TableCell>{String(agent.branch || '').trim() || 'Без филиала'}</TableCell>
                  <TableCell>{String(agent.ip_address || '').trim() || '-'}</TableCell>
                  <TableCell>
                    <Chip size="small" color={agent.is_online ? 'success' : 'default'} label={agent.is_online ? 'В сети' : 'Не в сети'} />
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                      {formatLastSeen(agent.age_seconds, agent.is_online)}
                    </Typography>
                  </TableCell>
                  <TableCell>{formatTs(agent.last_seen_at)}</TableCell>
                  <TableCell>
                    {agent.active_task ? (
                      <Stack direction="row" spacing={0.8} useFlexGap flexWrap="wrap">
                        <Chip size="small" variant="outlined" label={String(agent.active_task.command || '').toLowerCase() === 'scan_now' ? commandLabel(agent.active_task.command, agent.active_task) : 'Проверка связи'} />
                        <Chip size="small" color={taskStatusColor(agent.active_task.status)} label={renderTaskStatusLabel(agent.active_task)} />
                      </Stack>
                    ) : '-'}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{Number(agent.queue_size || 0)}</Typography>
                    {Number(agent?.last_heartbeat?.metadata?.outbox_depth || 0) > 0 && (
                      <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>
                        Локально не отправлено: {Number(agent.last_heartbeat.metadata.outbox_depth)}
                      </Typography>
                    )}
                    {Number(agent?.last_heartbeat?.metadata?.dead_letter_depth || 0) > 0 && (
                      <Typography variant="caption" color="error.main" sx={{ display: 'block' }}>
                        Dead-letter: {Number(agent.last_heartbeat.metadata.dead_letter_depth)}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {agent.last_task ? (
                      <>
                        <Typography variant="body2">{renderTaskSummary(agent.last_task)}</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {`${commandLabel(agent.last_task.command, agent.last_task)} · ${taskStatusLabel(agent.last_task.status)}`}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {`${taskTimestampLabel(agent.last_task)}: ${formatTaskTimestamp(agent.last_task)}`}
                        </Typography>
                      </>
                    ) : '-'}
                  </TableCell>
                  <TableCell align="right">
                    {renderActions(agent)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        )}
        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_, nextPage) => onPageChange(nextPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(event) => onRowsPerPageChange(Number(event.target.value))}
          rowsPerPageOptions={rowsPerPageOptions}
          labelRowsPerPage="Строк на странице"
        />
      </Stack>
    </Paper>
  );
}
