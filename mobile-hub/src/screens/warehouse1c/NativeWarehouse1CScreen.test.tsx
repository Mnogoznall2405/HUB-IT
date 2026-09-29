import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
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
jest.mock('../../api/warehouse1cApi', () => {
  const actual = jest.requireActual('../../api/warehouse1cApi');
  return {
    ...actual,
    getWarehouse1CBalances: jest.fn(),
    getWarehouse1CCatalogStatus: jest.fn(),
    getWarehouse1CDismissedWarehouses: jest.fn(),
    getWarehouse1CMovementDetail: jest.fn(),
    getWarehouse1CMovements: jest.fn(),
    searchWarehouse1CCatalog: jest.fn(),
  };
});
jest.mock('../../warehouse1c/nativeWarehouse1cFiles', () => ({
  downloadNativeWarehouse1cFile: jest.fn(),
  downloadNativeWarehouse1cPreview: jest.fn(),
}));
jest.mock('../../files/nativeAttachmentDownloads', () => ({
  openNativeFile: jest.fn(async () => undefined),
  shareNativeFile: jest.fn(async () => undefined),
}));

const mockedParams = useLocalSearchParams as jest.Mock;

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

const balance: warehouseApi.Warehouse1CBalance = {
  nomenclatureRef: 'nom-1', nomenclatureCode: 'M-1', nomenclatureName: 'Монитор',
  characteristicName: '', seriesRef: '', seriesName: '', seriesNumber: '',
  warehouseRef: 'wh-1', warehouseName: 'Склад Иванов',
  qtyBalance: 2, costBalance: 100, costAccountingBalance: 90, avgPrice: 50,
  batchStatusName: '', costMethodName: '',
  torg12Number: '', torg12Date: '', invoiceNumber: '', invoiceDate: '',
};

const movement: warehouseApi.Warehouse1CMovement = {
  registrarRef: 'reg-1', registrarName: 'Перемещение товаров', registrarNumber: '77',
  registrarDate: '2026-09-01T00:00:00Z', period: '2026-09-01T00:00:00Z',
  isTransfer: true, canOpenDetail: true,
  transferFromWarehouseName: 'Склад А', transferToWarehouseName: 'Склад Б', warehouseName: '',
  qtyStart: 1, qtyIn: 3, qtyOut: 1, qtyEnd: 5,
  costStart: 0, costIn: 0, costOut: 0, costEnd: 0,
  costAccountingStart: 0, costAccountingIn: 0, costAccountingOut: 0, costAccountingEnd: 0,
  avgPriceStart: 0, avgPriceEnd: 0,
  torg12Number: '', torg12Date: '', invoiceNumber: '', invoiceDate: '',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPermissions = ['warehouse_1c.read'];
  mockOfflineMode = false;
  mockedParams.mockReturnValue({});
  (warehouseApi.getWarehouse1CCatalogStatus as jest.Mock).mockResolvedValue(status);
  (warehouseApi.searchWarehouse1CCatalog as jest.Mock).mockResolvedValue([
    { ref: 'nom-1', code: 'M-1', name: 'Монитор' },
  ]);
  (warehouseApi.getWarehouse1CBalances as jest.Mock).mockResolvedValue({
    items: [balance],
    meta: { status: 'ok', returned: 1, total: 1, hasMore: false, truncated: false, asOf: '', source: 'live_1c', incompleteReason: '', nextCursor: '', ambiguousWarehouses: null },
  });
  (warehouseApi.getWarehouse1CMovements as jest.Mock).mockResolvedValue({
    items: [movement],
    meta: { status: 'ok', returned: 1, total: 1, hasMore: false, truncated: false, asOf: '', source: 'live_1c', incompleteReason: '', nextCursor: '', ambiguousWarehouses: null },
  });
  (warehouseApi.getWarehouse1CDismissedWarehouses as jest.Mock).mockResolvedValue({
    items: [],
    meta: { status: 'ok', returned: 0, total: 0, hasMore: false, truncated: false, asOf: '', source: 'zup', incompleteReason: '', nextCursor: '', ambiguousWarehouses: null },
  });
  (warehouseApi.getWarehouse1CMovementDetail as jest.Mock).mockResolvedValue({
    registrarRef: 'reg-1', registrarName: 'Перемещение товаров', registrarNumber: '77',
    registrarDate: '2026-09-01T00:00:00Z', documentTitle: 'Перемещение между складами',
    isTransfer: true, transferFromWarehouseName: 'Склад А', transferToWarehouseName: 'Склад Б',
    warehouseName: '', counterpartyName: '', comment: '',
    files: [{ ref: 'f-1', name: 'акт.pdf', size: 2048, contentType: 'application/pdf' }],
    filesStatus: 'ok', filesMessage: '',
  });
});

it('loads balances after picking filters and pressing search', async () => {
  const view = await render(<NativeWarehouse1CScreen />);
  expect(view.getByTestId('native-warehouse-1c-balances-search')).toBeTruthy();
  await fireEvent.changeText(view.getByTestId('native-warehouse-1c-balances-query'), 'монитор');
  await fireEvent.press(view.getByTestId('native-warehouse-1c-balances-search'));
  await waitFor(() => expect(view.getByText('Монитор')).toBeTruthy());
  expect(warehouseApi.getWarehouse1CBalances).toHaveBeenCalledWith(expect.objectContaining({
    query: 'монитор', limit: 200,
  }));
  expect(view.getByText(/Склад Иванов/)).toBeTruthy();
  await view.unmount();
});

it('keeps the catalog search behind the catalog segment', async () => {
  const view = await render(<NativeWarehouse1CScreen />);
  await fireEvent.press(view.getByTestId('native-warehouse-1c-tab-current'));
  await fireEvent.press(view.getByTestId('native-warehouse-1c-tab-catalog'));
  await waitFor(() => expect(view.getByText(/Каталог актуален/)).toBeTruthy());
  await fireEvent.changeText(view.getByTestId('native-warehouse-1c-search'), ' мон ');
  await waitFor(() => expect(view.getByText('Монитор')).toBeTruthy());
  expect(warehouseApi.searchWarehouse1CCatalog).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'nomenclature', query: 'мон', limit: 30,
  }));
  await view.unmount();
});

it('moves from a balance row to the movements segment and queries movements', async () => {
  const view = await render(<NativeWarehouse1CScreen />);
  await fireEvent.changeText(view.getByTestId('native-warehouse-1c-balances-query'), 'монитор');
  await fireEvent.press(view.getByTestId('native-warehouse-1c-balances-search'));
  await waitFor(() => expect(view.getByLabelText(/Показать детали/)).toBeTruthy());
  await fireEvent.press(view.getByLabelText(/Показать детали/));
  await waitFor(() => expect(view.getByText('Движения по позиции')).toBeTruthy());
  await fireEvent.press(view.getByText('Движения по позиции'));
  await waitFor(() => expect(warehouseApi.getWarehouse1CMovements).toHaveBeenCalledWith(expect.objectContaining({
    nomenclatureRef: 'nom-1', warehouseRef: 'wh-1',
  })));
  await waitFor(() => expect(view.getByText(/Перемещение товаров|№ 77/)).toBeTruthy());
  await view.unmount();
});

it('opens the movement document sheet and lists attached files', async () => {
  const view = await render(<NativeWarehouse1CScreen />);
  await fireEvent.press(view.getByTestId('native-warehouse-1c-tab-current'));
  await fireEvent.press(view.getByTestId('native-warehouse-1c-tab-movements'));
  await fireEvent.press(view.getByTestId('native-warehouse-1c-movements-filters'));
  await fireEvent.press(view.getByTestId('native-warehouse-1c-filter-nomenclature'));
  await fireEvent.changeText(view.getByTestId('native-warehouse-1c-picker-search'), 'мон');
  await waitFor(() => expect(view.getByLabelText('Выбрать Монитор')).toBeTruthy());
  await fireEvent.press(view.getByLabelText('Выбрать Монитор'));
  await fireEvent.press(view.getByTestId('native-warehouse-1c-filters-apply'));
  await waitFor(() => expect(view.getByText(/№ 77/)).toBeTruthy());
  await fireEvent.press(view.getByLabelText('Открыть документ № 77'));
  await waitFor(() => expect(view.getByText('акт.pdf')).toBeTruthy());
  expect(warehouseApi.getWarehouse1CMovementDetail).toHaveBeenCalledWith('reg-1', expect.anything());
  await view.unmount();
});

it('lazy-loads dismissed warehouses on the dismissed segment', async () => {
  const view = await render(<NativeWarehouse1CScreen />);
  expect(warehouseApi.getWarehouse1CDismissedWarehouses).not.toHaveBeenCalled();
  await fireEvent.press(view.getByTestId('native-warehouse-1c-tab-current'));
  await fireEvent.press(view.getByTestId('native-warehouse-1c-tab-dismissed'));
  await waitFor(() => expect(warehouseApi.getWarehouse1CDismissedWarehouses).toHaveBeenCalled());
  await waitFor(() => expect(view.getByText('Склады уволенных сотрудников не найдены.')).toBeTruthy());
  await view.unmount();
});

it('does not request warehouse data without permission or while offline', async () => {
  mockPermissions = [];
  const denied = await render(<NativeWarehouse1CScreen />);
  await waitFor(() => expect(denied.getByText('Нет доступа')).toBeTruthy());
  expect(warehouseApi.getWarehouse1CBalances).not.toHaveBeenCalled();
  await denied.unmount();

  jest.clearAllMocks();
  mockPermissions = ['warehouse_1c.read'];
  mockOfflineMode = true;
  const offline = await render(<NativeWarehouse1CScreen />);
  await waitFor(() => expect(offline.getByText(/Требуется сеть/)).toBeTruthy());
  await fireEvent.press(offline.getByTestId('native-warehouse-1c-balances-search'));
  expect(warehouseApi.getWarehouse1CBalances).not.toHaveBeenCalled();
  await offline.unmount();
});
