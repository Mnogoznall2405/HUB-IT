import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import TaskDetailShell from './TaskDetailShell';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';

vi.mock('./detail/TaskDetailHeader', () => ({
  TaskDetailHeader: () => <div data-testid="task-detail-header" />,
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
    expect(screen.getByTestId('task-detail-body')).toBeInTheDocument();
  });
});
