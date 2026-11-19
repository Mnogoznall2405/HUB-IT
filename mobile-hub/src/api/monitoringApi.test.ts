import apiClient from './client';
import { getMonitoringEvents, probeMonitoringTarget } from './monitoringApi';

jest.mock('./client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

const client = apiClient as unknown as { get: jest.Mock; post: jest.Mock };

beforeEach(() => jest.clearAllMocks());

it('requests the events feed with the backend contract params', async () => {
  client.get.mockResolvedValue({
    data: [{ id: 'e1', target_id: 't1', kind: 'unreachable', title: 'Нет связи', severity: 'critical', opened_at: '2026-11-15T10:00:00Z' }],
  });
  const signal = new AbortController().signal;

  const events = await getMonitoringEvents({ targetId: 't1', limit: 50, signal });

  expect(events).toHaveLength(1);
  expect(client.get).toHaveBeenCalledWith('/monitoring/events', {
    params: { target_id: 't1', limit: 50 },
    signal,
  });
});

it('leaves event filters unset so the backend default limit applies, like the web feed', async () => {
  client.get.mockResolvedValue({ data: [] });

  await expect(getMonitoringEvents()).resolves.toEqual([]);
  expect(client.get).toHaveBeenCalledWith('/monitoring/events', {
    params: { target_id: undefined, limit: undefined },
    signal: undefined,
  });
});

it('posts the probe to the per-target route and normalizes the detail payload', async () => {
  client.post.mockResolvedValue({ data: { id: 't1', name: 'router', address: '10.0.0.1', enabled: true } });

  const result = await probeMonitoringTarget('t1');

  expect(client.post).toHaveBeenCalledWith('/monitoring/targets/t1/probe', null, {
    signal: undefined,
    timeout: 30_000,
  });
  expect(result).toEqual(expect.objectContaining({ id: 't1', interfaces: [], events: [] }));
});
