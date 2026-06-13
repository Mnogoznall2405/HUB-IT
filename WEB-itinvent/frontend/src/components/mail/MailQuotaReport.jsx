import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import { alpha, useTheme } from '@mui/material/styles';
import { mailMailboxQuotasAPI } from '../../api/mailMailboxQuotas';
import { buildMailUiTokens, getMailTextFieldSx } from './mailUiTokens';
import { QuotaStatusChip, QuotaUsageBar, getQuotaRowSx, resolveQuotaStatus } from './MailQuotaStatus';

const ROWS_LIMIT = 500;
const SEARCH_DEBOUNCE_MS = 300;

function formatBytes(value, { unlimitedLabel = null } = {}) {
  if (value == null || value === '') {
    return unlimitedLabel ?? '—';
  }
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) {
    return unlimitedLabel ?? '—';
  }
  if (bytes === 0) {
    return unlimitedLabel ?? '0 B';
  }
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('ru-RU');
}

function hoursAgo(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - date.getTime()) / (60 * 60 * 1000)));
}

function formatLimit(row) {
  if (row?.uses_default_quota) {
    return `${formatBytes(row.quota_bytes)} по умолч.`;
  }
  return formatBytes(row?.quota_bytes, { unlimitedLabel: '—' });
}

function exportRowsCsv(rows, snapshot) {
  const header = ['DisplayName', 'Email', 'UsedBytes', 'QuotaBytes', 'FreeBytes', 'UsedPercent', 'Database'];
  const lines = [header.join(';')];
  rows.forEach((row) => {
    lines.push([
      `"${String(row.display_name || '').replace(/"/g, '""')}"`,
      row.email || '',
      row.used_bytes ?? '',
      row.quota_bytes ?? '',
      row.free_bytes ?? '',
      row.used_percent ?? '',
      `"${String(row.database_name || '').replace(/"/g, '""')}"`,
    ].join(';'));
  });
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `mailbox_quotas_${snapshot?.id || 'export'}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function MetricPill({
  label,
  value,
  helper,
  active,
  color,
  onClick,
  testId,
}) {
  const theme = useTheme();

  return (
    <Button
      data-testid={testId}
      onClick={onClick}
      variant="text"
      sx={{
        flex: { xs: '1 1 calc(50% - 6px)', sm: '0 0 auto' },
        minWidth: { xs: 0, sm: 142 },
        minHeight: 50,
        justifyContent: 'flex-start',
        px: 1.2,
        py: 0.75,
        borderRadius: 1,
        textAlign: 'left',
        textTransform: 'none',
        color: 'text.primary',
        border: '1px solid',
        borderColor: active ? alpha(color, 0.55) : theme.palette.divider,
        bgcolor: active ? alpha(color, theme.palette.mode === 'dark' ? 0.2 : 0.1) : 'background.paper',
        boxShadow: 'none',
        '&:hover': {
          borderColor: alpha(color, 0.58),
          bgcolor: alpha(color, theme.palette.mode === 'dark' ? 0.24 : 0.13),
          boxShadow: 'none',
        },
      }}
    >
      <Stack spacing={0.1} sx={{ minWidth: 0 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.15 }}>
          {label}
        </Typography>
        <Typography sx={{ fontWeight: 800, fontSize: '1.12rem', lineHeight: 1.1 }}>
          {value}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.15 }} noWrap>
          {helper}
        </Typography>
      </Stack>
    </Button>
  );
}

function QuotaEmptyState({ loading, colSpan = 7 }) {
  if (loading) {
    return (
      <TableRow>
        <TableCell colSpan={colSpan} align="center" sx={{ py: 4 }}>
          <CircularProgress size={28} />
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell colSpan={colSpan} align="center" sx={{ py: 4 }}>
        Нет данных
      </TableCell>
    </TableRow>
  );
}

function MobileStat({ label, value }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: '0.88rem', fontWeight: 700, lineHeight: 1.25 }} noWrap>
        {value}
      </Typography>
    </Box>
  );
}

function MobileQuotaRow({ row, tokens, theme }) {
  const status = resolveQuotaStatus(row);

  return (
    <Box
      data-testid="quota-mobile-row"
      sx={{
        p: 1,
        borderRadius: tokens.radiusSm,
        border: '1px solid',
        borderColor: tokens.panelBorder,
        bgcolor: tokens.panelSolid,
        ...getQuotaRowSx(status, theme),
      }}
    >
      <Stack spacing={0.85}>
        <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '0.95rem', lineHeight: 1.2 }} noWrap>
              {row.display_name || row.email || '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
              {row.email || '—'}
            </Typography>
          </Box>
          <QuotaStatusChip row={row} />
        </Stack>

        <QuotaUsageBar row={row} />

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 0.75,
          }}
        >
          <MobileStat label="Занято" value={formatBytes(row.used_bytes)} />
          <MobileStat label="Лимит" value={formatLimit(row)} />
          <MobileStat label="Осталось" value={formatBytes(row.free_bytes)} />
          <MobileStat label="База" value={row.database_name || '—'} />
        </Box>
      </Stack>
    </Box>
  );
}

export default function MailQuotaReport({ isMobile = false }) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState('all');
  const [databaseName, setDatabaseName] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadData = useCallback(async ({ searchOverride } = {}) => {
    setLoading(true);
    setError('');
    const effectiveSearch = typeof searchOverride === 'string' ? searchOverride : debouncedSearch;
    try {
      const latest = await mailMailboxQuotasAPI.getLatestSnapshot();
      setSnapshot(latest);
      const [page, stats] = await Promise.all([
        mailMailboxQuotasAPI.listRows(latest.id, {
          search: effectiveSearch || undefined,
          warning_90: quickFilter === 'warning' ? true : undefined,
          over_quota: quickFilter === 'over' ? true : undefined,
          no_quota: quickFilter === 'no_quota' ? true : undefined,
          database_name: databaseName || undefined,
          limit: ROWS_LIMIT,
          offset: 0,
        }),
        mailMailboxQuotasAPI.getSnapshotSummary(latest.id),
      ]);
      setSummary(stats);
      setRows(Array.isArray(page?.items) ? page.items : []);
      setTotal(Number(page?.total || 0));
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Не удалось загрузить отчёт по квотам');
      setSnapshot(null);
      setSummary(null);
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [databaseName, debouncedSearch, quickFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const staleHours = hoursAgo(snapshot?.collected_at || snapshot?.imported_at);

  const toggleQuickFilter = useCallback((next) => {
    setQuickFilter((current) => (current === next ? 'all' : next));
  }, []);

  const resetFilters = useCallback(() => {
    setQuickFilter('all');
    setDatabaseName('');
    setSearchInput('');
    setDebouncedSearch('');
  }, []);

  const databaseOptions = useMemo(
    () => (Array.isArray(summary?.by_database) ? summary.by_database : []),
    [summary],
  );

  const hasActiveFilters = quickFilter !== 'all' || Boolean(databaseName.trim()) || Boolean(searchInput.trim());
  const activeSearch = searchInput.trim();

  const renderRowsSummary = () => (
    <Typography variant="caption" color="text.secondary">
      Показано {rows.length} из {total}
      {summary?.total != null ? ` · в снимке ${summary.total}` : ''}
      {hasActiveFilters ? ' · применены фильтры' : ''}
      {total > ROWS_LIMIT ? ` · максимум ${ROWS_LIMIT} строк за запрос` : ''}
    </Typography>
  );

  return (
    <Box
      data-testid="mail-quota-report"
      sx={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: tokens.panelBg,
        borderRadius: { xs: tokens.radiusSm, md: tokens.radiusMd },
        border: '1px solid',
        borderColor: tokens.panelBorder,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          px: { xs: 1.1, md: 1.5 },
          py: { xs: 1, md: 1.1 },
          borderBottom: '1px solid',
          borderColor: tokens.panelBorder,
          bgcolor: tokens.panelSolid,
        }}
      >
        <Stack spacing={1}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={0.6} justifyContent="space-between" alignItems={{ md: 'center' }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 800, fontSize: { xs: '1rem', md: '1.05rem' }, lineHeight: 1.2 }}>
                Квоты почтовых ящиков
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: { xs: '0.78rem', md: '0.84rem' } }}>
                {snapshot
                  ? `Снимок #${snapshot.id} · ${formatDateTime(snapshot.collected_at || snapshot.imported_at)} · ${snapshot.source_host || 'источник не указан'}`
                  : 'Снимок не загружен'}
                {staleHours != null ? ` · ${staleHours} ч назад` : ''}
              </Typography>
            </Box>
          </Stack>

          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
            <MetricPill
              label="Всего"
              value={summary?.total ?? snapshot?.row_count ?? '—'}
              helper="Все ящики"
              active={!hasActiveFilters}
              onClick={resetFilters}
              color={theme.palette.primary.main}
              testId="quota-metric-total"
            />
            <MetricPill
              label="≥ 90%"
              value={summary?.warning_90 ?? '—'}
              helper="На грани"
              active={quickFilter === 'warning'}
              onClick={() => toggleQuickFilter('warning')}
              color={theme.palette.warning.main}
              testId="quota-metric-warning"
            />
            <MetricPill
              label="> 100%"
              value={summary?.over_quota ?? '—'}
              helper="Переполнено"
              active={quickFilter === 'over'}
              onClick={() => toggleQuickFilter('over')}
              color={theme.palette.error.main}
              testId="quota-metric-over"
            />
            <MetricPill
              label="Лимит не задан"
              value={summary?.no_quota ?? '—'}
              helper="5 GB по умолч."
              active={quickFilter === 'no_quota'}
              onClick={() => toggleQuickFilter('no_quota')}
              color={theme.palette.info.main}
              testId="quota-metric-default"
            />
          </Stack>
        </Stack>
      </Box>

      {error ? <Alert severity="error" sx={{ m: 1.2 }}>{error}</Alert> : null}

      <Box
        sx={{
          px: { xs: 1.1, md: 1.5 },
          py: 1,
          borderBottom: '1px solid',
          borderColor: tokens.panelBorder,
          bgcolor: tokens.panelBg,
        }}
      >
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={0.8} alignItems={{ md: 'center' }}>
          <TextField
            size="small"
            placeholder="Поиск по email или ФИО"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            inputProps={{ 'aria-label': 'Поиск по квотам' }}
            sx={{
              ...getMailTextFieldSx(tokens),
              flex: { md: '1 1 320px' },
              minWidth: { md: 260 },
            }}
          />
          <TextField
            select
            size="small"
            value={quickFilter}
            onChange={(event) => setQuickFilter(event.target.value || 'all')}
            inputProps={{ 'aria-label': 'Фильтр статуса квоты' }}
            sx={{
              ...getMailTextFieldSx(tokens),
              minWidth: { xs: '100%', md: 178 },
            }}
          >
            <MenuItem value="all">Все статусы</MenuItem>
            <MenuItem value="warning">≥ 90%</MenuItem>
            <MenuItem value="over">&gt; 100%</MenuItem>
            <MenuItem value="no_quota">Лимит по умолчанию</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            value={databaseName}
            onChange={(event) => setDatabaseName(event.target.value)}
            inputProps={{ 'aria-label': 'Фильтр базы Exchange' }}
            sx={{
              ...getMailTextFieldSx(tokens),
              minWidth: { xs: '100%', md: 190 },
            }}
          >
            <MenuItem value="">Все базы</MenuItem>
            {databaseOptions.map((item) => (
              <MenuItem key={item.name} value={item.name}>
                {item.name} ({item.total})
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" spacing={0.65} sx={{ ml: { md: 'auto' } }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<RestartAltRoundedIcon />}
              disabled={!hasActiveFilters}
              onClick={resetFilters}
              sx={{ minHeight: 38, textTransform: 'none' }}
            >
              Сброс
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<DownloadRoundedIcon />}
              disabled={!rows.length}
              onClick={() => exportRowsCsv(rows, snapshot)}
              sx={{ minHeight: 38, textTransform: 'none' }}
            >
              CSV
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <RefreshRoundedIcon />}
              onClick={() => loadData({ searchOverride: activeSearch })}
              disabled={loading}
              sx={{ minHeight: 38, textTransform: 'none' }}
            >
              Обновить
            </Button>
          </Stack>
        </Stack>
      </Box>

      {isMobile ? (
        <Box
          data-testid="quota-mobile-list"
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            px: 1,
            py: 1,
            pb: 'calc(12px + env(safe-area-inset-bottom, 0px))',
          }}
        >
          {loading ? (
            <Box sx={{ py: 4, display: 'flex', justifyContent: 'center' }}>
              <CircularProgress size={28} />
            </Box>
          ) : null}
          {!loading && rows.length === 0 ? (
            <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>Нет данных</Box>
          ) : null}
          {!loading ? (
            <Stack spacing={0.75}>
              {rows.map((row) => (
                <MobileQuotaRow key={`${row.id}-${row.email}`} row={row} tokens={tokens} theme={theme} />
              ))}
            </Stack>
          ) : null}
        </Box>
      ) : (
        <TableContainer sx={{ flex: 1, minHeight: 0, overflow: 'auto', bgcolor: tokens.panelSolid }}>
          <Table stickyHeader size="small" sx={{ tableLayout: 'fixed' }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: '30%' }}>Ящик</TableCell>
                <TableCell sx={{ width: 134 }}>Статус</TableCell>
                <TableCell align="right" sx={{ width: 116 }}>Занято</TableCell>
                <TableCell align="right" sx={{ width: 136 }}>Лимит</TableCell>
                <TableCell align="right" sx={{ width: 116 }}>Осталось</TableCell>
                <TableCell sx={{ width: 140 }}>Заполнение</TableCell>
                <TableCell sx={{ width: 120 }}>БД</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading || rows.length === 0 ? <QuotaEmptyState loading={loading} /> : null}
              {!loading ? rows.map((row) => {
                const status = resolveQuotaStatus(row);
                return (
                  <TableRow
                    key={`${row.id}-${row.email}`}
                    hover
                    sx={{
                      ...getQuotaRowSx(status, theme),
                      '& .MuiTableCell-root': {
                        py: 0.72,
                      },
                    }}
                  >
                    <TableCell>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 700, fontSize: '0.9rem' }} noWrap>
                          {row.display_name || row.email || '—'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
                          {row.email || '—'}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell><QuotaStatusChip row={row} /></TableCell>
                    <TableCell align="right">{formatBytes(row.used_bytes)}</TableCell>
                    <TableCell align="right">{formatLimit(row)}</TableCell>
                    <TableCell align="right">{formatBytes(row.free_bytes)}</TableCell>
                    <TableCell><QuotaUsageBar row={row} /></TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap>{row.database_name || '—'}</Typography>
                    </TableCell>
                  </TableRow>
                );
              }) : null}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Box
        sx={{
          px: { xs: 1.1, md: 1.5 },
          py: 0.8,
          borderTop: '1px solid',
          borderColor: tokens.panelBorder,
          bgcolor: tokens.panelSolid,
        }}
      >
        {renderRowsSummary()}
      </Box>
    </Box>
  );
}
