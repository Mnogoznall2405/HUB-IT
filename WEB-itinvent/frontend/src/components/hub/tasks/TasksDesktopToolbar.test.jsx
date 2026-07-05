import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import TasksDesktopToolbar from './TasksDesktopToolbar';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

const boardSummaryItems = [
  { key: 'open', label: 'Открыто', value: 2, color: '#2563eb' },
];

describe('TasksDesktopToolbar', () => {
  it('renders mode tabs, summary chips and filter toggle', () => {
    render(
      <ThemeProvider theme={theme}>
        <TasksDesktopToolbar
          ui={ui}
          isTaskDataMode
          boardSummaryItems={boardSummaryItems}
          onPersonalRoleChange={vi.fn()}
          onToggleFilters={vi.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('tasks-desktop-toolbar')).toBeInTheDocument();
    expect(screen.getByText('Задачи')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Развернуть фильтры/i })).toBeInTheDocument();
    expect(screen.getByText('Открыто: 2')).toBeInTheDocument();
  });

  it('toggles filters panel and calls refresh', () => {
    const onToggleFilters = vi.fn();
    const onRefresh = vi.fn();
    render(
      <ThemeProvider theme={theme}>
        <TasksDesktopToolbar
          ui={ui}
          isTaskDataMode
          boardSummaryItems={boardSummaryItems}
          onPersonalRoleChange={vi.fn()}
          onToggleFilters={onToggleFilters}
          onRefresh={onRefresh}
          filtersPanel={<div data-testid="toolbar-filters-slot" />}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Развернуть фильтры/i }));
    expect(onToggleFilters).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
