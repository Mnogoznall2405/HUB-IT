import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import TasksCalendarView from './TasksCalendarView';
import { buildCalendarDays } from '../../../pages/tasksViewModel';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

const monthStart = new Date(2026, 5, 1);
const task = { id: 'task-1', title: 'Проверить акт перемещения', status: 'in_progress', due_at: '2026-06-13T12:00:00' };

describe('TasksCalendarView', () => {
  it('renders month grid and opens task from day cell', () => {
    const onOpenTask = vi.fn();
    const { days, monthStart: resolvedMonthStart, noDueCount } = buildCalendarDays([task], monthStart);
    const calendarPayload = {
      monthStart: resolvedMonthStart,
      noDueCount,
      days,
    };

    render(
      <ThemeProvider theme={theme}>
        <TasksCalendarView
          ui={ui}
          calendarPayload={calendarPayload}
          onShiftMonth={vi.fn()}
          onGoToToday={vi.fn()}
          onOpenNoDueTasks={vi.fn()}
          onOpenTask={onOpenTask}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('tasks-calendar-view')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Проверить акт перемещения'));
    expect(onOpenTask).toHaveBeenCalledWith(task);
  });

  it('routes to no-due bucket from header action', () => {
    const onOpenNoDueTasks = vi.fn();
    const noDueTask = { id: 'task-nd', title: 'Без срока', status: 'new' };
    const { days, monthStart: resolvedMonthStart, noDueCount } = buildCalendarDays([noDueTask], monthStart);
    const calendarPayload = {
      monthStart: resolvedMonthStart,
      noDueCount,
      days,
    };

    render(
      <ThemeProvider theme={theme}>
        <TasksCalendarView
          ui={ui}
          calendarPayload={calendarPayload}
          onShiftMonth={vi.fn()}
          onGoToToday={vi.fn()}
          onOpenNoDueTasks={onOpenNoDueTasks}
          onOpenTask={vi.fn()}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: `Без срока: ${noDueCount}` }));
    expect(onOpenNoDueTasks).toHaveBeenCalledTimes(1);
  });
});
