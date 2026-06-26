import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import TasksDataModeRouter from './TasksDataModeRouter';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

const task = {
  id: 'task-1',
  title: 'Проверить акт',
  status: 'in_progress',
};

const bucket = {
  key: 'overdue',
  label: 'Просрочены',
  color: '#ef4444',
  items: [task],
  createDueAt: null,
};

const baseProps = {
  ui,
  theme,
  visibleTaskItems: [task],
  taskItems: [task],
  taskListSections: { active: { items: [task] }, completed: { items: [] } },
  onToggleCompletedTasks: vi.fn(),
  activeTaskProjects: [],
  onOpenTask: vi.fn(),
  deadlineBuckets: [],
  onCreateWithPreset: vi.fn(),
  renderTaskCard: () => null,
  calendarPayload: { days: [], monthLabel: 'Июнь 2026' },
  onShiftMonth: vi.fn(),
  onCalendarGoToToday: vi.fn(),
  onOpenNoDueTasks: vi.fn(),
  ganttPayload: { rows: [], rangeLabel: '' },
  columnData: {},
  mobileBoardItems: [],
};

describe('TasksDataModeRouter', () => {
  it('renders list view by default on desktop', () => {
    render(
      <ThemeProvider theme={theme}>
        <TasksDataModeRouter {...baseProps} pageMode="list" />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('tasks-data-mode-router')).toBeInTheDocument();
    expect(screen.getByTestId('tasks-list-view')).toBeInTheDocument();
  });

  it('renders deadlines bucket view for deadlines mode', () => {
    render(
      <ThemeProvider theme={theme}>
        <TasksDataModeRouter
          {...baseProps}
          pageMode="deadlines"
          deadlineBuckets={[bucket]}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('tasks-deadlines-view')).toBeInTheDocument();
  });

  it('renders board view for board mode', () => {
    render(
      <ThemeProvider theme={theme}>
        <TasksDataModeRouter
          {...baseProps}
          pageMode="board"
          columnData={{ new: [task], in_progress: [], review: [], done: [] }}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('tasks-data-mode-router')).toBeInTheDocument();
    expect(screen.getByTestId('tasks-desktop-kanban')).toBeInTheDocument();
  });

  it('renders calendar view for calendar mode', () => {
    render(
      <ThemeProvider theme={theme}>
        <TasksDataModeRouter
          {...baseProps}
          pageMode="calendar"
          calendarPayload={{ days: [], monthStart: new Date(), monthEnd: new Date(), noDueCount: 0 }}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('tasks-calendar-view')).toBeInTheDocument();
  });

  it('renders gantt view for gantt mode', () => {
    render(
      <ThemeProvider theme={theme}>
        <TasksDataModeRouter
          {...baseProps}
          pageMode="gantt"
          ganttPayload={{ rows: [], rangeStart: new Date(), rangeEnd: new Date(), noDueItems: [] }}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('tasks-gantt-view')).toBeInTheDocument();
  });

  it('preloads analytics chunk via preloadTasksAnalyticsView', async () => {
    const { preloadTasksAnalyticsView } = await import('./TasksDataModeRouter');
    await expect(preloadTasksAnalyticsView()).resolves.toBeTruthy();
  });
});
