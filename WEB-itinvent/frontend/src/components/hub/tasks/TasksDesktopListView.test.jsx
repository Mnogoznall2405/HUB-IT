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
});
