import { describe, expect, it } from 'vitest';

import {
  buildAnalyticsFocusMeta,
  buildAnalyticsKpis,
  buildAnalyticsScopeChart,
  buildAnalyticsStatusChartData,
  buildSelectedAnalyticsParticipant,
} from './taskAnalyticsViewModel';

describe('taskAnalyticsViewModel', () => {
  it('builds focus meta for selected project', () => {
    const meta = buildAnalyticsFocusMeta({
      selectedProjects: [{ id: 1, name: 'Общие задачи' }],
    });
    expect(meta.title).toContain('проекту');
    expect(meta.chips).toHaveLength(1);
  });

  it('builds status chart fallback from summary', () => {
    const data = buildAnalyticsStatusChartData({
      statusBreakdown: [],
      summary: { new: 2, in_progress: 1, review: 0, done: 4 },
    });
    expect(data.find((item) => item.status === 'done')?.value).toBe(4);
  });

  it('switches scope chart to objects for single project focus', () => {
    const chart = buildAnalyticsScopeChart({
      projectIds: ['10'],
      objectIds: [],
      byObject: [{ object_name: 'Объект A', open: 1, done: 2, overdue: 0 }],
      byProject: [],
    });
    expect(chart.title).toBe('По объектам');
    expect(chart.rows[0].name).toBe('Объект A');
  });

  it('builds participant fallback and kpis', () => {
    const participant = buildSelectedAnalyticsParticipant({
      participantId: '7',
      byParticipant: [],
      fallbackUser: { full_name: 'Иванов' },
    });
    expect(participant.participant_name).toBe('Иванов');
    expect(buildAnalyticsKpis({ total: 10, open: 3, done: 7, completion_percent: 70 })[0].value).toBe(10);
  });
});
