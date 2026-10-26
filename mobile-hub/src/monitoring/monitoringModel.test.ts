import type { MonitoringTarget } from '../api/monitoringApi';
import {
  bucketSeries,
  countMonitoringIssues,
  defaultInterfaceId,
  displayTargetName,
  filterMonitoringTargets,
  outageNotice,
  targetStatus,
} from './monitoringModel';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const fresh = '2026-10-26T11:59:30Z';

function target(patch: Partial<MonitoringTarget> & { current?: MonitoringTarget['current'] }): MonitoringTarget {
  return { id: 't1', name: 'MSK_MikroTik-hAP', address: '10.0.0.1', enabled: true, ...patch };
}

describe('targetStatus', () => {
  it.each([
    ['paused', target({ enabled: false }), 'paused'],
    ['never polled', target({ current: {} }), 'unknown'],
    ['stale snapshot', target({ current: { checked_at: '2026-10-26T11:50:00Z', status: 'online', snmp_status: 'ok' } }), 'stale'],
    ['offline', target({ current: { checked_at: fresh, status: 'offline' } }), 'offline'],
    ['snmp down while pinging', target({ current: { checked_at: fresh, status: 'online', snmp_status: 'error' } }), 'snmp'],
    ['open WAN outage', target({
      current: { checked_at: fresh, status: 'online', snmp_status: 'ok' },
      outages: [{ id: 'e1', target_id: 't1', kind: 'link', title: '', severity: 'critical', opened_at: fresh, interface_role: 'wan' }],
    }), 'link'],
    ['open events', target({ current: { checked_at: fresh, status: 'online', snmp_status: 'ok', open_events: 2 } }), 'warning'],
    ['healthy', target({ current: { checked_at: fresh, status: 'online', snmp_status: 'ok' } }), 'online'],
  ])('%s → %s', (_name, input, expected) => {
    expect(targetStatus(input, NOW).key).toBe(expected);
  });

  it('keeps an offline target current for six minutes, but a healthy one for two', () => {
    const at = '2026-10-26T11:55:00Z';
    expect(targetStatus(target({ current: { checked_at: at, status: 'offline' } }), NOW).key).toBe('offline');
    expect(targetStatus(target({ current: { checked_at: at, status: 'online', snmp_status: 'ok' } }), NOW).key).toBe('stale');
  });
});

describe('filterMonitoringTargets', () => {
  const healthy = target({ id: 'a', name: 'SPB_MikroTik-1', address: '10.0.0.2', current: { checked_at: fresh, status: 'online', snmp_status: 'ok' } });
  const down = target({ id: 'b', name: 'MSK_MikroTik-1', address: '10.0.0.3', current: { checked_at: fresh, status: 'offline' } });
  const paused = target({ id: 'c', name: 'Magadan_MikroTik-1', address: '10.0.0.4', enabled: false });

  it('treats paused devices as neither problems nor online and puts central nodes first', () => {
    expect(filterMonitoringTargets([healthy, down, paused], '', 'issues', NOW).map((row) => row.id)).toEqual(['b']);
    expect(filterMonitoringTargets([healthy, down, paused], '', 'online', NOW).map((row) => row.id)).toEqual(['a']);
    expect(countMonitoringIssues([healthy, down, paused], NOW)).toBe(1);
    expect(filterMonitoringTargets([healthy, down, paused], '', 'all', NOW).map((row) => row.id)).toEqual(['b', 'a', 'c']);
  });

  it('searches by display name, raw name and address', () => {
    expect(filterMonitoringTargets([healthy, down], 'москва', 'all', NOW).map((row) => row.id)).toEqual(['b']);
    expect(filterMonitoringTargets([healthy, down], '10.0.0.2', 'all', NOW).map((row) => row.id)).toEqual(['a']);
  });
});

describe('outageNotice', () => {
  it('describes an ongoing outage with its start and duration', () => {
    const offline = target({
      current: { checked_at: fresh, status: 'offline', last_success_at: '2026-10-26T10:00:00Z', availability: { unreachable_since: '2026-10-26T10:30:00Z', ever_reachable: true } },
    });
    expect(outageNotice(offline, NOW)).toMatch(/^Обрыв: .* · 1 ч 30 мин$/);
  });

  it('is empty for a device that never had an outage', () => {
    expect(outageNotice(target({ current: { checked_at: fresh, status: 'online', snmp_status: 'ok' } }), NOW)).toBeNull();
  });
});

describe('chart helpers', () => {
  it('buckets by maximum and keeps gaps as null', () => {
    const points = [1, 5, null, null, 2, 3].map((value, index) => ({ at: String(index), rx_bps: value }));
    expect(bucketSeries(points, 'rx_bps', 3)).toEqual([5, null, 3]);
    expect(bucketSeries([], 'rx_bps')).toEqual([]);
  });

  it('prefers the pinned interface, then WAN, then a working ethernet port', () => {
    const ports = [
      { id: 'p1', name: 'ether1', current: { oper: 1, type: 6 } },
      { id: 'p2', name: 'wan', settings: { role: 'wan' } },
      { id: 'p3', name: 'pinned', settings: { pinned: true } },
    ];
    expect(defaultInterfaceId(ports)).toBe('p3');
    expect(defaultInterfaceId(ports.slice(0, 2))).toBe('p2');
    expect(defaultInterfaceId(ports.slice(0, 1))).toBe('p1');
    expect(defaultInterfaceId([])).toBe('');
  });

  it('shortens vendor-style names and marks reserve nodes', () => {
    expect(displayTargetName({ name: 'Gercena_64_MikroTik-hEX (резерв)' })).toBe('Герцена, 64 · резерв');
    expect(displayTargetName({ name: 'Центральный_MikroTik-CCR' })).toBe('Центральный узел');
  });
});
