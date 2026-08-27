import apiClient from './client';
import { getComputerDetail, getComputersSummary, searchComputers } from './computersApi';

jest.mock('./client', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const client = apiClient as unknown as { get: jest.Mock };

beforeEach(() => jest.clearAllMocks());

it('requests a bounded server-side Computers page and normalizes list fields', async () => {
  client.get.mockResolvedValue({
    data: {
      items: [{
        hostname: ' PC-01 ',
        mac_address: 'AA-BB',
        status: 'online',
        ip_list: ['10.1.1.1'],
        health: { cpu_load_percent: '12.5' },
        storage: [{ name: 'SSD', health_status: 'Warning', size_gb: '512' }],
      }, { invalid: true }],
      total: '1',
      has_more: false,
    },
  });
  const signal = new AbortController().signal;
  await expect(searchComputers({ scope: 'all', q: ' 10.1 ', status: 'online', limit: 900, offset: -5, signal })).resolves.toMatchObject({
    total: 1,
    items: [{ hostname: 'PC-01', ip_primary: '10.1.1.1', cpu_load_percent: 12.5, storage: [{ name: 'SSD', size_gb: 512 }] }],
  });
  expect(client.get).toHaveBeenCalledWith('/inventory/computers/search', {
    params: expect.objectContaining({ scope: 'all', q: '10.1', status: 'online', limit: 500, offset: 0, include_summary: false, mobile_safe: true }),
    signal,
  });
});

it('normalizes summary counters without inventing healthy values', async () => {
  client.get.mockResolvedValue({ data: { total: '5', unassigned: 1, statuses: { online: '3', offline: 2 }, branches: null } });
  await expect(getComputersSummary({ hideVm172: false })).resolves.toEqual({
    total: 5,
    unassigned: 1,
    statuses: { online: 3, offline: 2 },
    branches: {},
    outlook: {},
  });
  expect(client.get).toHaveBeenCalledWith('/inventory/computers/summary', {
    params: expect.not.objectContaining({ hide_vm_172: true }),
    signal: undefined,
  });
});

it('loads only the native detail fields and discards sensitive full-payload fields', async () => {
  client.get.mockResolvedValue({
    data: {
      hostname: 'PC-01',
      mac_address: 'AA:BB/01',
      network: { devices: [{ name: 'Ethernet', enabled: true, ipv4: ['10.1.1.1'] }] },
      user_profile_sizes: { total_size_bytes: '100', partial: true, profiles: [{ user_name: 'user', profile_path: 'C:\\Users\\user' }] },
      outlook_active_path: 'D:\\Mail\\user.ost',
      network_link: { port_name: 'secret-port' },
      monitors: [{ manufacturer: 'Dell', serial_number: 'MON-1' }],
      recent_changes: [{ event_id: 'change-1' }],
    },
  });
  const detail = await getComputerDetail('AA:BB/01', { scope: 'selected' });
  expect(detail).toMatchObject({
    network_devices: [{ name: 'Ethernet', enabled: true, ipv4: ['10.1.1.1'] }],
  });
  expect(detail).not.toHaveProperty('profiles');
  expect(detail).not.toHaveProperty('outlook_active_path');
  expect(detail).not.toHaveProperty('network_link');
  expect(detail).not.toHaveProperty('recent_changes');
  expect(client.get).toHaveBeenCalledWith('/inventory/computers/AA%3ABB%2F01', {
    params: { scope: 'selected', mobile_safe: true },
    signal: undefined,
  });
});

it('rejects malformed detail payloads instead of displaying an invented computer', async () => {
  client.get.mockResolvedValue({ data: { status: 'online' } });
  await expect(getComputerDetail('AA-BB')).rejects.toThrow('неполную карточку');
});
