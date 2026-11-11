import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import TasksMobileFeedView from './TasksMobileFeedView';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

const task = { id: 'task-1', title: 'Проверить акт' };

describe('TasksMobileFeedView', () => {
  it('renders active section with task cards', () => {
    render(
      <ThemeProvider theme={theme}>
        <TasksMobileFeedView
          ui={ui}
          taskItems={[task]}
          taskListSections={{ active: { items: [task] }, completed: { items: [] } }}
          renderTaskCard={(item) => <div data-testid={`card-${item.id}`}>{item.title}</div>}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('tasks-mobile-feed-view')).toBeInTheDocument();
    expect(screen.getByText('Активные')).toBeInTheDocument();
    expect(screen.getByTestId('card-task-1')).toHaveTextContent('Проверить акт');
  });

  it('shows empty state when no tasks match filters', () => {
    render(
      <ThemeProvider theme={theme}>
        <TasksMobileFeedView
          ui={ui}
          taskListSections={{ active: { items: [] }, completed: { items: [] } }}
          renderTaskCard={() => null}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText(/не найдены/i)).toBeInTheDocument();
  });

  it('toggles completed section', () => {
    const onToggle = vi.fn();
    render(
      <ThemeProvider theme={theme}>
        <TasksMobileFeedView
          ui={ui}
          taskListSections={{ active: { items: [] }, completed: { items: [task] } }}
          completedTasksOpen={false}
          onToggleCompletedTasks={onToggle}
          renderTaskCard={() => null}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Завершённые/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
