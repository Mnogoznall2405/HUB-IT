import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import TasksMobileHeader, { buildTasksMobilePrimaryModeOptions } from './TasksMobileHeader';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';

vi.mock('../../layout/ShellNotificationsButton', () => ({
  default: () => <div data-testid="shell-notifications-button" />,
}));

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

describe('TasksMobileHeader', () => {
  it('renders mode label, search and navigation controls', () => {
    render(
      <ThemeProvider theme={theme}>
        <TasksMobileHeader
          ui={ui}
          modeLabel="Лента"
          itemCount={3}
          isTaskDataMode
          onSearchOpenChange={vi.fn()}
          onOpenNavigation={vi.fn()}
          primaryModeOptions={buildTasksMobilePrimaryModeOptions('Лента')}
          onPageModeChange={vi.fn()}
          onPersonalRoleChange={vi.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('tasks-mobile-header-inline')).toBeInTheDocument();
    expect(screen.getByTestId('tasks-mobile-header-mode')).toHaveTextContent('Лента · 3');
    expect(screen.getByTestId('tasks-mobile-open-search')).toBeInTheDocument();
    expect(screen.getByTestId('tasks-mobile-mode-segmented')).toBeInTheDocument();
  });

  it('opens inline search and switches page mode', () => {
    const onSearchOpenChange = vi.fn();
    const onPageModeChange = vi.fn();
    render(
      <ThemeProvider theme={theme}>
        <TasksMobileHeader
          ui={ui}
          modeLabel="Лента"
          itemCount={1}
          isTaskDataMode
          onSearchOpenChange={onSearchOpenChange}
          onOpenNavigation={vi.fn()}
          primaryModeOptions={buildTasksMobilePrimaryModeOptions('Лента')}
          onPageModeChange={onPageModeChange}
          onPersonalRoleChange={vi.fn()}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByTestId('tasks-mobile-open-search'));
    expect(onSearchOpenChange).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByTestId('tasks-mobile-mode-deadlines'));
    expect(onPageModeChange).toHaveBeenCalledWith('deadlines');
  });
});
