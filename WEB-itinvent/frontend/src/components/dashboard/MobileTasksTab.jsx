import React from 'react';
import { Box, Stack, Tab, Tabs, Typography } from '@mui/material';
import TaskQueue from './TaskQueue';

const DASHBOARD_MOBILE_TASK_SEGMENTS = [
  { key: 'review', label: 'К проверке' },
  { key: 'overdue', label: 'Просроченные' },
  { key: 'comments', label: 'Комментарии' },
  { key: 'other', label: 'Все открытые' },
];

const MobileTasksTab = React.memo(({
  taskQueues,
  selectedSegment,
  onSegmentChange,
  onTaskClick,
  ui,
}) => {
  const handleSegmentChange = React.useCallback((event, newValue) => {
    if (onSegmentChange) {
      onSegmentChange(newValue);
    }
  }, [onSegmentChange]);

  const filteredQueues = React.useMemo(() => {
    if (selectedSegment === 'other') {
      return {
        other: taskQueues.other || [],
      };
    }
    return {
      [selectedSegment]: taskQueues[selectedSegment] || [],
    };
  }, [taskQueues, selectedSegment]);

  return (
    <Stack spacing={2}>
      {/* Segment Tabs */}
      <Box
        sx={{
          ...ui.panelSolid,
          p: 1,
        }}
      >
        <Tabs
          value={selectedSegment}
          onChange={handleSegmentChange}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            minHeight: 40,
            '& .MuiTab-root': {
              minHeight: 36,
              fontSize: '0.85rem',
              fontWeight: 600,
              textTransform: 'none',
              px: 2,
            },
          }}
        >
          {DASHBOARD_MOBILE_TASK_SEGMENTS.map((segment) => (
            <Tab
              key={segment.key}
              value={segment.key}
              label={segment.label}
            />
          ))}
        </Tabs>
      </Box>

      {/* Queue Content */}
      <Box>
        <Typography
          variant="subtitle1"
          sx={{
            fontWeight: 700,
            mb: 1.5,
            color: ui.panelFg,
          }}
        >
          {DASHBOARD_MOBILE_TASK_SEGMENTS.find(s => s.key === selectedSegment)?.label || 'Задачи'}
        </Typography>

        <TaskQueue
          taskQueues={filteredQueues}
          onTaskClick={onTaskClick}
          ui={ui}
          isMobile
        />
      </Box>
    </Stack>
  );
});

MobileTasksTab.displayName = 'MobileTasksTab';

export default MobileTasksTab;
