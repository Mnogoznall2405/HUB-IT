import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import { TaskEditDialog, TaskReviewDialog, TaskSubmitDialog, TaskCloseDialog } from './TaskActionDialogs';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

const { mockGetAssignees } = vi.hoisted(() => ({ mockGetAssignees: vi.fn() }));

vi.mock('../../api/client', () => ({
  hubAPI: { getAssignees: mockGetAssignees },
}));

beforeEach(() => {
  mockGetAssignees.mockReset();
  mockGetAssignees.mockResolvedValue({ items: [] });
});

const task = { id: 'task-1', title: 'Проверить отчёт' };

const renderWithTheme = (uiNode) => render(
  <ThemeProvider theme={theme}>
    {uiNode}
  </ThemeProvider>,
);

describe('TaskEditDialog', () => {
  it('keeps every assignee when saving a shared task', async () => {
    const onSave = vi.fn();
    renderWithTheme(
      <TaskEditDialog
        open
        task={{
          id: 'task-shared',
          title: 'Общая задача',
          assignee_user_id: 2,
          assignee_user_ids: [2, 4],
          assignees: [
            { user_id: 2, full_name: 'Иван Петров' },
            { user_id: 4, full_name: 'Анна Смирнова' },
          ],
          observer_user_ids: [],
          priority: 'normal',
          visibility_scope: 'private',
        }}
        references={{ controllers: [], departments: [], projects: [], objects: [] }}
        onClose={vi.fn()}
        onSave={onSave}
        ui={ui}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ assignee_user_ids: [2, 4] }));
  });
});

describe('TaskReviewDialog', () => {
  it('renders review actions and submits decision with comment', () => {
    const onSubmit = vi.fn();
    renderWithTheme(
      <TaskReviewDialog
        open
        task={task}
        saving={false}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        ui={ui}
      />,
    );

    expect(screen.getByText('Проверка задачи')).toBeInTheDocument();
    expect(screen.getByText('Проверить отчёт')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Комментарий проверки'), {
      target: { value: 'Нужна правка' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть на доработку' }));

    expect(onSubmit).toHaveBeenCalledWith('reject', 'Нужна правка');
  });

  it('resets comment when reopened for another task', () => {
    const onSubmit = vi.fn();
    const { rerender } = renderWithTheme(
      <TaskReviewDialog
        open
        task={task}
        saving={false}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        ui={ui}
      />,
    );

    fireEvent.change(screen.getByLabelText('Комментарий проверки'), {
      target: { value: 'Старый комментарий' },
    });

    rerender(
      <ThemeProvider theme={theme}>
        <TaskReviewDialog
          open
          task={{ id: 'task-2', title: 'Другая задача' }}
          saving={false}
          onClose={vi.fn()}
          onSubmit={onSubmit}
          ui={ui}
        />
      </ThemeProvider>,
    );

    expect(screen.getByLabelText('Комментарий проверки')).toHaveValue('');
  });
});

describe('TaskSubmitDialog', () => {
  it('renders submit form and passes comment to onSubmit', () => {
    const onSubmit = vi.fn();
    renderWithTheme(
      <TaskSubmitDialog
        open
        task={task}
        saving={false}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        ui={ui}
      />,
    );

    expect(screen.getByRole('button', { name: 'Отправить на проверку' })).toBeInTheDocument();
    expect(screen.getByText('Проверить отчёт')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Комментарий к проверке'), {
      target: { value: 'Готово' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить на проверку' }));

    expect(onSubmit).toHaveBeenCalledWith({ comment: 'Готово', file: null });
  });

  it('shows saving label while submit is in progress', () => {
    renderWithTheme(
      <TaskSubmitDialog
        open
        task={task}
        saving
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        ui={ui}
      />,
    );

    expect(screen.getByRole('button', { name: 'Отправка...' })).toBeDisabled();
  });
});

describe('TaskCloseDialog', () => {
  it('closes a task with an optional comment', () => {
    const onSubmit = vi.fn();
    renderWithTheme(
      <TaskCloseDialog
        open
        task={task}
        saving={false}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        ui={ui}
      />,
    );

    expect(screen.getByText('Закрыть задачу')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Комментарий (необязательно)'), {
      target: { value: 'Больше не актуально' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onSubmit).toHaveBeenCalledWith({ comment: 'Больше не актуально' });
  });
});
