import { describe, expect, it } from 'vitest';

import {
  buildPendingManualMeta,
  buildSelectedPointPortOptions,
  countDevicePorts,
  filterPointsForMap,
  findExactSocketMatches,
  resolveDisplayedPorts,
  resolveFocusPointId,
  resolveOptionValue,
  resolvePendingLookupStatus,
  selectFreeSockets,
  sortPortsByName,
} from './networkResolution';

describe('networkResolution', () => {
  it('sorts ports numerically by port_name', () => {
    const sorted = sortPortsByName([
      { port_name: '10' },
      { port_name: '2' },
      { port_name: '1' },
    ]);
    expect(sorted.map((p) => p.port_name)).toEqual(['1', '2', '10']);
  });

  it('resolves displayed ports by search scope', () => {
    const branchPorts = [{ port_name: 'b1' }];
    const devicePorts = [{ port_name: 'd1' }];
    const allPorts = [{ port_name: 'a1' }];
    expect(resolveDisplayedPorts({ branchWideSearch: true, branchPortResults: branchPorts, ports: devicePorts, allBranchPorts: allPorts })).toEqual(branchPorts);
    expect(resolveDisplayedPorts({ branchWideSearch: false, selectedDeviceId: 5, ports: devicePorts, allBranchPorts: allPorts })).toEqual(devicePorts);
    expect(resolveDisplayedPorts({ branchWideSearch: false, selectedDeviceId: null, ports: devicePorts, allBranchPorts: allPorts })).toEqual(allPorts);
  });

  it('selects free sockets without assigned port', () => {
    const sockets = [
      { id: 1, socket_code: 'A2', port_id: null },
      { id: 2, socket_code: 'A1', port_id: 7 },
      { id: 3, socket_code: 'A10', port_id: null },
    ];
    expect(selectFreeSockets(sockets).map((s) => s.socket_code)).toEqual(['A2', 'A10']);
  });

  it('counts ports per device', () => {
    const ports = [{ device_id: 1 }, { device_id: 1 }, { device_id: 2 }, { device_id: 0 }];
    const counts = countDevicePorts(ports);
    expect(counts.get(1)).toBe(2);
    expect(counts.get(2)).toBe(1);
    expect(counts.has(0)).toBe(false);
  });

  it('finds exact socket matches ignoring case and spaces', () => {
    const ports = [{ patch_panel_port: 'PP-01' }, { patch_panel_port: 'pp 01' }, { patch_panel_port: 'PP-02' }];
    expect(findExactSocketMatches(ports, ' pp 01 ').map((p) => p.patch_panel_port)).toEqual(['pp 01']);
    expect(findExactSocketMatches(ports, 'PP-01').map((p) => p.patch_panel_port)).toEqual(['PP-01']);
    expect(findExactSocketMatches(ports, '')).toEqual([]);
  });

  it('reports auto-pick status for a single exact match', () => {
    const status = resolvePendingLookupStatus({
      socketInput: 'PP-01',
      resolvedPort: { port_name: '1', patch_panel_port: 'PP-01' },
      resolvedSocket: null,
      exactMatchesCount: 1,
      portOptionsCount: 1,
      socketOptionsCount: 0,
    });
    expect(status.tone).toBe('success');
    expect(status.text).toContain('автоматически');
  });

  it('reports ambiguity when several ports match', () => {
    const status = resolvePendingLookupStatus({
      socketInput: 'PP',
      resolvedPort: null,
      resolvedSocket: null,
      exactMatchesCount: 3,
      portOptionsCount: 3,
      socketOptionsCount: 0,
    });
    expect(status.tone).toBe('warning');
    expect(status.text).toContain('3 портов');
  });

  it('keeps the selected point port as a fallback option', () => {
    const options = buildSelectedPointPortOptions({
      allPortsWithSocket: [],
      selectedPoint: { port_id: 9, port_name: 'gi0/1', patch_panel_port: 'PP-9' },
      socketInput: '',
    });
    expect(options).toHaveLength(1);
    expect(options[0].id).toBe(9);
  });

  it('clears option value when the id is not in options', () => {
    expect(resolveOptionValue(42, [{ id: 1 }])).toBe('');
    expect(resolveOptionValue(1, [{ id: 1 }])).toBe('1');
  });

  it('focuses the first filtered point during map search', () => {
    const focus = resolveFocusPointId({
      selectedPointId: null,
      pointsForMap: [{ id: 1 }],
      filteredPointsForMap: [{ id: 7 }],
      mapPointSearch: 'pp',
      selectedDeviceId: null,
      selectedMapId: 3,
    });
    expect(focus).toBe(7);
  });

  it('builds manual meta counts', () => {
    expect(buildPendingManualMeta({ socketInput: '', portOptionsCount: 0, socketOptionsCount: 0, socketsCount: 12 }))
      .toBe('12 розеток');
    expect(buildPendingManualMeta({ socketInput: 'x', portOptionsCount: 2, socketOptionsCount: 5, socketsCount: 0 }))
      .toBe('5 розеток · 2 портов');
    expect(buildPendingManualMeta({ socketInput: 'x', portOptionsCount: 0, socketOptionsCount: 0, socketsCount: 0 }))
      .toBe('Нет вариантов');
  });

  it('filters map points by query across searchable fields', () => {
    const points = [
      { id: 1, label: 'Принтер', patch_panel_port: 'PP-01' },
      { id: 2, label: 'ПК', endpoint_mac_raw: 'AA:BB' },
    ];
    expect(filterPointsForMap(points, 'pp-01').map((p) => p.id)).toEqual([1]);
    expect(filterPointsForMap(points, 'aa:bb').map((p) => p.id)).toEqual([2]);
    expect(filterPointsForMap(points, '')).toEqual(points);
  });
});
