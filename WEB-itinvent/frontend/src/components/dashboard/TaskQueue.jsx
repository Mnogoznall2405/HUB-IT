import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import TaskCard from './TaskCard';

const TASK_QUEUE_META = {
  review: {
    title: 'К проверке',
    empty: 'Нет задач на проверку.',
    color: '#7c3aed',
  },
  overdue: {
    title: 'Просроченные',
    empty: 'Нет просроченных задач.',
    color: '#dc2626',
  },
  comments: {
    title: 'С новыми комментариями',
    empty: 'Нет задач с непрочитанными комментариями.',
    color: '#059669',
  },
  other: {
    title: 'Остальные',
    empty: 'Нет открытых задач.',
    color: '#64748b',
  },
};

const TaskQueue = React.memo(({
  taskQueues,
  onTaskClick,
  ui,
  isMobile,
}) => {
  const queueKeys = ['review', 'overdue', 'comments', 'other'];

  const hasAnyTasks = queueKeys.some((key) => taskQueues[key]?.length > 0);

  if (!hasAnyTasks) {
    return (
      <Box
        sx={{
          ...ui.emptyState,
          py: 4,
        }}
      >
        <Typography variant="body2" color="text.secondary">
          Нет открытых задач
        </Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={3}>
      {queueKeys.map((queueKey) => {
        const queue = taskQueues[queueKey] || [];
        const meta = TASK_QUEUE_META[queueKey];

        if (queue.length === 0) {
          return null;
        }

        return (
          <Box key={queueKey}>
            {/* Queue Header */}
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{
                mb: 2,
                pb: 1,
                borderBottom: `1px solid ${ui.borderSoft}`,
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <Box
                  sx={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    backgroundColor: meta.color,
                  }}
                />
                <Typography
                  variant={isMobile ? 'subtitle1' : 'h6'}
                  sx={{
                    fontWeight: 700,
                    color: ui.panelFg,
                  }}
                >
                  {meta.title}
                </Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {queue.length}
              </Typography>
            </Stack>

            {/* Queue Items */}
            <Stack spacing={1.5}>
              {queue.map((task) => (
                <TaskCard
                  key={task?.id}
                  task={task}
                  onClick={onTaskClick}
                  ui={ui}
                  isMobile={isMobile}
                />
              ))}
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
});

TaskQueue.displayName = 'TaskQueue';

export default TaskQueue;
