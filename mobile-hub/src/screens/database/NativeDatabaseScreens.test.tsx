import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import * as databaseApi from '../../api/databaseApi';
import * as equipmentCatalog from '../../cache/nativeEquipmentCatalogSnapshot';
import * as snapshotCache from '../../cache/nativeSnapshotCache';
import { pickNativeDatabaseActPdf } from '../../database/nativeDatabaseActUpload';
import { downloadEquipmentAct } from '../../database/nativeDatabaseFiles';
import { NativeDatabaseScreen } from './NativeDatabaseScreen';
import { NativeEquipmentDetailScreen } from './NativeEquipmentDetailScreen';

let mockPermissions = ['database.read'];
let mockOfflineMode = false;
let mockRole = 'user';

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    offlineMode: mockOfflineMode,
    user: { id: 17, role: mockRole },
    hasPermission: (permission: string) => mockPermissions.includes(permission),
  }),
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'system' } }),
}));


jest.mock('../../api/databaseApi', () => ({
  getCurrentDatabase: jest.fn(),
  listEquipment: jest.fn(),
  listConsumables: jest.fn(),
  listAvailableDatabases: jest.fn(),
  searchEquipment: jest.fn(),
  searchEquipmentActs: jest.fn(),
  switchDatabase: jest.fn(),
  touchRecentEquipmentCard: jest.fn(),
  getEquipment: jest.fn(),
  getEquipmentActs: jest.fn(),
  getEquipmentHistory: jest.fn(),
  getEquipmentWorkHistories: jest.fn(),
  updateEquipment: jest.fn(),
  updateConsumableQuantity: jest.fn(),
  listRecentEquipmentCards: jest.fn(),
  listRecentEquipmentActs: jest.fn(),
  touchRecentEquipmentAct: jest.fn(),
  deleteConsumable: jest.fn(),
  createEquipment: jest.fn(),
  createConsumable: jest.fn(),
  listEquipmentBranches: jest.fn(),
  listEquipmentLocations: jest.fn(),
  listEquipmentTypes: jest.fn(),
  listEquipmentStatuses: jest.fn(),
  listEquipmentModels: jest.fn(),
  searchEquipmentOwners: jest.fn(),
  submitEquipmentTransfer: jest.fn(),
  getEquipmentTransferJob: jest.fn(),
  deleteEquipment: jest.fn(),
  recordEquipmentWork: jest.fn(),
  sendEquipmentTransferActsEmail: jest.fn(),
  parseUploadedEquipmentAct: jest.fn(),
  getUploadedEquipmentActDraft: jest.fn(),
  commitUploadedEquipmentAct: jest.fn(),
}));

jest.mock('../../database/nativeDatabaseFiles', () => ({ downloadEquipmentAct: jest.fn(), downloadGeneratedTransferAct: jest.fn() }));
jest.mock('../../database/nativeDatabaseActUpload', () => ({
  normalizeUploadedActInventoryInput: (value: string) => String(value || '').split(/[\s,;]+/).map((item) => item.trim()).filter((item) => /^\d+$/.test(item)),
  pickNativeDatabaseActPdf: jest.fn(),
}));
jest.mock('../../files/nativeAttachmentDownloads', () => ({ openNativeFile: jest.fn() }));
jest.mock('../../cache/nativeSnapshotCache', () => ({
  readNativeCollectionSnapshot: jest.fn(),
  writeNativeCollectionSnapshot: jest.fn(async () => true),
  readNativeEntitySnapshot: jest.fn(),
  writeNativeEntitySnapshot: jest.fn(async () => true),
  readNativeSnapshot: jest.fn(),
  writeNativeSnapshot: jest.fn(async () => true),
}));
jest.mock('../../cache/nativeEquipmentCatalogSnapshot', () => ({
  readNativeEquipmentCatalogSnapshot: jest.fn(),
}));
jest.mock('expo-camera', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  return {
    CameraView: ({ onBarcodeScanned, testID }: { onBarcodeScanned?: (result: { data: string; type: string; bounds: object; cornerPoints: never[] }) => void; testID?: string }) => React.createElement(Pressable, {
      testID,
      onPress: () => onBarcodeScanned?.({ data: 'INV_NO: INV-1', type: 'qr', bounds: {}, cornerPoints: [] }),
    }),
    useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
  };
});

const params = useLocalSearchParams as jest.Mock;
const equipment = {
  inv_no: 'INV-1',
  serial_no: 'SN-1',
  hw_serial_no: '',
  part_no: '',
  type_name: 'Системный блок',
  model_name: 'OptiPlex',
  vendor_name: 'Dell',
  status_name: 'В работе',
  employee_name: 'Иванов И.И.',
  employee_dept: 'ИТ',
  employee_email: 'ivanov@example.com',
  branch_name: 'Главный офис',
  location_name: 'Кабинет 12',
  ip_address: '10.0.0.7',
  mac_address: '',
  network_name: '',
  domain_name: '',
  description: '',
  hub_db_id: '',
  hub_db_name: '',
  raw: { INV_NO: 'INV-1' },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPermissions = ['database.read'];
  mockOfflineMode = false;
  mockRole = 'user';
  params.mockReturnValue({});
  (snapshotCache.readNativeCollectionSnapshot as jest.Mock).mockResolvedValue(null);
  (snapshotCache.readNativeEntitySnapshot as jest.Mock).mockResolvedValue(null);
  (snapshotCache.readNativeSnapshot as jest.Mock).mockResolvedValue(null);
  (equipmentCatalog.readNativeEquipmentCatalogSnapshot as jest.Mock).mockResolvedValue(null);
  (databaseApi.listAvailableDatabases as jest.Mock).mockResolvedValue([{ id: 'ITINVENT', name: 'Основная' }]);
  (databaseApi.getCurrentDatabase as jest.Mock).mockResolvedValue({ id: 'ITINVENT', name: 'Основная', locked: false });
  (databaseApi.searchEquipment as jest.Mock).mockResolvedValue({ equipment: [equipment], total: 1, page: 1, pages: 1 });
  (databaseApi.listEquipment as jest.Mock).mockResolvedValue({ equipment: [equipment], total: 1, page: 1, pages: 1 });
  (databaseApi.searchEquipmentActs as jest.Mock).mockResolvedValue({ acts: [], total: 0, truncated: false });
  (databaseApi.listConsumables as jest.Mock).mockResolvedValue({
    consumables: [{ id: 11, inv_no: 'C-11', type_name: 'Картридж', model_name: 'HP 12A', qty: 3, branch_name: 'Главный офис', location_name: 'Склад', part_no: '', description: '', raw: {} }],
    total: 1,
    truncated: false,
  });
  (databaseApi.getEquipment as jest.Mock).mockResolvedValue(equipment);
  (databaseApi.getEquipmentActs as jest.Mock).mockResolvedValue({ acts: [{ doc_no: 7, doc_number: 'A-7', has_file: false, items: [], type_name: 'Передача', branch_name: '', location_name: '', employee_name: '', raw: {} }], total: 1 });
  (databaseApi.getEquipmentHistory as jest.Mock).mockResolvedValue({ history: [{ CH_COMMENT: 'Передача', CH_DATE: '2026-08-24T10:00:00+05:00' }], total: 1 });
  (databaseApi.getEquipmentWorkHistories as jest.Mock).mockResolvedValue({
    histories: [{ kind: 'cleaning', count: 2, last_date: '2026-08-20', time_ago_str: '4 дн. назад' }],
    unavailable: [],
    failed: [],
  });
  (databaseApi.touchRecentEquipmentCard as jest.Mock).mockResolvedValue(undefined);
  (databaseApi.updateEquipment as jest.Mock).mockResolvedValue({ ...equipment, serial_no: 'SN-NEW' });
  (databaseApi.updateConsumableQuantity as jest.Mock).mockResolvedValue({ qty_old: 3, qty_new: 5 });
  (databaseApi.listRecentEquipmentCards as jest.Mock).mockResolvedValue([]);
  (databaseApi.listRecentEquipmentActs as jest.Mock).mockResolvedValue([]);
  (databaseApi.listEquipmentBranches as jest.Mock).mockResolvedValue([]);
  (databaseApi.listEquipmentLocations as jest.Mock).mockResolvedValue([]);
  (databaseApi.listEquipmentTypes as jest.Mock).mockResolvedValue([]);
  (databaseApi.listEquipmentStatuses as jest.Mock).mockResolvedValue([]);
  (databaseApi.listEquipmentModels as jest.Mock).mockResolvedValue([]);
  (databaseApi.searchEquipmentOwners as jest.Mock).mockResolvedValue([]);
  (databaseApi.submitEquipmentTransfer as jest.Mock).mockResolvedValue({ success_count: 1, failed_count: 0, failed: [], retry_inv_nos: [], acts: [], job_status: 'done' });
  (databaseApi.deleteEquipment as jest.Mock).mockResolvedValue(undefined);
  (databaseApi.deleteConsumable as jest.Mock).mockResolvedValue(undefined);
  (databaseApi.recordEquipmentWork as jest.Mock).mockResolvedValue(undefined);
  (databaseApi.parseUploadedEquipmentAct as jest.Mock).mockResolvedValue({
    draft_id: 'draft-1', file_name: 'signed.pdf', from_employee: 'Иванов', to_employee: 'Петров',
    doc_date: '2026-08-25 10:00:00', equipment_inv_nos: ['1'], resolved_items: [], warnings: [],
  });
  (databaseApi.commitUploadedEquipmentAct as jest.Mock).mockResolvedValue({
    success: true, doc_no: 77, doc_number: 'A-77', file_no: 88, linked_item_ids: [1], linked_inv_nos: ['1'],
    message: 'Акт записан', reminder_pending_groups: 0,
  });
  (pickNativeDatabaseActPdf as jest.Mock).mockResolvedValue({
    uri: 'file:///cache/signed.pdf', name: 'signed.pdf', mimeType: 'application/pdf', size: 2048,
  });
});

it('searches equipment and opens the native detail route', async () => {
  params.mockReturnValue({ q: 'INV-1' });
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByText('OptiPlex')).toBeTruthy(), { timeout: 2_000 });
  expect(databaseApi.searchEquipment).toHaveBeenCalledWith('INV-1', 1, 50, 'ITINVENT');
  fireEvent.press(view.getByTestId('native-equipment-INV-1'));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/(shell)/database/[invNo]',
    params: { invNo: 'INV-1', databaseId: 'ITINVENT', tab: 'general' },
  });
});

it('browses equipment without forcing a search query', async () => {
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByText('OptiPlex')).toBeTruthy());
  expect(databaseApi.listEquipment).toHaveBeenCalledWith(1, 50, 'ITINVENT');
});

it('stores the database bootstrap and equipment list after an online load', async () => {
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByText('OptiPlex')).toBeTruthy());

  expect(snapshotCache.writeNativeSnapshot).toHaveBeenCalledWith(
    'database-bootstrap',
    17,
    expect.objectContaining({
      currentDatabase: expect.objectContaining({ id: 'ITINVENT' }),
      databases: [expect.objectContaining({ id: 'ITINVENT' })],
    }),
  );
  expect(snapshotCache.writeNativeCollectionSnapshot).toHaveBeenCalledWith(
    'database-inbox',
    17,
    expect.any(String),
    expect.objectContaining({
      equipment: [expect.objectContaining({ inv_no: 'INV-1' })],
      total: 1,
    }),
  );
});

it('opens the cached equipment list offline without calling the database API', async () => {
  mockOfflineMode = true;
  (snapshotCache.readNativeSnapshot as jest.Mock).mockResolvedValue({
    savedAt: 1,
    data: {
      databases: [{ id: 'ITINVENT', name: 'Основная' }],
      currentDatabase: { id: 'ITINVENT', name: 'Основная', locked: false },
    },
  });
  (snapshotCache.readNativeCollectionSnapshot as jest.Mock).mockResolvedValue({
    savedAt: 1,
    data: {
      signature: expect.any(String),
      mode: 'equipment',
      query: '',
      equipment: [equipment],
      consumables: [],
      acts: [],
      total: 1,
      page: 1,
      pages: 1,
    },
  });

  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByText('OptiPlex')).toBeTruthy());

  expect(databaseApi.listAvailableDatabases).not.toHaveBeenCalled();
  expect(databaseApi.getCurrentDatabase).not.toHaveBeenCalled();
  expect(databaseApi.listEquipment).not.toHaveBeenCalled();
});

it('opens the complete local equipment catalog offline instead of only the first cached page', async () => {
  mockOfflineMode = true;
  const secondEquipment = { ...equipment, inv_no: 'INV-2', model_name: 'ThinkCentre' };
  (snapshotCache.readNativeSnapshot as jest.Mock).mockResolvedValue({
    savedAt: 1,
    data: {
      databases: [{ id: 'ITINVENT', name: 'Основная' }],
      currentDatabase: { id: 'ITINVENT', name: 'Основная', locked: false },
    },
  });
  (snapshotCache.readNativeCollectionSnapshot as jest.Mock).mockResolvedValue({
    savedAt: 1,
    data: {
      signature: '', databaseId: 'ITINVENT', mode: 'equipment', query: '',
      equipment: [equipment], consumables: [], acts: [], total: 2, page: 1, pages: 1,
    },
  });
  (equipmentCatalog.readNativeEquipmentCatalogSnapshot as jest.Mock).mockResolvedValue({
    savedAt: 2,
    data: { databaseId: 'ITINVENT', equipment: [equipment, secondEquipment], total: 2 },
  });

  const view = await render(<NativeDatabaseScreen />);

  await waitFor(() => expect(view.getByText('ThinkCentre')).toBeTruthy());
  expect(databaseApi.listEquipment).not.toHaveBeenCalled();
});

it('filters the cached equipment list locally while offline', async () => {
  mockOfflineMode = true;
  const secondEquipment = { ...equipment, inv_no: 'INV-2', model_name: 'ThinkCentre', employee_name: 'Петров П.П.' };
  (snapshotCache.readNativeSnapshot as jest.Mock).mockResolvedValue({
    savedAt: 1,
    data: {
      databases: [{ id: 'ITINVENT', name: 'Основная' }],
      currentDatabase: { id: 'ITINVENT', name: 'Основная', locked: false },
    },
  });
  (snapshotCache.readNativeCollectionSnapshot as jest.Mock).mockImplementation(
    async (_scope: string, _userId: number, signature: string) => (
      JSON.parse(signature).query === ''
        ? {
          savedAt: 1,
          data: {
            signature,
            mode: 'equipment',
            query: '',
            equipment: [equipment, secondEquipment],
            consumables: [],
            acts: [],
            total: 2,
            page: 1,
            pages: 1,
          },
        }
        : null
    ),
  );

  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByText('ThinkCentre')).toBeTruthy());
  fireEvent.changeText(view.getByTestId('native-database-search'), 'Иванов');
  await waitFor(() => expect(view.queryByText('ThinkCentre')).toBeNull(), { timeout: 2_000 });
  expect(view.getByText('OptiPlex')).toBeTruthy();
  expect(databaseApi.searchEquipment).not.toHaveBeenCalled();
});

it('keeps QR navigation available offline because parsing does not require a server', async () => {
  mockOfflineMode = true;
  (snapshotCache.readNativeSnapshot as jest.Mock).mockResolvedValue({
    savedAt: 1,
    data: {
      databases: [{ id: 'ITINVENT', name: 'Основная' }],
      currentDatabase: { id: 'ITINVENT', name: 'Основная', locked: false },
    },
  });
  (snapshotCache.readNativeCollectionSnapshot as jest.Mock).mockResolvedValue({
    savedAt: 1,
    data: {
      signature: '', databaseId: 'ITINVENT', mode: 'equipment', query: '',
      equipment: [equipment], consumables: [], acts: [], total: 1, page: 1, pages: 1,
    },
  });
  (Clipboard.getStringAsync as jest.Mock).mockResolvedValue('INV_NO: INV-1');

  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-more')).toBeTruthy());
  await fireEvent.press(view.getByTestId('native-database-more'));
  expect(view.getByTestId('native-database-paste-qr')).toBeTruthy();
  fireEvent.press(view.getByTestId('native-database-paste-qr'));

  await waitFor(() => expect(router.push).toHaveBeenCalledWith({
    pathname: '/(shell)/database/[invNo]',
    params: { invNo: 'INV-1', databaseId: 'ITINVENT', tab: 'general' },
  }));
  expect(databaseApi.getEquipment).not.toHaveBeenCalled();
});

it('promotes a cached equipment-list item for native QR detail navigation offline', async () => {
  mockOfflineMode = true;
  let promotedDetail: unknown = null;
  (snapshotCache.writeNativeEntitySnapshot as jest.Mock).mockImplementationOnce(async (
    _scope: string,
    _userId: number,
    _key: string,
    data: unknown,
  ) => {
    promotedDetail = data;
  });
  (snapshotCache.readNativeSnapshot as jest.Mock).mockResolvedValue({
    savedAt: 1,
    data: {
      databases: [{ id: 'ITINVENT', name: 'Основная' }],
      currentDatabase: { id: 'ITINVENT', name: 'Основная', locked: false },
    },
  });
  (snapshotCache.readNativeCollectionSnapshot as jest.Mock).mockResolvedValue({
    savedAt: 1,
    data: {
      signature: '', databaseId: 'ITINVENT', mode: 'equipment', query: '',
      equipment: [equipment], consumables: [], acts: [], total: 1, page: 1, pages: 1,
    },
  });

  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-scan-qr')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });
  await waitFor(() => expect(view.getByTestId('native-database-qr-camera')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-qr-camera')); });

  await waitFor(() => expect(snapshotCache.writeNativeEntitySnapshot).toHaveBeenCalledWith(
    'database-item-details',
    17,
    'ITINVENT:INV-1',
    expect.objectContaining({
      databaseId: 'ITINVENT',
      equipment: expect.objectContaining({ inv_no: 'INV-1' }),
      loadedTabs: [],
    }),
  ));
  expect(databaseApi.getEquipment).not.toHaveBeenCalled();
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/(shell)/database/[invNo]',
    params: { invNo: 'INV-1', databaseId: 'ITINVENT', tab: 'general' },
  });

  await view.unmount();
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT', tab: 'general' });
  (snapshotCache.readNativeEntitySnapshot as jest.Mock).mockResolvedValue({ savedAt: 1, data: promotedDetail });
  const detail = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(detail.getAllByText('OptiPlex').length).toBeGreaterThan(0));
  expect(detail.getByText('Инв. № INV-1')).toBeTruthy();
  expect(databaseApi.getEquipment).not.toHaveBeenCalled();
});

it('keeps the inventory toolbar and equipment card readable without icon-only primary actions', async () => {
  mockPermissions = ['database.read', 'database.write'];
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByText('OptiPlex')).toBeTruthy());

  expect(view.getByTestId('native-database-header-selector')).toBeTruthy();
  expect(view.getByTestId('native-database-header-selector').props.accessibilityLabel).toContain('Основная');
  expect(view.getByText('Добавить')).toBeTruthy();
  expect(view.queryByText('Обновить')).toBeNull();
  await fireEvent.press(view.getByTestId('native-database-more'));
  expect(view.getByText('Обновить')).toBeTruthy();
  expect(view.getByText('Инв. № INV-1')).toBeTruthy();
  expect(view.getByText('OptiPlex').props.numberOfLines).toBe(2);
  expect(view.getByTestId('native-database-scan-qr').props.accessibilityLabel).toBe('Сканировать инвентарный QR-код камерой');
  expect(view.getByTestId('native-database-refresh').props.accessibilityLabel).toBe('Обновить результаты');
});

it('selects the database from a header sheet instead of a horizontal page strip', async () => {
  (databaseApi.listAvailableDatabases as jest.Mock).mockResolvedValueOnce([
    { id: 'ITINVENT', name: 'Основная' },
    { id: 'MSK-ITINVENT', name: 'Москва' },
  ]);
  (databaseApi.switchDatabase as jest.Mock).mockResolvedValueOnce({
    id: 'MSK-ITINVENT',
    name: 'Москва',
    locked: false,
  });
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-header-selector')).toBeTruthy());

  expect(view.queryByText('База данных')).toBeNull();
  await act(async () => {
    fireEvent.press(view.getByTestId('native-database-header-selector'));
  });
  expect(view.getByTestId('native-database-picker-sheet')).toBeTruthy();
  expect(view.getByText('Выберите базу')).toBeTruthy();

  await act(async () => {
    fireEvent.press(view.getByTestId('native-database-option-MSK-ITINVENT'));
  });

  await waitFor(() => expect(databaseApi.switchDatabase).toHaveBeenCalledWith('MSK-ITINVENT'));
  await waitFor(() => expect(view.getByTestId('native-database-header-selector').props.accessibilityLabel).toContain('Москва'));
  expect(view.queryByTestId('native-database-picker-sheet')).toBeNull();
});

it('hides recent cards while the user is searching so results stay in focus', async () => {
  (databaseApi.listRecentEquipmentCards as jest.Mock).mockResolvedValueOnce([{
    db_id: 'ITINVENT',
    inv_no: 'RECENT-1',
    last_action_label: 'Открыта',
    snapshot: { ...equipment, inv_no: 'RECENT-1', model_name: 'Недавний компьютер' },
  }]);
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByText('Недавние')).toBeTruthy());
  expect(view.queryByText('Недавний компьютер')).toBeNull();
  await fireEvent.press(view.getByLabelText('Недавние карточки'));
  expect(view.getByText('Недавний компьютер')).toBeTruthy();

  await act(async () => { fireEvent.changeText(view.getByTestId('native-database-search'), 'Dell'); });

  expect(view.queryByText('Недавний компьютер')).toBeNull();
  expect(view.queryByText('Недавние')).toBeNull();
});

it('accepts the established inventory QR payload from the clipboard', async () => {
  (Clipboard.getStringAsync as jest.Mock).mockResolvedValueOnce('INV_NO: INV-1');
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-more')).toBeTruthy());
  await fireEvent.press(view.getByTestId('native-database-more'));
  expect(view.getByTestId('native-database-paste-qr')).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByTestId('native-database-paste-qr')); });
  await waitFor(() => expect(router.push).toHaveBeenCalledWith({
    pathname: '/(shell)/database/[invNo]',
    params: { invNo: 'INV-1', databaseId: 'ITINVENT', tab: 'general' },
  }));
});

it('scans the established inventory QR payload with the native camera', async () => {
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-scan-qr')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });
  await waitFor(() => expect(view.getByTestId('native-database-qr-camera')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-qr-camera')); });
  await waitFor(() => expect(router.push).toHaveBeenCalledWith({
    pathname: '/(shell)/database/[invNo]',
    params: { invNo: 'INV-1', databaseId: 'ITINVENT', tab: 'general' },
  }));
  expect(view.queryByTestId('native-database-qr-camera')).toBeNull();
});

it('does not expose a whole-section web fallback', async () => {
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-results')).toBeTruthy());
  expect(view.queryByTestId('native-database-open-web')).toBeNull();
});

it('loads and filters the native read-only consumables list', async () => {
  params.mockReturnValue({ mode: 'consumables', q: '12A' });
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByText('HP 12A')).toBeTruthy());
  expect(databaseApi.listConsumables).toHaveBeenCalledWith({
    onlyPositiveQty: true,
    limit: 1000,
    databaseId: 'ITINVENT',
  });
  expect(view.getByText('3 шт.')).toBeTruthy();
});

it('updates consumable quantity natively with database.write', async () => {
  mockPermissions = ['database.read', 'database.write'];
  params.mockReturnValue({ mode: 'consumables' });
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByText('HP 12A')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-consumable-edit-11')); });
  await waitFor(() => expect(view.getByTestId('native-consumable-quantity-input')).toBeTruthy());
  await act(async () => { fireEvent.changeText(view.getByTestId('native-consumable-quantity-input'), '5'); });
  await act(async () => { fireEvent.press(view.getByTestId('native-consumable-quantity-save')); });
  await waitFor(() => expect(databaseApi.updateConsumableQuantity).toHaveBeenCalledWith(
    expect.objectContaining({ id: 11, inv_no: 'C-11' }),
    5,
    'ITINVENT',
  ));
});

it('starts only one act download for two immediate presses', async () => {
  params.mockReturnValue({ mode: 'acts' });
  (databaseApi.searchEquipmentActs as jest.Mock).mockResolvedValueOnce({
    acts: [{
      doc_no: 7,
      doc_number: 'A-7',
      has_file: true,
      items: [{ item_id: 1, inv_no: 'INV-1', serial_no: 'SN-1', model_name: 'OptiPlex' }],
      type_name: 'Передача',
      branch_name: '',
      location_name: '',
      employee_name: '',
      raw: {},
    }],
    total: 1,
    truncated: false,
  });
  (downloadEquipmentAct as jest.Mock).mockReturnValueOnce(new Promise(() => undefined));
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-act-file-7')).toBeTruthy());

  await act(async () => {
    fireEvent.press(view.getByTestId('native-equipment-act-file-7'));
    fireEvent.press(view.getByTestId('native-equipment-act-file-7'));
  });

  expect(downloadEquipmentAct).toHaveBeenCalledTimes(1);
});

it('loads detail first and lazy-loads acts only after selecting the tab', async () => {
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByText('Инв. № INV-1')).toBeTruthy());
  expect(databaseApi.getEquipment).toHaveBeenCalledWith('INV-1', 'ITINVENT');
  expect(databaseApi.getEquipmentActs).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.press(view.getByTestId('native-equipment-tab-acts'));
  });
  await waitFor(() => expect(databaseApi.getEquipmentActs).toHaveBeenCalledWith('INV-1', 'ITINVENT'));
  await waitFor(() => expect(view.getByText('Акт A-7')).toBeTruthy());
});

it('stores an opened equipment card and its loaded tabs for offline use', async () => {
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByText('Инв. № INV-1')).toBeTruthy());
  expect(snapshotCache.writeNativeEntitySnapshot).toHaveBeenCalledWith(
    'database-item-details',
    17,
    'ITINVENT:INV-1',
    expect.objectContaining({ equipment: expect.objectContaining({ inv_no: 'INV-1' }) }),
  );

  fireEvent.press(view.getByTestId('native-equipment-tab-acts'));
  await waitFor(() => expect(view.getByText('Акт A-7')).toBeTruthy());
  expect(snapshotCache.writeNativeEntitySnapshot).toHaveBeenLastCalledWith(
    'database-item-details',
    17,
    'ITINVENT:INV-1',
    expect.objectContaining({
      acts: [expect.objectContaining({ doc_no: 7 })],
      loadedTabs: expect.arrayContaining(['acts']),
    }),
  );
});

it('opens a cached equipment card and cached tab offline without network calls', async () => {
  mockOfflineMode = true;
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT', tab: 'acts' });
  (snapshotCache.readNativeEntitySnapshot as jest.Mock).mockResolvedValue({
    savedAt: 1,
    data: {
      databaseId: 'ITINVENT',
      equipment,
      acts: [{ doc_no: 7, doc_number: 'A-7', has_file: false, items: [], type_name: 'Передача', branch_name: '', location_name: '', employee_name: '', raw: {} }],
      history: [],
      workHistory: [],
      unavailableWorkKinds: [],
      loadedTabs: ['acts'],
    },
  });

  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByText('Инв. № INV-1')).toBeTruthy());
  await waitFor(() => expect(view.getByText('Акт A-7')).toBeTruthy());

  expect(databaseApi.getCurrentDatabase).not.toHaveBeenCalled();
  expect(databaseApi.getEquipment).not.toHaveBeenCalled();
  expect(databaseApi.getEquipmentActs).not.toHaveBeenCalled();
});

it('opens any equipment card from the complete offline catalog without a prior detail visit', async () => {
  mockOfflineMode = true;
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT', tab: 'general' });
  (snapshotCache.readNativeEntitySnapshot as jest.Mock).mockResolvedValue(null);
  (equipmentCatalog.readNativeEquipmentCatalogSnapshot as jest.Mock).mockResolvedValue({
    savedAt: 2,
    data: { databaseId: 'ITINVENT', equipment: [equipment], total: 1 },
  });

  const view = await render(<NativeEquipmentDetailScreen />);

  await waitFor(() => expect(view.getByText('Инв. № INV-1')).toBeTruthy());
  expect(view.queryByText(/ещё не сохранена/)).toBeNull();
  expect(databaseApi.getEquipment).not.toHaveBeenCalled();
});

it('lazy-loads service history and exposes native recording actions', async () => {
  mockPermissions = ['database.read', 'database.write'];
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByText('Инв. № INV-1')).toBeTruthy());
  await act(async () => {
    fireEvent.press(view.getByTestId('native-equipment-tab-works'));
  });
  await waitFor(() => expect(databaseApi.getEquipmentWorkHistories).toHaveBeenCalledWith(equipment, ['cleaning', 'component']));
  expect(view.getAllByText('Чистка компьютера').length).toBeGreaterThan(0);
  expect(view.getByTestId('native-equipment-record-work-cleaning')).toBeTruthy();
});

it('edits allowlisted equipment fields natively with database.write', async () => {
  mockPermissions = ['database.read', 'database.write'];
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByText('Инв. № INV-1')).toBeTruthy());
  await act(async () => {
    fireEvent.press(view.getByTestId('native-equipment-edit'));
  });
  await waitFor(() => expect(view.getByTestId('native-equipment-edit-serial_no')).toBeTruthy());
  await act(async () => {
    fireEvent.changeText(view.getByTestId('native-equipment-edit-serial_no'), 'SN-NEW');
  });
  await waitFor(() => expect(view.getByTestId('native-equipment-edit-serial_no').props.value).toBe('SN-NEW'));
  await act(async () => {
    fireEvent.press(view.getByTestId('native-equipment-edit-save'));
  });
  await waitFor(() => expect(databaseApi.updateEquipment).toHaveBeenCalledWith(
    'INV-1',
    expect.objectContaining({ serial_no: 'SN-NEW' }),
    'ITINVENT',
  ));
});

it('does not load database data without database.read', async () => {
  mockPermissions = [];
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByText('Нет доступа')).toBeTruthy());
  expect(databaseApi.getCurrentDatabase).not.toHaveBeenCalled();
  expect(databaseApi.searchEquipment).not.toHaveBeenCalled();
});

it('transfers one equipment card natively with a stable operation id', async () => {
  mockPermissions = ['database.read', 'database.write'];
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-transfer-owner')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-transfer-owner')); });
  await waitFor(() => expect(view.getByTestId('native-transfer-employee')).toBeTruthy());
  await act(async () => { fireEvent.changeText(view.getByTestId('native-transfer-employee'), 'Петров П.П.'); });
  await waitFor(() => expect(view.getByTestId('native-transfer-employee').props.value).toBe('Петров П.П.'));
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-action-confirm')); });
  await waitFor(() => expect(databaseApi.submitEquipmentTransfer).toHaveBeenCalledWith(
    'owner',
    expect.objectContaining({
      inv_nos: ['INV-1'],
      new_employee: 'Петров П.П.',
      operation_id: expect.any(String),
    }),
    'ITINVENT',
  ));
});

it('selects several cards and sends one server-supported bulk transfer request', async () => {
  mockPermissions = ['database.read', 'database.write'];
  const secondEquipment = { ...equipment, inv_no: 'INV-2', model_name: 'Latitude', raw: { INV_NO: 'INV-2' } };
  (databaseApi.listEquipment as jest.Mock).mockResolvedValueOnce({ equipment: [equipment, secondEquipment], total: 2, page: 1, pages: 1 });
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-INV-2')).toBeTruthy());
  await act(async () => { fireEvent(view.getByTestId('native-equipment-INV-1'), 'longPress'); });
  await waitFor(() => expect(view.getByTestId('native-database-selection')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-INV-2')); });
  await waitFor(() => expect(view.getByText('Выбрано: 2')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-bulk-transfer-owner')); });
  await act(async () => { fireEvent.changeText(view.getByTestId('native-transfer-employee'), 'Петров П.П.'); });
  await act(async () => { fireEvent.press(view.getByTestId('native-database-bulk-action-confirm')); });
  await waitFor(() => expect(databaseApi.submitEquipmentTransfer).toHaveBeenCalledWith(
    'owner',
    expect.objectContaining({ inv_nos: ['INV-1', 'INV-2'], new_employee: 'Петров П.П.', operation_id: expect.any(String) }),
    'ITINVENT',
  ));
});

it('picks, recognizes, verifies and commits a signed PDF act natively', async () => {
  mockPermissions = ['database.read', 'database.write'];
  params.mockReturnValue({ mode: 'acts' });
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-upload-act')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-upload-act')); });
  await act(async () => { fireEvent.press(view.getByTestId('native-database-act-pick')); });
  await waitFor(() => expect(view.getByText('signed.pdf')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-act-parse')); });
  await waitFor(() => expect(view.getByTestId('native-database-act-inventory').props.value).toBe('1'));
  expect(databaseApi.parseUploadedEquipmentAct).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'signed.pdf' }),
    { manualMode: false, databaseId: 'ITINVENT' },
  );
  await act(async () => { fireEvent.press(view.getByTestId('native-database-act-verify')); });
  await act(async () => { fireEvent.press(view.getByTestId('native-database-act-commit')); });
  await waitFor(() => expect(databaseApi.commitUploadedEquipmentAct).toHaveBeenCalledWith(
    expect.objectContaining({ draft_id: 'draft-1', equipment_inv_nos: ['1'] }),
    'ITINVENT',
  ));
  await waitFor(() => expect(view.getByText('Акт записан')).toBeTruthy());
});

it('records supported maintenance natively', async () => {
  mockPermissions = ['database.read', 'database.write'];
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT', tab: 'works' });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-record-work-cleaning')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-record-work-cleaning')); });
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-action-confirm')); });
  await waitFor(() => expect(databaseApi.recordEquipmentWork).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'cleaning',
    equipment,
    databaseId: 'ITINVENT',
  })));
});

it('keeps destructive equipment deletion admin-only and confirms it explicitly', async () => {
  mockRole = 'admin';
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-delete')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-delete')); });
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-action-confirm')); });
  await waitFor(() => expect(databaseApi.deleteEquipment).toHaveBeenCalledWith('INV-1', 'ITINVENT'));
});

it('deletes a consumable only with database.delete', async () => {
  mockPermissions = ['database.read', 'database.delete'];
  params.mockReturnValue({ mode: 'consumables' });
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-consumable-delete-11')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-consumable-delete-11')); });
  await act(async () => { fireEvent.press(view.getByTestId('native-consumable-delete-confirm')); });
  await waitFor(() => expect(databaseApi.deleteConsumable).toHaveBeenCalledWith(11, 'ITINVENT'));
});

it('adds a consumable from server directories without opening web', async () => {
  mockPermissions = ['database.read', 'database.write'];
  params.mockReturnValue({ mode: 'consumables' });
  (databaseApi.listEquipmentBranches as jest.Mock).mockResolvedValue([{ id: 1, name: 'Филиал A' }]);
  (databaseApi.listEquipmentLocations as jest.Mock).mockResolvedValue([{ id: 2, name: 'Склад A' }]);
  (databaseApi.listEquipmentTypes as jest.Mock).mockResolvedValue([{ type_no: 4, type_name: 'Картридж', ci_type: 4 }]);
  (databaseApi.createConsumable as jest.Mock).mockResolvedValue({ success: true, inv_no: 'C-12', message: 'Добавлен' });
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-create')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-create')); });
  await waitFor(() => expect(view.getByText('Филиал A')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByText('Филиал A')); });
  await waitFor(() => expect(view.getByText('Склад A')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByText('Склад A')); });
  await act(async () => { fireEvent.press(view.getByText('Картридж')); });
  await act(async () => { fireEvent.changeText(view.getByTestId('native-create-model'), 'HP 59A'); });
  await act(async () => { fireEvent.changeText(view.getByTestId('native-create-quantity'), '3'); });
  await act(async () => { fireEvent.press(view.getByTestId('native-database-create-save')); });
  await waitFor(() => expect(databaseApi.createConsumable).toHaveBeenCalledWith(expect.objectContaining({
    branch_no: 1,
    loc_no: 2,
    type_no: 4,
    qty: 3,
    model_name: 'HP 59A',
  }), 'ITINVENT'));
});

it('selects equipment through a visible button and cancels selection without navigation', async () => {
  mockPermissions = ['database.read', 'database.write'];
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-INV-1')).toBeTruthy());
  await fireEvent.press(view.getByTestId('native-database-select'));
  await fireEvent.press(view.getByTestId('native-equipment-INV-1'));
  expect(view.getByText('Выбрано: 1')).toBeTruthy();
  expect(router.push).not.toHaveBeenCalled();
  await fireEvent.press(view.getByTestId('native-database-selection-clear'));
  expect(view.queryByTestId('native-database-selection')).toBeNull();
  expect(view.getByTestId('native-database-select').props.accessibilityState.selected).toBe(false);
});
