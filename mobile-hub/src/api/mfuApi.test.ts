import apiClient from './client';
import { getMfuDevices, normalizeMfuDevice, normalizeMfuDevicesPayload } from './mfuApi';

jest.mock('./client', () => ({ __esModule: true, default: { get: jest.fn() } }));
const client = apiClient as unknown as { get: jest.Mock };

beforeEach(() => jest.clearAllMocks());

const device = {
  key: 'main|17', id: 17, inv_no: 'P-17', model_name: 'Canon MF443', type_name: 'МФУ', branch_name: 'Главный офис', location_name: 'Склад',
  runtime: {
    ping: { status: 'online', latency_ms: '12', checked_at: '2026-08-24T10:00:00Z' },
    snmp: {
      status: 'ok', best_percent: 17, page_total: '1500', used_community: 'must-not-leak',
      supplies: [{ index: 1, name: 'Black toner', percent: 17 }],
      trays: [{ index: 1, media_name: 'A4', percent: 70, current_level: 350, max_capacity: 500 }],
      device_info: { sys_name: 'PRINTER-17', sys_descr: 'Canon' },
    },
  },
  maintenance: { total_operations: 1, recent: [{ timestamp: '2026-08-20', component_type: 'cartridge', replacement_item: '057H', employee: 'Иванов' }] },
};

it('keeps only bounded display fields and drops the SNMP community', () => {
  const result = normalizeMfuDevice(device);
  expect(result).toEqual(expect.objectContaining({ key: 'main|17', model_name: 'Canon MF443' }));
  expect(result?.ping).toEqual(expect.objectContaining({ status: 'online', latency_ms: 12 }));
  expect(result?.snmp).toEqual(expect.objectContaining({ page_total: 1500, best_percent: 17 }));
  expect(result?.snmp).not.toHaveProperty('used_community');
  expect(result?.snmp.supplies).toEqual([{ index: 1, name: 'Black toner', percent: 17 }]);
});

it('flattens grouped devices, deduplicates keys and reports caps without exposing debug rows', () => {
  const payload = normalizeMfuDevicesPayload({
    generated_at: '2026-08-24T10:00:00Z', db_id: 'main',
    totals: { devices: 3, online: 2, offline: 1, snmp_ok: 2 },
    grouped: { Office: { Room: [device, device, { ...device, key: 'main|18', inv_no: 'P-18' }, { ...device, key: 'main|19' }] } },
    meta: { raw_rows_count: 5000, source_maybe_truncated: true },
    debug: { snmp_slow_devices: [{ secret: true }] },
  }, { deviceCap: 2, sourceLimit: 5000 });
  expect(payload.devices).toHaveLength(2);
  expect(payload.branches).toEqual(['Главный офис']);
  expect(payload.list_truncated).toBe(true);
  expect(payload.source_maybe_truncated).toBe(true);
  expect(payload).not.toHaveProperty('debug');
});

it('requests only the bounded devices endpoint with abort support', async () => {
  client.get.mockResolvedValueOnce({ data: { totals: {}, grouped: {} } });
  const controller = new AbortController();
  await getMfuDevices({ signal: controller.signal });
  expect(client.get).toHaveBeenCalledWith('/mfu/devices', {
    params: { period_days: 365, recent_limit: 8, limit: 5000 }, signal: controller.signal,
  });

  expect(client.get).toHaveBeenCalledTimes(1);
});
