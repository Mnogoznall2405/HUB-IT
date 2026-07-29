import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import hubTaskAnalyticsAPI from '../api/hubTaskAnalytics';
import useTaskAnalytics from './useTaskAnalytics';

vi.mock('../api/hubTaskAnalytics', () => ({
  default: {
    getTaskAnalytics: vi.fn(),
  },
}));

const analyticsPayload = {
  summary: { total: 3, open: 2, done: 1 },
  by_participant: [],
  by_project: [],
  by_object: [],
  status_breakdown: [],
  trend: { granularity: 'day', items: [] },
};

const serverError = () => Object.assign(new Error('Request failed'), {
  response: {
    status: 500,
    data: { detail: 'Internal server error' },
    headers: { 'x-correlation-id': 'analytics-test-correlation' },
  },
});

describe('useTaskAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not retry a failed automatic request until retry is requested', async () => {
    hubTaskAnalyticsAPI.getTaskAnalytics.mockRejectedValue(serverError());

    const { result } = renderHook(() => useTaskAnalytics({ enabled: true }));

    await waitFor(() => {
      expect(result.current.error?.correlationId).toBe('analytics-test-correlation');
    });
    expect(hubTaskAnalyticsAPI.getTaskAnalytics).toHaveBeenCalledTimes(1);
    expect(result.current.hasCurrentPayload).toBe(false);
    expect(result.current.payload.summary).toEqual({});

    await act(async () => {
      await result.current.loadAnalytics({ force: true });
    });

    expect(hubTaskAnalyticsAPI.getTaskAnalytics).toHaveBeenCalledTimes(2);
  });

  it('keeps current data after a refresh error but hides it for changed filters', async () => {
    hubTaskAnalyticsAPI.getTaskAnalytics.mockResolvedValueOnce(analyticsPayload);

    const { result } = renderHook(() => useTaskAnalytics({ enabled: true }));

    await waitFor(() => {
      expect(result.current.hasCurrentPayload).toBe(true);
    });
    expect(result.current.payload.summary.total).toBe(3);

    hubTaskAnalyticsAPI.getTaskAnalytics.mockRejectedValue(serverError());
    await act(async () => {
      await result.current.loadAnalytics({ force: true });
    });

    expect(result.current.error).not.toBeNull();
    expect(result.current.hasCurrentPayload).toBe(true);
    expect(result.current.payload.summary.total).toBe(3);

    act(() => {
      result.current.setFilters((current) => ({
        ...current,
        end_date: '2026-07-27',
      }));
    });

    await waitFor(() => {
      expect(hubTaskAnalyticsAPI.getTaskAnalytics).toHaveBeenCalledTimes(3);
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.hasCurrentPayload).toBe(false);
    expect(result.current.payload.summary).toEqual({});
  });
});
