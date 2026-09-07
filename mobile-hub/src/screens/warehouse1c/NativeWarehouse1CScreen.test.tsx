import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as warehouseApi from '../../api/warehouse1cApi';
import { NativeWarehouse1CScreen } from './NativeWarehouse1CScreen';

let mockPermissions = ['warehouse_1c.read'];
let mockOfflineMode = false;

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    offlineMode: mockOfflineMode,
    hasPermission: (permission: string) => mockPermissions.includes(permission),
  }),
}));
jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'system' } }),
}));
jest.mock('../../api/warehouse1cApi', () => ({
  getWarehouse1CCatalogStatus: jest.fn(),
  searchWarehouse1CCatalog: jest.fn(),
}));

const status: warehouseApi.Warehouse1CCatalogStatus = {
  status: 'ok',
  nomenclature_count: 120,
  warehouses_count: 7,
  updated_at: '2026-08-24T10:00:00Z',
  age_seconds: 600,
  stale_after_seconds: 7200,
  nomenclature_truncated: false,
  warehouses_truncated: false,
  sync_in_progress: false,
  complete: true,
  source: 'app_db_indexed_snapshot',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPermissions = ['warehouse_1c.read'];
  mockOfflineMode = false;
  (warehouseApi.getWarehouse1CCatalogStatus as jest.Mock).mockResolvedValue(status);
  (warehouseApi.searchWarehouse1CCatalog as jest.Mock).mockResolvedValue([
    { ref: 'nom-1', code: 'M-1', name: 'Монитор' },
  ]);
});

it('loads freshness and debounced nomenclature search from the bounded catalog API', async () => {
  const view = await render(<NativeWarehouse1CScreen />);
  await waitFor(() => expect(view.getByText(/Каталог актуален/)).toBeTruthy());
  await fireEvent.changeText(view.getByTestId('native-warehouse-1c-search'), ' мон ');
  await waitFor(() => expect(view.getByText('Монитор')).toBeTruthy());
  expect(warehouseApi.searchWarehouse1CCatalog).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'nomenclature', query: 'мон', limit: 30, signal: expect.anything(),
  }));
  await fireEvent.press(view.getByRole('button', { name: 'О каталоге' }));
  expect(view.getByText('Номенклатура: 120 · Склады: 7')).toBeTruthy();
  await view.unmount();
});

it('shows selected catalog results as native read-only cards', async () => {
  const view = await render(<NativeWarehouse1CScreen />);
  await fireEvent.changeText(view.getByTestId('native-warehouse-1c-search'), 'мон');
  await waitFor(() => expect(view.getByText('Монитор')).toBeTruthy());
  expect(view.getByLabelText('Монитор. Код M-1')).toBeTruthy();
  expect(view.queryByTestId('native-warehouse-1c-open-web')).toBeNull();
  await view.unmount();
});

it('cancels the prior mode and searches warehouses separately', async () => {
  (warehouseApi.searchWarehouse1CCatalog as jest.Mock).mockResolvedValue([
    { ref: 'warehouse-1', code: '', name: 'Основной склад' },
  ]);
  const view = await render(<NativeWarehouse1CScreen />);
  await fireEvent.press(view.getByText('Склады'));
  await fireEvent.changeText(view.getByTestId('native-warehouse-1c-search'), 'склад');
  await waitFor(() => expect(view.getByText('Основной склад')).toBeTruthy());
  expect(warehouseApi.searchWarehouse1CCatalog).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'warehouses' }));
  expect(view.getByLabelText('Основной склад')).toBeTruthy();
  await view.unmount();
});

it('shows stale and incomplete catalog states without calling them empty', async () => {
  (warehouseApi.getWarehouse1CCatalogStatus as jest.Mock).mockResolvedValue({
    ...status, status: 'incomplete', complete: false, warehouses_truncated: true,
  });
  const view = await render(<NativeWarehouse1CScreen />);
  await waitFor(() => expect(view.getByText(/Каталог загружен не полностью/)).toBeTruthy());
  expect(view.queryByText('По запросу ничего не найдено.')).toBeNull();
  await view.unmount();
});

it('does not request catalog data without permission or while offline', async () => {
  mockPermissions = [];
  const denied = await render(<NativeWarehouse1CScreen />);
  await waitFor(() => expect(denied.getByText('Нет доступа')).toBeTruthy());
  expect(warehouseApi.getWarehouse1CCatalogStatus).not.toHaveBeenCalled();
  expect(warehouseApi.searchWarehouse1CCatalog).not.toHaveBeenCalled();
  await denied.unmount();

  jest.clearAllMocks();
  mockPermissions = ['warehouse_1c.read'];
  mockOfflineMode = true;
  const offline = await render(<NativeWarehouse1CScreen />);
  await waitFor(() => expect(offline.getByText(/Требуется сеть/)).toBeTruthy());
  expect(warehouseApi.getWarehouse1CCatalogStatus).not.toHaveBeenCalled();
  expect(warehouseApi.searchWarehouse1CCatalog).not.toHaveBeenCalled();
  await offline.unmount();
});
