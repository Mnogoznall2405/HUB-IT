import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import TasksBucketColumnsView from './TasksBucketColumnsView';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

const task = { id: 'task-1', title: 'Просроченная задача' };
const bucket = {
  key: 'overdue',
  label: 'Просрочены',
  color: '#ef4444',
  items: [task],
  createDueAt: null,
};

describe('TasksBucketColumnsView', () => {
  it('renders desktop deadline buckets and create button', () => {
    const onCreateWithPreset = vi.fn();

    render(
      <ThemeProvider theme={theme}>
        <TasksBucketColumnsView
          ui={ui}
          buckets={[bucket]}
          testId="tasks-deadlines-view"
          showCreateButtons
          canCreateTasks
          onCreateWithPreset={onCreateWithPreset}
          renderTaskCard={(item) => <div data-testid={`card-${item.id}`}>{item.title}</div>}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('tasks-deadlines-view')).toBeInTheDocument();
    expect(screen.getByText('Просрочены')).toBeInTheDocument();
    expect(screen.getByTestId('card-task-1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу: Просрочены' }));
    expect(onCreateWithPreset).toHaveBeenCalledWith({ due_at: null });
  });

  it('renders mobile bucket list', () => {
    render(
      <ThemeProvider theme={theme}>
        <TasksBucketColumnsView
          isMobile
          ui={ui}
          buckets={[bucket]}
          testId="tasks-deadlines-view"
          renderTaskCard={(item) => <div data-testid={`card-${item.id}`}>{item.title}</div>}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('tasks-deadlines-view')).toBeInTheDocument();
    expect(screen.getByTestId('card-task-1')).toBeInTheDocument();
  });
});
