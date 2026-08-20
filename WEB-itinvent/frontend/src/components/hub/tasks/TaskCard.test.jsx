import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import TaskCard from './TaskCard';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

const baseTask = {
  id: 'task-1',
  title: 'Проверить акт',
  description: 'Нужно загрузить',
  status: 'in_progress',
  priority: 'normal',
  assignee_full_name: 'Иванов Иван',
  due_at: '2026-06-20T12:00:00Z',
};

describe('TaskCard', () => {
  it('renders mobile card with description and opens on click', () => {
    const onOpen = vi.fn();
    render(
      <ThemeProvider theme={theme}>
        <TaskCard
          task={baseTask}
          isMobile
          ui={ui}
          canEdit={false}
          canDelete={false}
          onOpen={onOpen}
        />
      </ThemeProvider>,
    );

    const card = screen.getByTestId('mobile-task-card-task-1');
    expect(card).toBeInTheDocument();
    expect(card).toHaveTextContent('Проверить акт');
    fireEvent.click(card);
    expect(onOpen).toHaveBeenCalledWith(baseTask);
  });

  it('shows close in the overflow menu when allowed', () => {
    const onCloseTask = vi.fn();
    render(
      <ThemeProvider theme={theme}>
        <TaskCard
          task={baseTask}
          isMobile
          ui={ui}
          canClose
          onCloseTask={onCloseTask}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Действия карточки задачи/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Закрыть/i }));
    expect(onCloseTask).toHaveBeenCalledWith(baseTask);
  });

  it('renders desktop card with action buttons', () => {
    const onOpen = vi.fn();
    const onCopyLink = vi.fn();
    const onDelete = vi.fn();
    render(
      <ThemeProvider theme={theme}>
        <TaskCard
          task={baseTask}
          column={{ color: '#2563eb' }}
          isMobile={false}
          ui={ui}
          canEdit
          canDelete
          onOpen={onOpen}
          onDelete={onDelete}
          onCopyLink={onCopyLink}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText('Проверить акт')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Скопировать ссылку/i }));
    expect(onCopyLink).toHaveBeenCalledWith(baseTask);
    fireEvent.click(screen.getByRole('button', { name: `Удалить задачу «${baseTask.title}»` }));
    expect(onDelete).toHaveBeenCalledWith(baseTask);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
