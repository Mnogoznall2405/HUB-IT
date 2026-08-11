import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { alpha } from '@mui/material/styles';

import TasksDesktopListView from './TasksDesktopListView';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

const task = {
  id: 'task-1',
  title: 'Проверить акт',
  status: 'in_progress',
  due_at: '2026-06-13T12:00:00',
  updated_at: '2026-06-10T10:00:00',
  created_by_full_name: 'Автор А.А.',
  assignee_full_name: 'Исполнитель И.И.',
  project_id: 'project-1',
};

describe('TasksDesktopListView', () => {
  it('sorts rows by activity date and lets the user reverse the order', () => {
    const onDateSortDirectionChange = vi.fn();
    const olderTask = { ...task, id: 'task-old', title: 'Старая задача', updated_at: '2026-06-08T10:00:00' };
    const newerTask = { ...task, id: 'task-new', title: 'Новая задача', updated_at: '2026-06-12T10:00:00' };

    render(
      <ThemeProvider theme={theme}>
        <TasksDesktopListView
          ui={ui}
          alpha={alpha}
          visibleTaskItems={[olderTask, newerTask]}
          taskListSections={{ active: { items: [olderTask, newerTask] }, completed: { items: [] } }}
          dateSortDirection="desc"
          onDateSortDirectionChange={onDateSortDirectionChange}
        />
      </ThemeProvider>,
    );

    expect(screen.getByRole('button', { name: 'Дата изменения, сначала новые' })).toBeInTheDocument();
    expect(screen.getAllByTestId(/^tasks-list-row-/).map((row) => row.dataset.testid)).toEqual([
      'tasks-list-row-task-new',
      'tasks-list-row-task-old',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Дата изменения, сначала новые' }));
    expect(onDateSortDirectionChange).toHaveBeenCalledWith('asc');
  });

  it('renders desktop table rows and handles row click', () => {
    const onOpenTask = vi.fn();

    render(
      <ThemeProvider theme={theme}>
        <TasksDesktopListView
          ui={ui}
          alpha={alpha}
          visibleTaskItems={[task]}
          taskListSections={{ active: { items: [task] }, completed: { items: [] } }}
          activeTaskProjects={[{ id: 'project-1', name: 'Проект Север' }]}
          onOpenTask={onOpenTask}
        />
      </ThemeProvider>,
    );

    const listView = screen.getByTestId('tasks-list-view');
    expect(listView).toBeInTheDocument();
    const row = within(listView).getByTestId('tasks-list-row-task-1');
    fireEvent.click(row);
    expect(onOpenTask).toHaveBeenCalledWith(task);
  });

  it('shows delete only for an allowed task and keeps the row closed', () => {
    const onOpenTask = vi.fn();
    const onDeleteTask = vi.fn();

    render(
      <ThemeProvider theme={theme}>
        <TasksDesktopListView
          ui={ui}
          alpha={alpha}
          visibleTaskItems={[task]}
          taskListSections={{ active: { items: [task] }, completed: { items: [] } }}
          canDeleteTask={(item) => item.id === task.id}
          onOpenTask={onOpenTask}
          onDeleteTask={onDeleteTask}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: `Удалить задачу «${task.title}»` }));

    expect(onDeleteTask).toHaveBeenCalledWith(task);
    expect(onOpenTask).not.toHaveBeenCalled();
  });
});
