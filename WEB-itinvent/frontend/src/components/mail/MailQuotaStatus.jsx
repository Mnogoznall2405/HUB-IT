import { Box, Chip, LinearProgress, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { resolveEffectiveQuotaBytes, resolveEffectiveUsedPercent } from './mailQuotaDefaults';

export const QUOTA_STATUS = {
  critical: 'critical',
  warning: 'warning',
  ok: 'ok',
  unlimited: 'unlimited',
  defaultQuota: 'defaultQuota',
  unknown: 'unknown',
};

export function resolveQuotaStatus(row) {
  const quotaBytes = resolveEffectiveQuotaBytes(row);
  const usedPercent = resolveEffectiveUsedPercent(row);
  if (quotaBytes == null) {
    return QUOTA_STATUS.unknown;
  }
  if (!Number.isFinite(usedPercent)) {
    return row?.uses_default_quota ? QUOTA_STATUS.defaultQuota : QUOTA_STATUS.unknown;
  }
  if (usedPercent >= 100) {
    return QUOTA_STATUS.critical;
  }
  if (usedPercent >= 90) {
    return QUOTA_STATUS.warning;
  }
  return QUOTA_STATUS.ok;
}

const STATUS_META = {
  [QUOTA_STATUS.critical]: { label: 'Переполнен', color: 'error' },
  [QUOTA_STATUS.warning]: { label: '90–100%', color: 'warning' },
  [QUOTA_STATUS.ok]: { label: 'Норма', color: 'success' },
  [QUOTA_STATUS.unlimited]: { label: 'Лимит не задан', color: 'default' },
  [QUOTA_STATUS.defaultQuota]: { label: 'По умолч. 5 ГБ', color: 'default' },
  [QUOTA_STATUS.unknown]: { label: '—', color: 'default' },
};

export function getQuotaRowSx(status, theme) {
  if (status === QUOTA_STATUS.critical) {
    return { bgcolor: alpha(theme.palette.error.main, theme.palette.mode === 'dark' ? 0.16 : 0.08) };
  }
  if (status === QUOTA_STATUS.warning) {
    return { bgcolor: alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.16 : 0.08) };
  }
  return {};
}

export function QuotaStatusChip({ row }) {
  const status = resolveQuotaStatus(row);
  const meta = STATUS_META[status] || STATUS_META[QUOTA_STATUS.unknown];
  return (
    <Chip
      size="small"
      label={meta.label}
      color={meta.color}
      variant={status === QUOTA_STATUS.unlimited || status === QUOTA_STATUS.defaultQuota || status === QUOTA_STATUS.unknown ? 'outlined' : 'filled'}
      data-testid={`quota-status-${status}`}
    />
  );
}

export function QuotaUsageBar({ row, compact = false }) {
  const theme = useTheme();
  const status = resolveQuotaStatus(row);
  const usedPercent = resolveEffectiveUsedPercent(row);
  const value = Number.isFinite(usedPercent) ? Math.min(Math.max(usedPercent, 0), 100) : null;

  if (value == null) {
    return <Typography variant="body2" color="text.secondary">—</Typography>;
  }

  const barColor = status === QUOTA_STATUS.critical
    ? theme.palette.error.main
    : status === QUOTA_STATUS.warning
      ? theme.palette.warning.main
      : theme.palette.success.main;

  return (
    <Box sx={{ minWidth: compact ? 0 : 88 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: compact ? 0.15 : 0.35 }}>
        <Typography variant="caption" sx={{ fontWeight: 700, fontSize: compact ? '0.68rem' : undefined, lineHeight: 1 }}>
          {value.toFixed(1)}%
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={value}
        sx={{
          height: compact ? 5 : 8,
          borderRadius: 999,
          bgcolor: alpha(barColor, 0.18),
          '& .MuiLinearProgress-bar': {
            borderRadius: 999,
            bgcolor: barColor,
          },
        }}
      />
    </Box>
  );
}
