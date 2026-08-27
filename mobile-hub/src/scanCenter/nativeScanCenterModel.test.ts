import {
  buildScanAttentionItems,
  formatScanCount,
  mergeScanPage,
  scanIncidentStatusLabel,
  scanReasonLabel,
} from './nativeScanCenterModel';

it('formats operational counters without losing small exact values', () => {
  expect(formatScanCount(0)).toBe('0');
  expect(formatScanCount(42)).toBe('42');
  expect(formatScanCount(12_500)).toBe('12.5 тыс.');
  expect(formatScanCount(120_000)).toBe('120 тыс.');
});

it('merges unstable offset pages without duplicating rows', () => {
  expect(mergeScanPage(
    [{ id: 'a', value: 1 }, { id: 'b', value: 1 }],
    [{ id: 'b', value: 2 }, { id: 'c', value: 3 }],
    (item) => item.id,
  )).toEqual([{ id: 'a', value: 1 }, { id: 'b', value: 2 }, { id: 'c', value: 3 }]);
});

it.each([
  ['new', 'Новый'],
  ['ack', 'Просмотрен'],
  ['resolved_deleted', 'Файл удалён'],
  ['resolved_clean', 'Проверен, находок нет'],
  ['resolved_moved', 'Файл перемещён'],
])('maps incident status %s', (value, expected) => {
  expect(scanIncidentStatusLabel(value)).toBe(expected);
});

it('builds attention counters from the dashboard without claiming healthy before data exists', () => {
  expect(buildScanAttentionItems(null).map((item) => item.value)).toEqual([0, 0, 0]);
  expect(buildScanAttentionItems({
    totals: { incidents_new: 7, analysis_incomplete: 2, agents_total: 10, agents_online: 8, agents_outdated: 3 },
    performance: { completed: 0, throughput_per_hour: 0, pending_oldest_age_sec: 0 },
    ingest_limits: {},
    expected_agent_version: '1.2.3',
    cached: false,
    degraded: false,
    cache_age_sec: 0,
    daily: [],
    by_severity: [],
    by_branch: [],
  }).map((item) => item.value)).toEqual([7, 2, 3]);
  expect(scanReasonLabel('ocr_timeout')).toBe('OCR не завершился вовремя');
});
