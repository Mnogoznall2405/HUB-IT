import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import TasksGanttView from './TasksGanttView';
import { buildGanttRows } from '../../../pages/tasksViewModel';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

const dueTask = {
  id: 'task-1',
  title: 'Проверить акт перемещения',
  status: 'in_progress',
  due_at: '2026-06-13T12:00:00',
  protocol_date: '2026-06-01',
};
const noDueTask = { id: 'task-2', title: 'Задача без срока', status: 'new' };

describe('TasksGanttView', () => {
  it('renders gantt rows and opens task on click', () => {
    const onOpenTask = vi.fn();
    const ganttPayload = buildGanttRows([dueTask, noDueTask]);

    render(
      <ThemeProvider theme={theme}>
        <TasksGanttView
          ui={ui}
          taskItems={[dueTask, noDueTask]}
          ganttPayload={ganttPayload}
          onOpenTask={onOpenTask}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('tasks-gantt-view')).toBeInTheDocument();
    expect(screen.getByTestId('tasks-gantt-row-task-1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tasks-gantt-row-task-1'));
    expect(onOpenTask).toHaveBeenCalledWith(dueTask);
    expect(screen.getByRole('button', { name: 'Задача без срока' })).toBeInTheDocument();
  });

  it('shows empty state without due tasks', () => {
    const ganttPayload = buildGanttRows([noDueTask]);

    render(
      <ThemeProvider theme={theme}>
        <TasksGanttView
          ui={ui}
          ganttPayload={ganttPayload}
          onOpenTask={vi.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText(/Нет задач со сроком/i)).toBeInTheDocument();
  });
});
