import React, { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  LinearProgress,
  Menu,
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
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import {
  MoreVert as MoreVertIcon,
  PlayArrow as PlayArrowIcon,
} from '@mui/icons-material';
import { useTheme } from '@mui/material/styles';

const cellSx = { py: 0.75, px: 1 };

function agentCapabilities(agent) {
  const metadata = agent?.last_heartbeat?.metadata || {};
  return {
    version: String(agent?.version || agent?.agent_version || metadata.agent_version || '').trim(),
    analysisVersion: String(agent?.analysis_version || metadata.analysis_version || '').trim(),
  };
}

function agentOpsSignals(agent) {
  const metadata = agent?.last_heartbeat?.metadata || {};
  const pending = Number(metadata.outbox_depth || 0);
  const dead = Number(metadata.dead_letter_depth || 0);
  const outboxStale = Boolean(metadata.outbox_stale)
    || (Number(metadata.outbox_oldest_age_sec || 0) >= 30 * 60 && pending > 0);
  const pendingUpdate = Boolean(metadata.pending_update);
  const legacyPath = Boolean(metadata.legacy_itinvent_present);
  const lowDisk = Boolean(metadata.low_disk);
  return { pending, dead, outboxStale, pendingUpdate, legacyPath, lowDisk, metadata };
}

function AgentRowActions({
  agent,
  canScanTasks,
  busyTaskAgent,
  isActiveTask,
  expectedAgentVersion,
  onOpenScan,
  onPing,
  onSelfUpdate,
  onOpenHost,
  mobile = false,
}) {
  const [anchorEl, setAnchorEl] = useState(null);
  const menuOpen = Boolean(anchorEl);
  const busy = !canScanTasks || busyTaskAgent === agent.agent_id || isActiveTask(agent.active_task);
  const { version } = agentCapabilities(agent);
  const needsUpdate = Boolean(expectedAgentVersion) && (
    !version || version !== expectedAgentVersion
  );

  const closeMenu = () => setAnchorEl(null);

  return (
    <Stack
      direction={mobile ? 'column' : 'row'}
      spacing={0.5}
      justifyContent="flex-end"
      alignItems={mobile ? 'stretch' : 'center'}
    >
      {needsUpdate ? (
        <Button
          type="button"
          size="small"
          variant="outlined"
          color="warning"
          disabled={busy}
          onClick={() => onSelfUpdate(agent.agent_id)}
        >
          Обновить
        </Button>
      ) : null}
      <Button
        type="button"
        size="small"
        variant="contained"
        startIcon={<PlayArrowIcon />}
        disabled={busy}
        onClick={() => onOpenScan(agent.agent_id, false)}
      >
        Сканировать
      </Button>
      <IconButton
        type="button"
        size="small"
        aria-label="Действия"
        aria-haspopup="true"
        aria-expanded={menuOpen ? 'true' : undefined}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        sx={{ alignSelf: mobile ? 'flex-end' : undefined }}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={menuOpen}
        onClose={closeMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {needsUpdate ? (
          <MenuItem
            disabled={busy}
            onClick={() => {
              closeMenu();
              onSelfUpdate(agent.agent_id);
            }}
          >
            Обновить агент
          </MenuItem>
        ) : null}
        <MenuItem
          disabled={busy}
          onClick={() => {
            closeMenu();
            onOpenScan(agent.agent_id, true);
          }}
        >
          Скан с 0
        </MenuItem>
        <MenuItem
          disabled={busy}
          onClick={() => {
            closeMenu();
            onPing(agent.agent_id);
          }}
        >
          Проверить связь
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu();
            onOpenHost(agent.hostname || agent.agent_id);
          }}
        >
          Инциденты
        </MenuItem>
      </Menu>
    </Stack>
  );
}

function HostnameCell({ agent, expectedAgentVersion }) {
  const hostname = String(agent.hostname || agent.agent_id || '').trim() || '-';
  const agentId = String(agent.agent_id || '').trim();
  const showAgentId = Boolean(agentId) && agentId.toLowerCase() !== hostname.toLowerCase();
  const { version } = agentCapabilities(agent);
  const ops = agentOpsSignals(agent);
  const versionOutdated = Boolean(version) && version !== expectedAgentVersion;
  const versionMissing = !version;

  return (
    <Stack spacing={0.25} alignItems="flex-start">
      <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
        {hostname}
      </Typography>
      {showAgentId ? (
        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
          {agentId}
        </Typography>
      ) : null}
      <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
        {versionOutdated || versionMissing ? (
          <Chip
            size="small"
            variant="outlined"
            color="warning"
            label={versionMissing ? 'Без версии' : `Агент ${version}`}
            sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem' } }}
          />
        ) : null}
        {ops.pendingUpdate ? (
          <Chip
            size="small"
            color="warning"
            label="Обновление…"
            sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem' } }}
          />
        ) : null}
        {ops.legacyPath ? (
          <Chip
            size="small"
            color="warning"
            variant="outlined"
            label="Legacy IT-Invent"
            sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem' } }}
          />
        ) : null}
        {ops.lowDisk ? (
          <Chip
            size="small"
            color="error"
            label="Мало места"
            sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem' } }}
          />
        ) : null}
      </Stack>
    </Stack>
  );
}

function ConnectionCell({ agent, formatLastSeen, formatTs }) {
  const absolute = formatTs(agent.last_seen_at);
  const relative = formatLastSeen(agent.age_seconds, agent.is_online);

  return (
    <Tooltip title={absolute || 'Нет данных'} placement="top" enterDelay={400}>
      <Stack spacing={0.25} sx={{ cursor: 'default' }}>
        <Chip
          size="small"
          color={agent.is_online ? 'success' : 'default'}
          label={agent.is_online ? 'В сети' : 'Не в сети'}
          sx={{ alignSelf: 'flex-start', height: 22 }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
          {relative}
        </Typography>
      </Stack>
    </Tooltip>
  );
}

function TaskCell({
  agent,
  commandLabel,
  renderTaskStatusLabel,
  renderTaskSummary,
  taskStatusColor,
  taskStatusLabel,
  taskTimestampLabel,
  formatTaskTimestamp,
}) {
  if (agent.active_task) {
    const commandText = commandLabel(agent.active_task.command, agent.active_task);
    return (
      <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" alignItems="center">
        <Chip size="small" variant="outlined" label={commandText} sx={{ height: 22 }} />
        <Chip
          size="small"
          color={taskStatusColor(agent.active_task)}
          label={renderTaskStatusLabel(agent.active_task)}
          sx={{ height: 22 }}
        />
      </Stack>
    );
  }

  if (!agent.last_task) return '-';

  return (
    <>
      <Typography variant="body2" sx={{ lineHeight: 1.3 }}>
        {renderTaskSummary(agent.last_task)}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>
        {`${commandLabel(agent.last_task.command, agent.last_task)} · ${renderTaskStatusLabel(agent.last_task)} · ${taskTimestampLabel(agent.last_task)}: ${formatTaskTimestamp(agent.last_task)}`}
      </Typography>
    </>
  );
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
  outdatedAgents = 0,
  agentsOnlineTotal = 0,
  formatters,
  onQueryChange,
  onOnlineChange,
  onTaskStatusChange,
  onSort,
  onPageChange,
  onRowsPerPageChange,
  onOpenScan,
  onPing,
  onSelfUpdate,
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
  // Below lg content is full-width but still narrow — cards avoid clipped action columns.
  const mobileLayout = useMediaQuery(theme.breakpoints.down('lg'));

  if (!visible) return null;

  const actionProps = {
    canScanTasks,
    busyTaskAgent,
    isActiveTask,
    expectedAgentVersion,
    onOpenScan,
    onPing,
    onSelfUpdate,
    onOpenHost,
  };

  const outdatedCount = Number(outdatedAgents || 0);
  const fleetTotal = Number(agentsOnlineTotal || 0) || Number(total || 0);
  const versionHint = `Ожидаемая версия: ${expectedAgentVersion || 'не указана сервером'}. Ненулевая очередь — результаты ещё не дошли до сервера.`;

  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 2 }, mb: 2, maxWidth: '100%', minWidth: 0 }}>
      <Stack spacing={1.5} sx={{ minWidth: 0, maxWidth: '100%' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1 }}>
          <Box sx={{ minWidth: 0, flex: '1 1 220px' }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>Агенты и задания</Typography>
            <Tooltip title={versionHint}>
              <Typography variant="body2" color="text.secondary" sx={{ cursor: 'help', overflowWrap: 'anywhere' }}>
                Связь, очередь и последняя команда · версия {expectedAgentVersion || 'н/д'}
              </Typography>
            </Tooltip>
          </Box>
          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" alignItems="center">
            {outdatedCount > 0 ? (
              <Chip
                size="small"
                color="warning"
                label={`Обновить: ${outdatedCount}${fleetTotal ? `/${fleetTotal}` : ''} → ${expectedAgentVersion || '?'}`}
                sx={{ maxWidth: '100%' }}
              />
            ) : null}
            <Chip size="small" label={`Всего: ${total}`} />
          </Stack>
        </Box>
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
        {loading && rows.length > 0 ? <LinearProgress sx={{ borderRadius: 1 }} /> : null}
        {mobileLayout ? (
          <Stack spacing={1} sx={{ opacity: loading && rows.length > 0 ? 0.55 : 1, transition: 'opacity 120ms' }}>
            {loading && rows.length === 0 ? (
              <Box sx={{ py: 3, textAlign: 'center' }}><CircularProgress size={24} /></Box>
            ) : null}
            {!loading && rows.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>Нет данных по агентам.</Typography>
            ) : null}
            {rows.map((agent) => {
              const { version } = agentCapabilities(agent);
              const ops = agentOpsSignals(agent);
              const versionOutdated = Boolean(version) && version !== expectedAgentVersion;
              const versionMissing = !version;
              return (
                <Paper key={agent.agent_id} variant="outlined" sx={{ p: 1.25, borderRadius: 1.5 }}>
                  <Stack spacing={1}>
                    <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="flex-start">
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                          {String(agent.hostname || agent.agent_id || '').trim() || '-'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {String(agent.branch || '').trim() || 'Без филиала'} · {String(agent.ip_address || '').trim() || 'IP неизвестен'}
                        </Typography>
                      </Box>
                      <Tooltip title={formatTs(agent.last_seen_at) || 'Нет данных'}>
                        <Chip size="small" color={agent.is_online ? 'success' : 'default'} label={agent.is_online ? 'В сети' : 'Не в сети'} />
                      </Tooltip>
                    </Stack>
                    <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
                      {versionOutdated || versionMissing ? (
                        <Chip
                          size="small"
                          variant="outlined"
                          color="warning"
                          label={versionMissing ? 'Без версии' : `Агент ${version}`}
                        />
                      ) : null}
                      {ops.pendingUpdate ? <Chip size="small" color="warning" label="Обновление…" /> : null}
                      {ops.pending > 0 ? <Chip size="small" color="warning" label={`К отправке: ${ops.pending}`} /> : null}
                      {ops.outboxStale ? <Chip size="small" color="error" label="Outbox завис" /> : null}
                      {ops.dead > 0 ? <Chip size="small" color="error" label={`Dead-letter: ${ops.dead}`} /> : null}
                      {ops.legacyPath ? <Chip size="small" color="warning" variant="outlined" label="Legacy IT-Invent" /> : null}
                      {ops.lowDisk ? <Chip size="small" color="error" label="Мало места" /> : null}
                      <Chip size="small" variant="outlined" label={`Очередь: ${Number(agent.queue_size || 0)}`} />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {formatLastSeen(agent.age_seconds, agent.is_online)}
                    </Typography>
                    {agent.active_task ? (
                      <Typography variant="body2">
                        {commandLabel(agent.active_task.command, agent.active_task)} · {renderTaskStatusLabel(agent.active_task)}
                      </Typography>
                    ) : agent.last_task ? (
                      <Box>
                        <Typography variant="body2">{renderTaskSummary(agent.last_task)}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {`${commandLabel(agent.last_task.command, agent.last_task)} · ${renderTaskStatusLabel(agent.last_task)}`}
                        </Typography>
                      </Box>
                    ) : null}
                    <AgentRowActions agent={agent} mobile {...actionProps} />
                  </Stack>
                </Paper>
              );
            })}
          </Stack>
        ) : (
          <TableContainer
            component={Paper}
            variant="outlined"
            sx={{
              width: '100%',
              maxWidth: '100%',
              maxHeight: 560,
              overflowX: 'auto',
              overflowY: 'auto',
              opacity: loading && rows.length > 0 ? 0.55 : 1,
              transition: 'opacity 120ms',
            }}
          >
            <Table stickyHeader size="small" sx={{ minWidth: 960 }}>
              <TableHead>
                <TableRow>
                  {[
                    ['hostname', 'Hostname'],
                    ['branch', 'Филиал'],
                    ['ip_address', 'IP'],
                    ['online', 'Связь'],
                    ['queue_size', 'Очередь'],
                    ['last_result', 'Задача'],
                  ].map(([key, label]) => (
                    <TableCell key={key} sortDirection={sortBy === key ? sortDir : false} sx={cellSx}>
                      <TableSortLabel active={sortBy === key} direction={sortBy === key ? sortDir : 'desc'} onClick={() => onSort(key)}>
                        {label}
                      </TableSortLabel>
                    </TableCell>
                  ))}
                  <TableCell align="right" sx={cellSx}>Действия</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading && rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={cellSx}><CircularProgress size={24} /></TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={cellSx}>Нет данных по агентам.</TableCell>
                  </TableRow>
                ) : rows.map((agent) => (
                  <TableRow hover key={agent.agent_id}>
                    <TableCell sx={cellSx}>
                      <HostnameCell agent={agent} expectedAgentVersion={expectedAgentVersion} />
                    </TableCell>
                    <TableCell sx={cellSx}>{String(agent.branch || '').trim() || 'Без филиала'}</TableCell>
                    <TableCell sx={cellSx}>{String(agent.ip_address || '').trim() || '-'}</TableCell>
                    <TableCell sx={cellSx}>
                      <ConnectionCell agent={agent} formatLastSeen={formatLastSeen} formatTs={formatTs} />
                    </TableCell>
                    <TableCell sx={cellSx}>
                      {(() => {
                        const ops = agentOpsSignals(agent);
                        return (
                          <>
                            <Typography variant="body2">{Number(agent.queue_size || 0)}</Typography>
                            {ops.pending > 0 ? (
                              <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>
                                Локально не отправлено: {ops.pending}
                              </Typography>
                            ) : null}
                            {ops.outboxStale ? (
                              <Typography variant="caption" color="error.main" sx={{ display: 'block' }}>
                                Outbox завис
                              </Typography>
                            ) : null}
                            {ops.dead > 0 ? (
                              <Typography variant="caption" color="error.main" sx={{ display: 'block' }}>
                                Dead-letter: {ops.dead}
                              </Typography>
                            ) : null}
                            {ops.pendingUpdate ? (
                              <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>
                                Обновление не подтверждено
                              </Typography>
                            ) : null}
                          </>
                        );
                      })()}
                    </TableCell>
                    <TableCell sx={cellSx}>
                      <TaskCell
                        agent={agent}
                        commandLabel={commandLabel}
                        renderTaskStatusLabel={renderTaskStatusLabel}
                        renderTaskSummary={renderTaskSummary}
                        taskStatusColor={taskStatusColor}
                        taskStatusLabel={taskStatusLabel}
                        taskTimestampLabel={taskTimestampLabel}
                        formatTaskTimestamp={formatTaskTimestamp}
                      />
                    </TableCell>
                    <TableCell align="right" sx={cellSx}>
                      <AgentRowActions agent={agent} {...actionProps} />
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
