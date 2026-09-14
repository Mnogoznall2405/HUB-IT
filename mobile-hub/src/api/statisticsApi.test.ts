import apiClient from './client';
import {
  addPcCleaningRecord,
  fetchStatistics,
  getBatteryStatistics,
  getMfuStatistics,
  getPcCleaningRemaining,
  getPcCleaningStatistics,
  getPcComponentsStatistics,
  statisticsExportUrl,
} from './statisticsApi';

jest.mock('./client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

const client = apiClient as unknown as { get: jest.Mock; post: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('pc cleaning statistics', () => {
  it('requests the statistics endpoint with period and database', async () => {
    client.get.mockResolvedValueOnce({
      data: {
        generated_at: '2026-09-12T00:00:00Z',
        period_days: 90,
        start_date: '2026-06-14',
        end_date: '2026-09-12',
        totals: {
          total_pc: 10, cleaned_pc: 8, remaining_pc: 2,
          coverage_percent: 80, cleanings_total: 40, cleanings_period: 8,
        },
        branches: [{
          branch: 'Центральный', total_pc: 10, cleaned_pc: 8, remaining_pc: 2,
          coverage_percent: 80, cleanings_total: 40, cleanings_period: 8,
          remaining_pcs: [{ inv_no: 'INV-1', serial_no: 'SN-1' }],
        }],
      },
    });

    const result = await getPcCleaningStatistics({ periodDays: 90, databaseId: 'ITINVENT' });

    expect(client.get).toHaveBeenCalledWith('/json/works/cleaning/statistics', {
      params: { period_days: 90, db_name: 'ITINVENT' },
      signal: undefined,
    });
    expect(result.totals.remaining_pc).toBe(2);
    expect(result.branches[0].remaining_pcs[0].inv_no).toBe('INV-1');
  });

  it('clamps period days and tolerates missing fields', async () => {
    client.get.mockResolvedValueOnce({ data: {} });
    const result = await getPcCleaningStatistics({ periodDays: 99999 });
    expect(client.get).toHaveBeenCalledWith('/json/works/cleaning/statistics', {
      params: { period_days: 3650 },
      signal: undefined,
    });
    expect(result.totals.total_pc).toBe(0);
    expect(result.branches).toEqual([]);
  });

  it('loads remaining PCs for one branch', async () => {
    client.get.mockResolvedValueOnce({
      data: {
        branch: 'Центральный', period_days: 30, total_pc: 5, remaining_pc: 1,
        remaining_pcs: [{ inv_no: 'INV-3', serial_no: 'SN-3', equipment_id: 7 }],
      },
    });
    const result = await getPcCleaningRemaining({ periodDays: 30, branch: ' Центральный ', databaseId: 'OBJ' });
    expect(client.get).toHaveBeenCalledWith('/json/works/cleaning/statistics/remaining', {
      params: { period_days: 30, db_name: 'OBJ', branch: 'Центральный' },
      signal: undefined,
    });
    expect(result.remaining_pcs[0]).toMatchObject({ inv_no: 'INV-3', equipment_id: 7 });
  });
});

describe('other statistics tabs', () => {
  it('normalizes mfu payload arrays and maps', async () => {
    client.get.mockResolvedValueOnce({
      data: {
        period_days: 90, start_date: 'a', end_date: 'b',
        totals: { total_operations: 12, unique_branches: 2, unique_locations: 4 },
        by_type_period: { 'Картридж': 9 },
        by_item_period: { '057H': 9 },
        by_branch_period: { 'Центральный': 10, 'Юг': 2 },
        by_model_period: [{ model: 'Canon MF443', count: 8 }],
        by_location_period: [{ branch: 'Юг', location: 'Склад', operations: 2, last_timestamp: 't', top_items: [{ name: '057H', count: 2 }] }],
        recent_replacements: [{ timestamp: 't', branch: 'Юг', location: 'Склад', printer_model: 'Canon', component_type: 'Картридж', replacement_item: '057H', serial_no: 'SN' }],
      },
    });
    const result = await getMfuStatistics({ periodDays: 90 });
    expect(client.get).toHaveBeenCalledWith('/json/works/mfu/statistics', {
      params: { period_days: 90 }, signal: undefined,
    });
    expect(result.by_model_period[0]).toEqual({ model: 'Canon MF443', count: 8 });
    expect(result.by_location_period[0].top_items[0].name).toBe('057H');
    expect(result.recent_replacements[0].serial_no).toBe('SN');
  });

  it('normalizes battery and pc-components payloads', async () => {
    client.get.mockResolvedValueOnce({ data: { totals: { total_operations: 3 }, by_manufacturer_period: { Ippon: 2 } } });
    const battery = await getBatteryStatistics({ periodDays: 30 });
    expect(client.get).toHaveBeenCalledWith('/json/works/battery/statistics', expect.anything());
    expect(battery.by_manufacturer_period.Ippon).toBe(2);

    client.get.mockResolvedValueOnce({ data: { totals: { total_operations: 5 }, by_component_period: { 'SSD': 4 } } });
    const components = await getPcComponentsStatistics({ periodDays: 30 });
    expect(client.get).toHaveBeenCalledWith('/json/works/pc-components/statistics', expect.anything());
    expect(components.by_component_period.SSD).toBe(4);
  });

  it('fetchStatistics dispatches each tab to its endpoint', async () => {
    client.get.mockResolvedValue({ data: { totals: {} } });
    await fetchStatistics('pc', { periodDays: 30 });
    await fetchStatistics('mfu', { periodDays: 30 });
    await fetchStatistics('battery', { periodDays: 30 });
    await fetchStatistics('pc_components', { periodDays: 30 });
    expect(client.get.mock.calls.map(([url]) => url)).toEqual([
      '/json/works/cleaning/statistics',
      '/json/works/mfu/statistics',
      '/json/works/battery/statistics',
      '/json/works/pc-components/statistics',
    ]);
  });
});

describe('writes and export', () => {
  it('posts a cleaning record as-is', async () => {
    client.post.mockResolvedValueOnce({ data: {} });
    await addPcCleaningRecord({ serial_number: 'SN-1', employee: 'X', branch: 'B', location: 'L' });
    expect(client.post).toHaveBeenCalledWith('/json/works/cleaning', {
      serial_number: 'SN-1', employee: 'X', branch: 'B', location: 'L',
    });
  });

  it('builds the export URL with tab, period and db', () => {
    const url = statisticsExportUrl('battery', 180, 'OBJ-ITINVENT');
    expect(url).toContain('/json/works/statistics/export?');
    expect(url).toContain('tab=battery');
    expect(url).toContain('period_days=180');
    expect(url).toContain('db_name=OBJ-ITINVENT');
  });
});
