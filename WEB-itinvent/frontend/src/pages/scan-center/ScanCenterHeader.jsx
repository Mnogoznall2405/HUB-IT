import React from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  PlayArrowOutlined as PlayArrowOutlinedIcon,
  Refresh as RefreshIcon,
  ShieldOutlined as ShieldOutlinedIcon,
} from '@mui/icons-material';

function getHealthState(totals) {
  const incidents = Number(totals.incidents_new || 0);
  const incomplete = Number(totals.analysis_incomplete || totals.server_pdf_incomplete || 0);
  const queue = Number(totals.server_pdf_pending || 0);
  if (incidents + incomplete > 0) {
    return { color: 'warning', label: `${incidents + incomplete} требуют внимания` };
  }
  if (queue > 0) return { color: 'info', label: `${queue} в очереди` };
  return { color: 'success', label: 'Контур работает' };
}

export default function ScanCenterHeader({
  dashboard,
  taskNotice,
  autoRefreshPaused,
  refreshing,
  branchOptions,
  branchOptionsLoading,
  branchFilter,
  onDismissNotice,
  onAutoRefreshChange,
  onRefresh,
  onBranchChange,
  onOpenAgents,
}) {
  const totals = dashboard?.totals || {};
  const health = getHealthState(totals);

  return (
    <Stack spacing={1.25} sx={{ mb: 2 }}>
      <Paper variant="outlined" sx={{ p: { xs: 1.25, md: 1.5 }, borderRadius: 2 }}>
        <Stack spacing={1.25}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, mr: { sm: 'auto' }, width: { xs: '100%', sm: 'auto' } }}>
              <Box sx={{ width: 36, height: 36, borderRadius: 1.5, bgcolor: 'primary.main', color: 'primary.contrastText', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <ShieldOutlinedIcon fontSize="small" />
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="h6" sx={{ fontWeight: 850, lineHeight: 1.2 }}>Контроль документов</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
                  OCR: страницы 1–3 · текст PDF: страницы 1–10 · {dashboard?.analysis_version || 'текущая версия правил'}
                </Typography>
              </Box>
              <Chip size="small" color={health.color} label={health.label} sx={{ flexShrink: 0 }} />
            </Box>

            <Autocomplete
              size="small"
              options={branchOptions}
              loading={branchOptionsLoading}
              value={branchOptions.includes(branchFilter) ? branchFilter : null}
              onChange={(_, nextValue) => onBranchChange(nextValue || '')}
              clearOnEscape
              noOptionsText="Филиалы не найдены"
              loadingText="Загрузка филиалов…"
              sx={{ width: { xs: '100%', sm: 270 }, minWidth: 0 }}
              renderInput={(params) => <TextField {...params} label="Филиал" placeholder="Все филиалы" />}
            />

            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ width: { xs: '100%', sm: 'auto' } }}>
              <Button type="button" variant="contained" startIcon={<PlayArrowOutlinedIcon />} onClick={onOpenAgents} sx={{ flex: { xs: '1 1 auto', sm: '0 0 auto' } }}>
                Запустить скан
              </Button>
              <Tooltip title="Обновить данные сейчас">
                <span style={{ flex: '1 1 auto' }}>
                  <Button
                    type="button"
                    variant="outlined"
                    fullWidth
                    startIcon={refreshing ? <CircularProgress size={16} /> : <RefreshIcon />}
                    onClick={onRefresh}
                    disabled={refreshing}
                  >
                    Обновить
                  </Button>
                </span>
              </Tooltip>
            </Stack>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
            <FormControlLabel
              sx={{ m: 0 }}
              control={<Switch size="small" checked={!autoRefreshPaused} onChange={(event) => onAutoRefreshChange(event.target.checked)} />}
              label={<Typography variant="caption">{autoRefreshPaused ? 'Автообновление выключено' : 'Автообновление каждые 30 секунд'}</Typography>}
            />
            <Typography variant="caption" color="text.secondary" sx={{ ml: { sm: 'auto' } }}>
              Неполный анализ никогда не считается чистым результатом
            </Typography>
          </Box>
        </Stack>
      </Paper>

      {taskNotice ? <Alert severity={taskNotice.severity} onClose={onDismissNotice}>{taskNotice.text}</Alert> : null}
    </Stack>
  );
}
