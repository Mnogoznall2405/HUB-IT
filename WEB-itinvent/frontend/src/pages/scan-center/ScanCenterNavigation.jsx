import React, { memo } from 'react';
import {
  Box,
  Paper,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  ComputerOutlined as ComputerOutlinedIcon,
  DashboardOutlined as DashboardOutlinedIcon,
  GppMaybeOutlined as GppMaybeOutlinedIcon,
  ReportProblemOutlined as ReportProblemOutlinedIcon,
  SensorsOutlined as SensorsOutlinedIcon,
} from '@mui/icons-material';

const NAV_ITEMS = [
  { id: 'overview', label: 'Обзор', helper: 'Что требует внимания', icon: DashboardOutlinedIcon },
  { id: 'incidents', label: 'Инциденты', helper: 'Проверка находок', icon: GppMaybeOutlinedIcon },
  { id: 'review', label: 'Не проверено', helper: 'Ошибки анализа', icon: ReportProblemOutlinedIcon },
  { id: 'agents', label: 'Агенты', helper: 'Связь и задания', icon: SensorsOutlinedIcon },
  { id: 'hosts', label: 'Компьютеры', helper: 'Устройства с рисками', icon: ComputerOutlinedIcon },
];

function formatNavCount(count) {
  const value = Number(count);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value >= 100000) return `${Math.round(value / 1000)}k`;
  if (value >= 10000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.trunc(value));
}

function NavigationLabel({ item, count, compact }) {
  const Icon = item.icon;
  const countLabel = count === null || count === undefined ? null : formatNavCount(count);
  if (compact) {
    return (
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.75,
          minWidth: 0,
          maxWidth: '100%',
        }}
      >
        <Icon fontSize="small" sx={{ flexShrink: 0 }} />
        <Box component="span" sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>
          {item.label}
        </Box>
        {countLabel ? (
          <Box
            component="span"
            sx={(theme) => {
              const alert = item.id === 'review' && Number(count) > 0;
              return {
                flexShrink: 0,
                minWidth: 22,
                px: 0.6,
                py: 0.15,
                borderRadius: 5,
                bgcolor: alert
                  ? alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.18 : 0.12)
                  : alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.22 : 0.12),
                color: alert ? 'warning.main' : 'primary.main',
                border: `1px solid ${alpha(
                  alert ? theme.palette.warning.main : theme.palette.primary.main,
                  theme.palette.mode === 'dark' ? 0.34 : 0.22,
                )}`,
                fontSize: 11,
                fontWeight: 800,
                lineHeight: 1.35,
              };
            }}
          >
            {countLabel}
          </Box>
        ) : null}
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, width: '100%', minWidth: 0 }}>
      <Icon fontSize="small" sx={{ flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <Typography variant="body2" sx={{ fontWeight: 800, lineHeight: 1.25 }}>{item.label}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.helper}</Typography>
      </Box>
      {countLabel ? (
        <Box
          component="span"
          sx={(theme) => {
            const alert = item.id === 'review' && Number(count) > 0;
            return {
              minWidth: 28,
              maxWidth: 64,
              px: 0.7,
              py: 0.2,
              borderRadius: 5,
              // warning.light + warning.dark in dark theme is near-identical yellow — unreadable.
              bgcolor: alert
                ? alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.18 : 0.12)
                : 'action.hover',
              color: alert ? 'warning.main' : 'text.secondary',
              border: alert
                ? `1px solid ${alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.34 : 0.22)}`
                : '1px solid transparent',
              fontSize: 12,
              fontWeight: 800,
              textAlign: 'center',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              flexShrink: 0,
            };
          }}
        >
          {countLabel}
        </Box>
      ) : null}
    </Box>
  );
}

function ScanCenterNavigation({ active, counts, compact, onChange }) {
  return (
    <Paper
      component="nav"
      aria-label="Разделы Scan Center"
      variant="outlined"
      sx={{
        width: compact ? '100%' : 236,
        maxWidth: '100%',
        flexShrink: 0,
        alignSelf: compact ? 'stretch' : 'flex-start',
        // Sticky only in desktop side-by-side mode. In column layouts sticky overlaps content.
        position: compact ? 'static' : 'sticky',
        top: compact ? undefined : 12,
        zIndex: compact ? 'auto' : 2,
        overflow: 'hidden',
        borderRadius: 2,
      }}
    >
      {!compact ? (
        <Box sx={{ px: 1.5, pt: 1.4, pb: 0.8 }}>
          <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800 }}>Рабочие разделы</Typography>
        </Box>
      ) : null}
      <Tabs
        value={active}
        onChange={(_, nextValue) => onChange(nextValue)}
        orientation={compact ? 'horizontal' : 'vertical'}
        variant="scrollable"
        scrollButtons={compact ? 'auto' : false}
        allowScrollButtonsMobile
        sx={{
          minHeight: compact ? 48 : undefined,
          borderTop: compact ? 0 : '1px solid',
          borderColor: 'divider',
          '& .MuiTabs-flexContainer': compact ? { gap: 0.5 } : undefined,
          '& .MuiTabs-indicator': compact ? undefined : { left: 0, right: 'auto', width: 3 },
          '& .MuiTab-root': {
            minHeight: compact ? 48 : 62,
            minWidth: compact ? 'auto' : '100%',
            maxWidth: 'none',
            px: compact ? 1.25 : 1.75,
            py: compact ? 0.75 : 1,
            alignItems: 'center',
            textTransform: 'none',
          },
        }}
      >
        {NAV_ITEMS.map((item) => (
          <Tab
            key={item.id}
            value={item.id}
            aria-label={item.label}
            label={<NavigationLabel item={item} count={counts[item.id] ?? null} compact={compact} />}
          />
        ))}
      </Tabs>
    </Paper>
  );
}

export default memo(ScanCenterNavigation);
