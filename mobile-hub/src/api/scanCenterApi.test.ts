import apiClient from './client';
import {
  getScanDashboard,
  listScanAgents,
  listScanHosts,
  listScanIncidents,
  listScanReviewItems,
} from './scanCenterApi';

jest.mock('./client', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const client = apiClient as unknown as { get: jest.Mock };

beforeEach(() => jest.clearAllMocks());

it('preserves nested dashboard metrics and normalizes only known numeric fields', async () => {
  client.get.mockResolvedValue({
    data: {
      totals: { incidents_new: '7', agents_total: 10 },
      performance: { completed: '12', throughput_per_hour: '1.5', pending_oldest_age_sec: 30, queue_wait_ms: { p50: 10, p95: 20 } },
      ingest_limits: { max_pending_jobs: '2000' },
      expected_agent_version: ' 1.2.3 ',
      cached: true,
      degraded: false,
      cache_age_sec: '5',
      daily: [{ day: '2026-08-24' }],
    },
  });
  const signal = new AbortController().signal;
  await expect(getScanDashboard({ signal })).resolves.toMatchObject({
    totals: { incidents_new: 7, agents_total: 10 },
    performance: { completed: 12, throughput_per_hour: 1.5, queue_wait_ms: { p50: 10, p95: 20 } },
    cached: true,
    cache_age_sec: 5,
  });
  expect(client.get).toHaveBeenCalledWith('/scan/dashboard', { signal });
});

it('loads a mobile incident page without retaining paths or matched evidence', async () => {
  client.get.mockResolvedValue({
    data: {
      items: [{
        id: ' incident-1 ',
        hostname: 'HOST-1',
        status: 'resolved_moved',
        severity: 'high',
        file_path: 'C:\\Users\\employee\\secret.pdf',
        matched_patterns: [{ pattern: 'dsp', value: 'ДСП', snippet: '…ДСП…' }],
      }, { hostname: 'invalid' }],
      total: 1,
      limit: 50,
      offset: 0,
      has_more: false,
    },
  });
  const result = await listScanIncidents({ status: 'ack', q: ' secret ', limit: 999, offset: -4 });
  expect(result).toMatchObject({
    total: 1,
    items: [{ id: 'incident-1', status: 'resolved_moved' }],
  });
  expect(result.items[0]).not.toHaveProperty('file_path');
  expect(result.items[0]).not.toHaveProperty('matched_patterns');
  expect(client.get).toHaveBeenCalledWith('/scan/incidents', {
    params: { view: 'mobile', status: 'ack', q: 'secret', limit: 500, offset: 0 },
    signal: undefined,
  });
});

it('normalizes review, agent and host tables defensively', async () => {
  client.get
    .mockResolvedValueOnce({ data: { items: [{ job_id: 'job-1', hostname: 'HOST-1', error_text: 'ocr_timeout' }], total: 1 } })
    .mockResolvedValueOnce({ data: { items: [{ agent_id: 'agent-1', hostname: 'HOST-1', is_online: 'online', queue_size: '2' }], total: 1 } })
    .mockResolvedValueOnce({ data: { items: [{ hostname: 'HOST-1', incidents_total: '4', incidents_new: 2, top_exts: ['pdf', ''] }], total: 1 } });
  await expect(listScanReviewItems()).resolves.toMatchObject({ items: [{ id: 'job-1', reason: 'ocr_timeout' }] });
  await expect(listScanAgents({ online: 'online' })).resolves.toMatchObject({ items: [{ agent_id: 'agent-1', is_online: true, queue_size: 2 }] });
  await expect(listScanHosts({ severity: 'high' })).resolves.toMatchObject({ items: [{ hostname: 'HOST-1', incidents_total: 4, top_exts: ['pdf'] }] });
  expect(client.get).toHaveBeenNthCalledWith(1, '/scan/review-items', {
    params: { view: 'mobile', limit: 50, offset: 0 },
    signal: undefined,
  });
  expect(client.get).toHaveBeenNthCalledWith(2, '/scan/agents/table', expect.objectContaining({
    params: expect.objectContaining({ view: 'mobile' }),
  }));
  expect(client.get).toHaveBeenNthCalledWith(3, '/scan/hosts/table', expect.objectContaining({
    params: expect.objectContaining({ view: 'mobile' }),
  }));
});

it('uses the requested offset when table responses omit page metadata', async () => {
  client.get.mockResolvedValue({ data: { items: [{ hostname: 'HOST-60' }], total: 51 } });
  await expect(listScanHosts({ limit: 50, offset: 50 })).resolves.toMatchObject({
    offset: 50,
    limit: 50,
    has_more: false,
    next_offset: null,
  });
});
