import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import TasksBoardView from './TasksBoardView';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

const task = { id: 'task-1', title: 'Проверить акт', status: 'in_progress' };

describe('TasksBoardView', () => {
  it('renders mobile board groups with task cards', () => {
    render(
      <ThemeProvider theme={theme}>
        <TasksBoardView
          isMobile
          ui={ui}
          theme={theme}
          columnData={{ in_progress: [task] }}
          mobileBoardItems={[task]}
          renderTaskCard={(item) => <div data-testid={`card-${item.id}`}>{item.title}</div>}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('tasks-mobile-board')).toBeInTheDocument();
    expect(screen.getByTestId('card-task-1')).toBeInTheDocument();
  });

  it('renders desktop kanban columns', () => {
    render(
      <ThemeProvider theme={theme}>
        <TasksBoardView
          ui={ui}
          theme={theme}
          columnData={{ new: [task] }}
          renderTaskCard={(item) => <div data-testid={`card-${item.id}`}>{item.title}</div>}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('tasks-desktop-kanban')).toBeInTheDocument();
    expect(screen.getByText('Новое')).toBeInTheDocument();
    expect(screen.getByTestId('card-task-1')).toBeInTheDocument();
  });
});
