import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import TasksAnalyticsCharts from './TasksAnalyticsCharts';

vi.mock('recharts', () => {
  const Wrapper = ({ children }) => <div>{children}</div>;
  return {
    Bar: ({ dataKey, stackId }) => <div data-testid={`bar-${dataKey}`} data-stack-id={stackId || ''} />,
    BarChart: Wrapper,
    CartesianGrid: () => null,
    Cell: () => null,
    Legend: () => null,
    Line: () => null,
    LineChart: Wrapper,
    Pie: Wrapper,
    PieChart: Wrapper,
    ResponsiveContainer: Wrapper,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

const ui = {
  borderSoft: '#ddd',
  subtleText: '#666',
  mutedText: '#777',
  panelSolid: '#fff',
  panelBorder: '#ddd',
};

describe('TasksAnalyticsCharts', () => {
  it('keeps overdue outside the open and done total stack', () => {
    render(
      <TasksAnalyticsCharts
        ui={ui}
        analyticsPayload={{ trend: { granularity: 'week' } }}
        analyticsParticipantSectionMeta={{ title: 'По исполнителям', subtitle: '' }}
        analyticsParticipantChartData={[{ name: 'Иванов', open: 2, done: 1, overdue: 1 }]}
        analyticsScopeChart={{ title: 'По проектам', rows: [{ name: 'Проект', open: 2, done: 1, overdue: 1 }] }}
      />,
    );

    const openBars = screen.getAllByTestId('bar-open');
    const doneBars = screen.getAllByTestId('bar-done');
    const overdueBars = screen.getAllByTestId('bar-overdue');

    expect(openBars.map((bar) => bar.dataset.stackId)).toEqual(['participant', 'scope']);
    expect(doneBars.map((bar) => bar.dataset.stackId)).toEqual(['participant', 'scope']);
    expect(overdueBars.every((bar) => bar.dataset.stackId === '')).toBe(true);
    expect(screen.getByText(/Группировка по неделям/)).toBeInTheDocument();
  });
});
