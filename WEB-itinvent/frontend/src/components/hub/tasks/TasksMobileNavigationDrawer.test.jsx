import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import TasksMobileNavigationDrawer from './TasksMobileNavigationDrawer';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

const boardSummaryItems = [
  { key: 'open', label: 'Открыто', value: 3, color: '#2563eb' },
];

describe('TasksMobileNavigationDrawer', () => {
  it('renders task mode drawer with status chips and close control', () => {
    const onClose = vi.fn();
    render(
      <ThemeProvider theme={theme}>
        <TasksMobileNavigationDrawer
          open
          onClose={onClose}
          ui={ui}
          isTaskDataMode
          boardSummaryItems={boardSummaryItems}
          boardFiltersPanel={<div data-testid="board-filters-slot" />}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('tasks-mobile-navigation-drawer')).toBeInTheDocument();
    expect(screen.getByTestId('tasks-mobile-status-all')).toBeInTheDocument();
    expect(screen.getByTestId('board-filters-slot')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('tasks-mobile-close-navigation'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('applies status filter and closes drawer', () => {
    const onStatusFilterChange = vi.fn();
    const onClose = vi.fn();
    render(
      <ThemeProvider theme={theme}>
        <TasksMobileNavigationDrawer
          open
          onClose={onClose}
          ui={ui}
          isTaskDataMode
          onStatusFilterChange={onStatusFilterChange}
          boardSummaryItems={boardSummaryItems}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByTestId('tasks-mobile-status-done'));
    expect(onStatusFilterChange).toHaveBeenCalledWith('done');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
