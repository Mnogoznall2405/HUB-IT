import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import TaskDetailShell from './TaskDetailShell';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';

vi.mock('./detail/TaskDetailHeader', () => ({
  TaskDetailHeader: ({ compact }) => (
    <div data-testid="task-detail-header" data-compact={String(compact)} />
  ),
}));

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

describe('TaskDetailShell', () => {
  it('renders detail shell with header', () => {
    render(
      <ThemeProvider theme={theme}>
        <TaskDetailShell
          task={{ id: '1', title: 'Задача' }}
          ui={ui}
          theme={theme}
          statusMeta={{ label: 'Новая', bg: '#fff', color: '#000' }}
          priorityMeta={{ label: 'Обычный', value: 'normal', dotColor: '#000' }}
          onBack={() => {}}
        >
          <div data-testid="task-detail-body">body</div>
        </TaskDetailShell>
      </ThemeProvider>,
    );
    expect(screen.getByTestId('task-detail-header')).toBeInTheDocument();
    expect(screen.getByTestId('task-detail-header')).toHaveAttribute('data-compact', 'false');
    expect(screen.getByTestId('task-detail-content')).toHaveAttribute('data-content-mode', 'scroll');
    expect(screen.getByTestId('task-detail-body')).toBeInTheDocument();
  });

  it('locks page scrolling and forwards the compact header in fill mode', () => {
    render(
      <ThemeProvider theme={theme}>
        <TaskDetailShell
          task={{ id: '1', title: 'Задача' }}
          ui={ui}
          theme={theme}
          statusMeta={{ label: 'Новая', bg: '#fff', color: '#000' }}
          priorityMeta={{ label: 'Обычный', value: 'normal', dotColor: '#000' }}
          onBack={() => {}}
          compactHeader
          contentMode="fill"
        >
          <div data-testid="task-detail-body">body</div>
        </TaskDetailShell>
      </ThemeProvider>,
    );

    expect(screen.getByTestId('task-detail-header')).toHaveAttribute('data-compact', 'true');
    expect(screen.getByTestId('task-detail-content')).toHaveAttribute('data-content-mode', 'fill');
    expect(getComputedStyle(screen.getByTestId('task-detail-content')).overflowY).toBe('hidden');
  });
});
