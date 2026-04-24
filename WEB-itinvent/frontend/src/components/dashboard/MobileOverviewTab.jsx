import React from 'react';
import { Box, Card, Stack, Typography } from '@mui/material';
import AnnouncementList from './AnnouncementList';
import TaskQueue from './TaskQueue';

const DASHBOARD_MOBILE_OVERVIEW_SECTION_META = {
  urgent: {
    title: 'Сейчас важно',
    description: 'Просроченные, проверка и подтверждения.',
  },
  announcements: {
    title: 'Заметки',
    description: 'Короткий обзор новостей и обязательных заметок.',
  },
  tasks: {
    title: 'Задачи',
    description: 'Быстрый triage по рабочей очереди.',
  },
};

const MobileOverviewTab = React.memo(({
  visibleSections,
  actionStrip,
  announcementSections,
  taskQueues,
  onAnnouncementClick,
  onAcknowledge,
  onTaskClick,
  ui,
}) => {
  if (!visibleSections || visibleSections.length === 0) {
    return (
      <Box
        sx={{
          ...ui.emptyState,
          py: 4,
        }}
      >
        <Typography variant="body2" color="text.secondary">
          Нет данных для отображения. Настройте видимые секции.
        </Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={2}>
      {/* Action Strip Summary */}
      {visibleSections.includes('urgent') && (
        <Card
          sx={{
            ...ui.panelSolid,
            p: 2,
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
            {DASHBOARD_MOBILE_OVERVIEW_SECTION_META.urgent.title}
          </Typography>
          <Typography variant="caption" sx={{ color: ui.mutedFg, display: 'block', mb: 1.5 }}>
            {DASHBOARD_MOBILE_OVERVIEW_SECTION_META.urgent.description}
          </Typography>

          <Stack spacing={1}>
            {actionStrip.map((action) => (
              <Box
                key={action.key}
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  p: 1,
                  borderRadius: 1,
                  backgroundColor: action.bg,
                  border: `1px solid ${action.color}33`,
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <Box sx={{ color: action.color }}>{action.icon}</Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {action.label}
                  </Typography>
                </Stack>
                <Typography
                  variant="h6"
                  sx={{
                    fontWeight: 800,
                    color: action.color,
                  }}
                >
                  {action.value}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Card>
      )}

      {/* Announcements Preview */}
      {visibleSections.includes('announcements') && (
        <Card
          sx={{
            ...ui.panelSolid,
            p: 2,
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            {DASHBOARD_MOBILE_OVERVIEW_SECTION_META.announcements.title}
          </Typography>
          <Typography variant="caption" sx={{ color: ui.mutedFg, display: 'block', mb: 1.5 }}>
            {DASHBOARD_MOBILE_OVERVIEW_SECTION_META.announcements.description}
          </Typography>

          <AnnouncementList
            sections={announcementSections.slice(0, 2)}
            onAnnouncementClick={onAnnouncementClick}
            onAcknowledge={onAcknowledge}
            ui={ui}
            isMobile
          />
        </Card>
      )}

      {/* Tasks Preview */}
      {visibleSections.includes('tasks') && (
        <Card
          sx={{
            ...ui.panelSolid,
            p: 2,
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            {DASHBOARD_MOBILE_OVERVIEW_SECTION_META.tasks.title}
          </Typography>
          <Typography variant="caption" sx={{ color: ui.mutedFg, display: 'block', mb: 1.5 }}>
            {DASHBOARD_MOBILE_OVERVIEW_SECTION_META.tasks.description}
          </Typography>

          <TaskQueue
            taskQueues={taskQueues}
            onTaskClick={onTaskClick}
            ui={ui}
            isMobile
          />
        </Card>
      )}
    </Stack>
  );
});

MobileOverviewTab.displayName = 'MobileOverviewTab';

export default MobileOverviewTab;
