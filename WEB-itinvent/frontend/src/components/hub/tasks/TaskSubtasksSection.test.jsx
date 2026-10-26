import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import TaskSubtasksSection, { TaskParentLink } from './TaskSubtasksSection';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

const parentTask = {
  id: 'parent-1',
  title: 'Подготовить релиз',
  status: 'in_progress',
  subtasks_total: 3,
  subtasks_done: 1,
  capabilities: { can_create_subtask: true },
  subtasks: [
    {
      id: 'sub-1',
      title: 'Собрать сборку',
      status: 'done',
      due_at: '2026-10-30T10:00:00',
      assignee_user_id: 6,
      assignee_full_name: 'Иванов Иван',
    },
    {
      id: 'sub-2',
      title: 'Проверить на стенде',
      status: 'new',
      is_overdue: true,
      assignee_user_id: 7,
      assignee_full_name: 'Петров Пётр',
    },
  ],
};

const renderSection = (task, props = {}) => render(
  <ThemeProvider theme={theme}>
    <TaskSubtasksSection task={task} ui={ui} {...props} />
  </ThemeProvider>,
);

describe('TaskSubtasksSection', () => {
  it('shows progress, rows and the count of subtasks hidden from the viewer', () => {
    renderSection(parentTask, { onOpenTask: vi.fn(), onCreateSubtask: vi.fn() });

    expect(screen.getByText('Подзадачи · 1/3')).toBeInTheDocument();
    expect(screen.getByText('Собрать сборку')).toBeInTheDocument();
    expect(screen.getByText('Проверить на стенде')).toBeInTheDocument();
    expect(screen.getByText('Готово')).toBeInTheDocument();
    expect(screen.getByTestId('task-subtasks-hidden-note')).toHaveTextContent('и ещё 1 недоступных вам');
  });

  it('opens a subtask by click and by keyboard', () => {
    const onOpenTask = vi.fn();
    renderSection(parentTask, { onOpenTask });

    fireEvent.click(screen.getByTestId('task-subtask-row-sub-1'));
    fireEvent.keyDown(screen.getByTestId('task-subtask-row-sub-2'), { key: 'Enter' });

    expect(onOpenTask).toHaveBeenNthCalledWith(1, 'sub-1');
    expect(onOpenTask).toHaveBeenNthCalledWith(2, 'sub-2');
  });

  it('offers creation only when the backend grants can_create_subtask', () => {
    const onCreateSubtask = vi.fn();
    const { unmount } = renderSection(parentTask, { onCreateSubtask });
    fireEvent.click(screen.getByRole('button', { name: 'Подзадача' }));
    expect(onCreateSubtask).toHaveBeenCalledWith(parentTask);
    unmount();

    renderSection({ ...parentTask, capabilities: { can_create_subtask: false } }, { onCreateSubtask });
    expect(screen.queryByRole('button', { name: 'Подзадача' })).not.toBeInTheDocument();
  });

  it('stays hidden for a task without subtasks that nobody may extend', () => {
    renderSection(
      { id: 'plain', status: 'new', subtasks_total: 0, subtasks_done: 0, subtasks: [], capabilities: { can_create_subtask: false } },
      { onCreateSubtask: vi.fn() },
    );

    expect(screen.queryByTestId('task-subtasks-section')).not.toBeInTheDocument();
  });

  it('invites to split a task that has no subtasks yet when creation is allowed', () => {
    renderSection(
      { id: 'plain', status: 'new', subtasks_total: 0, subtasks_done: 0, subtasks: [], capabilities: { can_create_subtask: true } },
      { onCreateSubtask: vi.fn() },
    );

    expect(screen.getByText('Разбейте задачу на части и назначьте их исполнителям.')).toBeInTheDocument();
  });
});

describe('TaskParentLink', () => {
  it('links to a viewable parent', () => {
    const onOpenParent = vi.fn();
    render(<TaskParentLink parent={{ id: 'parent-1', can_view: true, title: 'Подготовить релиз' }} onOpenParent={onOpenParent} ui={ui} />);

    fireEvent.click(screen.getByRole('button', { name: 'Подготовить релиз' }));

    expect(onOpenParent).toHaveBeenCalledWith('parent-1');
  });

  it('shows a plain label when the viewer has no access to the parent', () => {
    const onOpenParent = vi.fn();
    render(<TaskParentLink parent={{ id: 'parent-1', can_view: false }} onOpenParent={onOpenParent} ui={ui} />);

    expect(screen.getByText('Родительская задача недоступна')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
