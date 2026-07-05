import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import TasksAnalyticsView from './TasksAnalyticsView';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';

vi.mock('./TasksAnalyticsCharts', () => ({
  default: () => <div data-testid="analytics-charts-stub" />,
}));

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

const focusMeta = {
  title: 'Все проекты',
  description: 'Сводка по всем задачам',
  chips: [],
};

describe('TasksAnalyticsView', () => {
  it('renders desktop filters panel with export action', async () => {
    const onExport = vi.fn();
    render(
      <ThemeProvider theme={theme}>
        <TasksAnalyticsView
          ui={ui}
          isAnalyticsMobile={false}
          filtersVisible
          onToggleFilters={vi.fn()}
          onExport={onExport}
          analyticsFocusMeta={focusMeta}
          filtersPanel={<div data-testid="filters-panel-content">filters</div>}
          analyticsKpis={[{ title: 'Всего', value: 12, helper: 'задач', color: '#2563eb' }]}
          analyticsStatusChartData={[]}
          analyticsParticipantSectionMeta={{ title: 'По участникам', subtitle: '' }}
          analyticsScopeChart={{ title: 'Срез', rows: [] }}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('analytics-filters-panel')).toBeInTheDocument();
    expect(screen.getByTestId('filters-panel-content')).toBeInTheDocument();
    expect(screen.getByText('Всего')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('analytics-charts-stub')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Экспорт Excel/i }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('renders participant card when participant selected', () => {
    render(
      <ThemeProvider theme={theme}>
        <TasksAnalyticsView
          ui={ui}
          analyticsFocusMeta={focusMeta}
          analyticsKpis={[]}
          analyticsStatusChartData={[]}
          analyticsParticipantSectionMeta={{ title: 'По участникам', subtitle: '' }}
          analyticsScopeChart={{ title: 'Срез', rows: [] }}
          selectedAnalyticsParticipant={{
            participant_name: 'Иванов И.И.',
            completion_percent: 80,
            new: 1,
            in_progress: 2,
            review: 0,
            open: 3,
            done: 5,
            done_on_time: 4,
            overdue: 1,
          }}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('analytics-participant-card')).toHaveTextContent('Иванов И.И.');
  });
});
