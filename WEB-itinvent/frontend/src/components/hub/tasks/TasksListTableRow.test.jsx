import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { alpha } from '@mui/material/styles';
import { Table, TableBody } from '@mui/material';

import TasksListTableRow from './TasksListTableRow';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

const task = {
  id: 'task-1',
  title: 'Проверить акт',
  description: 'Описание',
  status: 'in_progress',
  updated_at: '2026-06-20T12:00:00Z',
  comments_count: 2,
  attachments_count: 1,
  due_at: '2026-06-21T12:00:00Z',
};

describe('TasksListTableRow', () => {
  it('renders row and opens task on click', () => {
    const onOpen = vi.fn();
    render(
      <ThemeProvider theme={theme}>
        <Table>
          <TableBody>
            <TasksListTableRow
              task={task}
              ui={ui}
              alpha={alpha}
              onOpen={onOpen}
            />
          </TableBody>
        </Table>
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByTestId('tasks-list-row-task-1'));
    expect(onOpen).toHaveBeenCalled();
    expect(screen.getByText('Проверить акт')).toBeInTheDocument();
  });
});
