import React, { memo } from 'react';
import {
  Badge,
  Box,
  Paper,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
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

function NavigationLabel({ item, count, compact }) {
  const Icon = item.icon;
  if (compact) {
    return (
      <Badge badgeContent={count} color={item.id === 'review' ? 'warning' : 'primary'} max={999}>
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.7 }}>
          <Icon fontSize="small" />
          {item.label}
        </Box>
      </Badge>
    );
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, width: '100%', minWidth: 0 }}>
      <Icon fontSize="small" />
      <Box sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <Typography variant="body2" sx={{ fontWeight: 800, lineHeight: 1.25 }}>{item.label}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>{item.helper}</Typography>
      </Box>
      {count !== null ? (
        <Box
          component="span"
          sx={{
            minWidth: 28,
            px: 0.7,
            py: 0.2,
            borderRadius: 5,
            bgcolor: item.id === 'review' && count > 0 ? 'warning.light' : 'action.hover',
            color: item.id === 'review' && count > 0 ? 'warning.dark' : 'text.secondary',
            fontSize: 12,
            fontWeight: 800,
            textAlign: 'center',
          }}
        >
          {count}
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
        flexShrink: 0,
        alignSelf: 'flex-start',
        position: compact ? 'static' : 'sticky',
        top: compact ? undefined : 12,
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
          minHeight: compact ? 52 : undefined,
          borderTop: compact ? 0 : '1px solid',
          borderColor: 'divider',
          '& .MuiTabs-indicator': compact ? undefined : { left: 0, right: 'auto', width: 3 },
          '& .MuiTab-root': {
            minHeight: compact ? 52 : 62,
            minWidth: compact ? 132 : '100%',
            px: compact ? 1.5 : 1.75,
            py: 1,
            alignItems: 'stretch',
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
