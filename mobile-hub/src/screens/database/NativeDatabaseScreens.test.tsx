import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { Alert, Share, StyleSheet } from 'react-native';
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
  getConsumableById: jest.fn(),
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

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const actual = jest.requireActual('react-native-safe-area-context');
  const insets = { top: 24, bottom: 0, left: 0, right: 0 };
  return {
    ...actual,
    SafeAreaInsetsContext: React.createContext(insets),
    initialWindowMetrics: { insets, frame: { x: 0, y: 0, width: 0, height: 0 } },
    useSafeAreaInsets: () => insets,
  };
});
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
let mockQrScanData = 'INV_NO: INV-1';

jest.mock('expo-camera', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  return {
    CameraView: ({ onBarcodeScanned, testID }: { onBarcodeScanned?: (result: { data: string; type: string; bounds: object; cornerPoints: never[] }) => void; testID?: string }) => React.createElement(Pressable, {
      testID,
      onPress: () => onBarcodeScanned?.({ data: mockQrScanData, type: 'qr', bounds: {}, cornerPoints: [] }),
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
  mockQrScanData = 'INV_NO: INV-1';
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
  (databaseApi.sendEquipmentTransferActsEmail as jest.Mock).mockResolvedValue({ success_count: 1, failed_count: 0, errors: [] });
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
  await waitFor(() => expect(view.getByText('OptiPlex')).toBeTruthy(), { timeout: 10_000 });
  expect(databaseApi.searchEquipment).toHaveBeenCalledWith('INV-1', 1, 50, 'ITINVENT');
  fireEvent.press(view.getByTestId('native-equipment-INV-1'));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/(shell)/database/[invNo]',
    params: { invNo: 'INV-1', databaseId: 'ITINVENT', tab: 'general' },
  });
}, 30_000);

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
  expect(view.getByText(/Инв\. № INV-1/)).toBeTruthy();
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

const fillEmployeeManually = async (view: Awaited<ReturnType<typeof render>>, name: string, fieldTestID = 'native-transfer-employee') => {
  await act(async () => { fireEvent.press(view.getByTestId(fieldTestID)); });
  await waitFor(() => expect(view.getByTestId('native-owner-picker-search')).toBeTruthy());
  await act(async () => { fireEvent.changeText(view.getByTestId('native-owner-picker-search'), name); });
  await waitFor(() => expect(view.getByTestId('native-owner-picker-manual')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-owner-picker-manual')); });
};

it('transfers one equipment card natively with a stable operation id', async () => {
  mockPermissions = ['database.read', 'database.write'];
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-actions-open')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-actions-open')); });
  await waitFor(() => expect(view.getByTestId('native-equipment-transfer-owner')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-transfer-owner')); });
  await waitFor(() => expect(view.getByTestId('native-transfer-employee')).toBeTruthy());
  await fillEmployeeManually(view, 'Петров П.П.');
  await waitFor(() => expect(view.getByText('Петров П.П.')).toBeTruthy());
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
  await fillEmployeeManually(view, 'Петров П.П.');
  await act(async () => { fireEvent.press(view.getByTestId('native-database-bulk-action-confirm')); });
  await waitFor(() => expect(databaseApi.submitEquipmentTransfer).toHaveBeenCalledWith(
    'owner',
    expect.objectContaining({ inv_nos: ['INV-1', 'INV-2'], new_employee: 'Петров П.П.', operation_id: expect.any(String) }),
    'ITINVENT',
  ));
});

it('substitutes a new employee from the ITINVENT owner directory search', async () => {
  mockPermissions = ['database.read', 'database.write'];
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  (databaseApi.searchEquipmentOwners as jest.Mock).mockResolvedValue([
    { owner_no: 2900, name: 'Козлов К.К.', department: 'ИТ', email: 'kozlov@example.com' },
    { owner_no: 42, name: 'Петров П.П.', department: 'ИТ', email: 'petrov@example.com' },
  ]);
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-actions-open')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-actions-open')); });
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-transfer-owner')); });
  await waitFor(() => expect(view.getByTestId('native-transfer-employee')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-transfer-employee')); });
  await waitFor(() => expect(view.getByTestId('native-owner-picker-search')).toBeTruthy());
  await act(async () => { fireEvent.changeText(view.getByTestId('native-owner-picker-search'), 'Козл'); });
  await waitFor(() => expect(databaseApi.searchEquipmentOwners).toHaveBeenCalledWith('Козл', 20, 'ITINVENT'));
  await waitFor(() => expect(view.getByTestId('native-owner-picker-option-2900')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-owner-picker-option-2900')); });
  await waitFor(() => expect(view.getByText('Козлов К.К.')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-action-confirm')); });
  await waitFor(() => expect(databaseApi.submitEquipmentTransfer).toHaveBeenCalledWith(
    'owner',
    expect.objectContaining({
      inv_nos: ['INV-1'],
      new_employee: 'Козлов К.К.',
      new_employee_no: 2900,
      new_employee_dept: 'ИТ',
      operation_id: expect.any(String),
    }),
    'ITINVENT',
  ));
});

it('drops the picked owner id when the employee name is entered manually', async () => {
  mockPermissions = ['database.read', 'database.write'];
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  (databaseApi.searchEquipmentOwners as jest.Mock).mockResolvedValue([
    { owner_no: 42, name: 'Петров П.П.', department: 'ИТ', email: '' },
  ]);
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-actions-open')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-actions-open')); });
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-transfer-owner')); });
  await act(async () => { fireEvent.press(view.getByTestId('native-transfer-employee')); });
  await act(async () => { fireEvent.changeText(view.getByTestId('native-owner-picker-search'), 'Петр'); });
  await waitFor(() => expect(view.getByTestId('native-owner-picker-option-42')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-owner-picker-option-42')); });
  await act(async () => { fireEvent.press(view.getByTestId('native-transfer-employee')); });
  await act(async () => { fireEvent.changeText(view.getByTestId('native-owner-picker-search'), 'Иванов Тест'); });
  await waitFor(() => expect(view.getByTestId('native-owner-picker-manual')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-owner-picker-manual')); });
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-action-confirm')); });
  await waitFor(() => expect(databaseApi.submitEquipmentTransfer).toHaveBeenCalled());
  const payload = (databaseApi.submitEquipmentTransfer as jest.Mock).mock.calls[0][1];
  expect(payload.new_employee).toBe('Иванов Тест');
  expect(payload.new_employee_no).toBeUndefined();
  expect(payload.new_employee_dept).toBeUndefined();
});

it('picks branch and location from searchable sheets for a location transfer', async () => {
  mockPermissions = ['database.read', 'database.write'];
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  (databaseApi.listEquipmentBranches as jest.Mock).mockResolvedValue([
    { id: 5, name: 'Филиал B' },
    { id: 6, name: 'Филиал C' },
  ]);
  (databaseApi.listEquipmentLocations as jest.Mock).mockResolvedValue([
    { id: 9, name: 'Склад B' },
    { id: 10, name: 'Кабинет 404' },
  ]);
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-actions-open')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-actions-open')); });
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-transfer-location')); });
  await waitFor(() => expect(view.getByTestId('native-transfer-pick-branch')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-transfer-pick-branch')); });
  await waitFor(() => expect(view.getByTestId('native-transfer-branch-option-5')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-transfer-branch-option-5')); });
  await waitFor(() => expect(view.getByText('Филиал B')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-transfer-pick-location')); });
  await waitFor(() => expect(view.getByTestId('native-transfer-location-search')).toBeTruthy());
  await act(async () => { fireEvent.changeText(view.getByTestId('native-transfer-location-search'), 'Склад'); });
  await waitFor(() => expect(view.queryByTestId('native-transfer-location-option-10')).toBeNull());
  await act(async () => { fireEvent.press(view.getByTestId('native-transfer-location-option-9')); });
  await waitFor(() => expect(view.getByText('Склад B')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-action-confirm')); });
  await waitFor(() => expect(databaseApi.submitEquipmentTransfer).toHaveBeenCalledWith(
    'location',
    expect.objectContaining({
      inv_nos: ['INV-1'],
      branch_no: 5,
      loc_no: 9,
      operation_id: expect.any(String),
    }),
    'ITINVENT',
  ));
});

it('resolves the act issuer against the ITINVENT owner directory', async () => {
  mockPermissions = ['database.read', 'database.write'];
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  (databaseApi.searchEquipmentOwners as jest.Mock).mockResolvedValue([
    { owner_no: 7, name: 'Сидоров С.С.', department: 'Склад', email: '' },
  ]);
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-actions-open')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-actions-open')); });
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-transfer-act-only')); });
  await waitFor(() => expect(view.getByTestId('native-transfer-issuer')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-transfer-issuer')); });
  await waitFor(() => expect(view.getByTestId('native-owner-picker-search')).toBeTruthy());
  await act(async () => { fireEvent.changeText(view.getByTestId('native-owner-picker-search'), 'Сидор'); });
  await waitFor(() => expect(view.getByTestId('native-owner-picker-option-7')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-owner-picker-option-7')); });
  await waitFor(() => expect(view.getByText('Сидоров С.С.')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-action-confirm')); });
  await waitFor(() => expect(databaseApi.submitEquipmentTransfer).toHaveBeenCalledWith(
    'act-only',
    expect.objectContaining({
      inv_nos: ['INV-1'],
      issuer_employee: 'Сидоров С.С.',
      issuer_owner_no: 7,
      operation_id: expect.any(String),
    }),
    'ITINVENT',
  ));
});

const transferResultWithAct = {
  success_count: 1,
  failed_count: 0,
  failed: [],
  retry_inv_nos: [],
  acts: [{ act_id: 'act-1', old_employee: 'Иванов И.И.', new_employee: 'Петров П.П.', equipment_count: 1, file_name: 'act-1.pdf', file_type: 'pdf' as const }],
  job_status: 'done' as const,
};

const runOwnerTransferToResult = async (view: Awaited<ReturnType<typeof render>>) => {
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-actions-open')); });
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-transfer-owner')); });
  await fillEmployeeManually(view, 'Петров П.П.');
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-action-confirm')); });
  await waitFor(() => expect(view.getByTestId('native-transfer-act-act-1')).toBeTruthy());
};

it('shows the transfer result with acts and sends them to the new employee by email', async () => {
  mockPermissions = ['database.read', 'database.write'];
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  (databaseApi.submitEquipmentTransfer as jest.Mock).mockResolvedValue(transferResultWithAct);
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-actions-open')).toBeTruthy());
  await runOwnerTransferToResult(view);
  await waitFor(() => expect(view.getByText('Перемещено: 1, ошибок: 0')).toBeTruthy());
  expect(view.getByText('Иванов И.И. (1)')).toBeTruthy();
  expect(view.getByTestId('native-transfer-email-send')).toBeTruthy();

  await act(async () => { fireEvent.press(view.getByTestId('native-transfer-email-mode-new')); });
  await act(async () => { fireEvent.press(view.getByTestId('native-transfer-email-send')); });
  await waitFor(() => expect(databaseApi.sendEquipmentTransferActsEmail).toHaveBeenCalledWith(
    expect.objectContaining({ act_ids: ['act-1'], mode: 'new' }),
    'ITINVENT',
  ));
});

it('sends transfer acts to a recipient picked from the owner sheet', async () => {
  mockPermissions = ['database.read', 'database.write'];
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  (databaseApi.submitEquipmentTransfer as jest.Mock).mockResolvedValue(transferResultWithAct);
  (databaseApi.searchEquipmentOwners as jest.Mock).mockResolvedValue([
    { owner_no: 2900, name: 'Козлов К.К.', department: 'ИТ', email: 'kozlov@example.com' },
  ]);
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-actions-open')).toBeTruthy());
  await runOwnerTransferToResult(view);

  await act(async () => { fireEvent.press(view.getByTestId('native-transfer-email-mode-employee')); });
  await act(async () => { fireEvent.press(view.getByTestId('native-transfer-email-recipient')); });
  await waitFor(() => expect(view.getByTestId('native-owner-picker-search')).toBeTruthy());
  await act(async () => { fireEvent.changeText(view.getByTestId('native-owner-picker-search'), 'Козл'); });
  await waitFor(() => expect(view.getByTestId('native-owner-picker-option-2900')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-owner-picker-option-2900')); });
  await waitFor(() => expect(view.getByText(/Козлов К\.К\./)).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-transfer-email-send')); });
  await waitFor(() => expect(databaseApi.sendEquipmentTransferActsEmail).toHaveBeenCalledWith(
    expect.objectContaining({ act_ids: ['act-1'], mode: 'employee', owner_no: 2900 }),
    'ITINVENT',
  ));
});

it('does not show the email block after a location-only transfer', async () => {
  mockPermissions = ['database.read', 'database.write'];
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  (databaseApi.submitEquipmentTransfer as jest.Mock).mockResolvedValue(transferResultWithAct);
  (databaseApi.listEquipmentBranches as jest.Mock).mockResolvedValue([{ id: 5, name: 'Филиал B' }]);
  (databaseApi.listEquipmentLocations as jest.Mock).mockResolvedValue([{ id: 9, name: 'Склад B' }]);
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-actions-open')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-actions-open')); });
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-transfer-location')); });
  await act(async () => { fireEvent.press(view.getByTestId('native-transfer-pick-branch')); });
  await waitFor(() => expect(view.getByTestId('native-transfer-branch-option-5')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-transfer-branch-option-5')); });
  await act(async () => { fireEvent.press(view.getByTestId('native-transfer-pick-location')); });
  await waitFor(() => expect(view.getByTestId('native-transfer-location-option-9')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-transfer-location-option-9')); });
  await waitFor(() => expect(view.getByTestId('native-equipment-action-confirm')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-action-confirm')); });
  await waitFor(() => expect(view.getByText('Перемещено: 1, ошибок: 0')).toBeTruthy());
  expect(view.getByTestId('native-transfer-act-act-1')).toBeTruthy();
  expect(view.queryByTestId('native-transfer-email-send')).toBeNull();
});

it('retries only the failed positions from the transfer result', async () => {
  mockPermissions = ['database.read', 'database.write'];
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  (databaseApi.submitEquipmentTransfer as jest.Mock)
    .mockResolvedValueOnce({
      success_count: 0,
      failed_count: 1,
      failed: [{ inv_no: 'INV-1', error: 'Ошибка сервера' }],
      retry_inv_nos: ['INV-1'],
      acts: [],
      job_status: 'done',
    })
    .mockResolvedValue({ ...transferResultWithAct, failed_count: 0 });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-actions-open')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-actions-open')); });
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-transfer-owner')); });
  await fillEmployeeManually(view, 'Петров П.П.');
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-action-confirm')); });
  await waitFor(() => expect(view.getByTestId('native-transfer-retry-failed')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-transfer-retry-failed')); });
  await waitFor(() => expect(databaseApi.submitEquipmentTransfer).toHaveBeenCalledTimes(2));
  expect((databaseApi.submitEquipmentTransfer as jest.Mock).mock.calls[1][1].inv_nos).toEqual(['INV-1']);
  await waitFor(() => expect(view.getByTestId('native-transfer-act-act-1')).toBeTruthy());
});

it('applies the top safe-area inset to the action modal header', async () => {
  mockPermissions = ['database.read', 'database.write'];
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-actions-open')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-actions-open')); });
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-transfer-owner')); });
  await waitFor(() => expect(view.getByTestId('native-transfer-employee')).toBeTruthy());
  const modalRoot = view.getByLabelText('Закрыть операцию').parent?.parent;
  expect(StyleSheet.flatten(modalRoot?.props.style)?.paddingTop).toBe(24);
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
  await waitFor(() => expect(view.getByTestId('native-equipment-menu')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-menu')); });
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

it('late equipment A must not replace equipment B', async () => {
  let finishA: (value: any) => void = () => {};
  params.mockReturnValue({invNo:'A',databaseId:'ITINVENT'});
  (databaseApi.getEquipment as jest.Mock).mockImplementation((id: string) => id === 'A' ? new Promise(resolve => {finishA=resolve;}) : Promise.resolve({...equipment,inv_no:'B',serial_no:'SERIAL-B'}));
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(databaseApi.getEquipment).toHaveBeenCalledWith('A','ITINVENT'));
  params.mockReturnValue({invNo:'B',databaseId:'ITINVENT'});
  await view.rerender(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByText('SERIAL-B')).toBeTruthy());
  await act(async () => {finishA({...equipment,inv_no:'A',serial_no:'SERIAL-A'});});
  expect(view.queryByText('SERIAL-B')).toBeTruthy();
});

it('offline navigation to uncached equipment must clear prior card', async () => {
  params.mockReturnValue({invNo:'INV-1',databaseId:'ITINVENT'});
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByText('SN-1')).toBeTruthy());
  mockOfflineMode=true;
  params.mockReturnValue({invNo:'UNCACHED',databaseId:'ITINVENT'});
  await view.rerender(<NativeEquipmentDetailScreen />);
  await act(async () => {});
  expect(view.queryByText('SN-1')).toBeNull();
});

it('copies the serial number via the icon and a long press on the row', async () => {
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-field-serial-copy')).toBeTruthy());

  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-field-serial-copy')); });
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith('SN-1'));
  await waitFor(() => expect(view.getByTestId('native-toast')).toBeTruthy());
  expect(view.getByTestId('native-toast').props.children).toBe('Серийный номер скопирован');

  (Clipboard.setStringAsync as jest.Mock).mockClear();
  await act(async () => { fireEvent(view.getByTestId('native-equipment-field-serial'), 'longPress'); });
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith('SN-1'));
});

it('renders an empty field without a copy affordance', async () => {
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-section-device-empty-toggle')).toBeTruthy());
  expect(view.queryByTestId('native-equipment-field-part')).toBeNull();
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-section-device-empty-toggle')); });
  const field = view.getByTestId('native-equipment-field-part');
  expect(field.props.accessible).toBe(true);
  expect(field.props.accessibilityLabel).toContain('не указано');
  expect(view.queryByTestId('native-equipment-field-part-copy')).toBeNull();
});

it('shows a failure toast when the clipboard rejects the value', async () => {
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  (Clipboard.setStringAsync as jest.Mock).mockRejectedValueOnce(new Error('denied'));
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-field-serial-copy')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-field-serial-copy')); });
  await waitFor(() => expect(view.getByTestId('native-toast')).toBeTruthy());
  expect(view.getByTestId('native-toast').props.children).toBe('Не удалось скопировать');
});

it('copies the inventory number from the header pill', async () => {
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-copy-inv')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-copy-inv')); });
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith('INV-1'));
  await waitFor(() => expect(view.getByTestId('native-toast').props.children).toBe('Инвентарный номер скопирован'));
});

it('copies the model name from the header copy icon', async () => {
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-copy-title')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-copy-title')); });
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith('OptiPlex'));
  await waitFor(() => expect(view.getByTestId('native-toast').props.children).toBe('Модель скопирована'));
});

it('copies the model name via long press on the title', async () => {
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-title')).toBeTruthy());
  await act(async () => { fireEvent(view.getByTestId('native-equipment-title'), 'longPress'); });
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith('OptiPlex'));
  await waitFor(() => expect(view.getByTestId('native-toast').props.children).toBe('Модель скопирована'));
});

it('copies the derived title when the model name is empty', async () => {
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  (databaseApi.getEquipment as jest.Mock).mockResolvedValue({ ...equipment, model_name: '' });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-copy-title')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-copy-title')); });
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith('Системный блок'));
  await waitFor(() => expect(view.getByTestId('native-toast').props.children).toBe('Модель скопирована'));
});

it('keeps field copying available in offline mode', async () => {
  mockOfflineMode = true;
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  (snapshotCache.readNativeEntitySnapshot as jest.Mock).mockResolvedValue({
    savedAt: 1,
    data: {
      databaseId: 'ITINVENT',
      equipment,
      acts: [],
      history: [],
      workHistory: [],
      unavailableWorkKinds: [],
      loadedTabs: [],
    },
  });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-field-serial-copy')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-field-serial-copy')); });
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith('SN-1'));
  expect(databaseApi.getEquipment).not.toHaveBeenCalled();
});

it('copies the employee name via long press in offline mode without opening the warehouse sheet', async () => {
  mockOfflineMode = true;
  mockPermissions = ['database.read', 'warehouse_1c.read'];
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  (snapshotCache.readNativeEntitySnapshot as jest.Mock).mockResolvedValue({
    savedAt: 1,
    data: {
      databaseId: 'ITINVENT',
      equipment,
      acts: [],
      history: [],
      workHistory: [],
      unavailableWorkKinds: [],
      loadedTabs: [],
    },
  });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-employee-compare')).toBeTruthy());
  await act(async () => { fireEvent(view.getByTestId('native-equipment-employee-compare'), 'longPress'); });
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith('Иванов И.И.'));
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-employee-compare')); });
  expect(view.queryByTestId('native-employee-compare-sheet')).toBeNull();
});

it('keeps selectable only on the multiline description value', async () => {
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  (databaseApi.getEquipment as jest.Mock).mockResolvedValue({ ...equipment, description: 'Тестовое описание устройства' });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-field-serial')).toBeTruthy());
  const serialValue = within(view.getByTestId('native-equipment-field-serial')).getByText('SN-1');
  expect(serialValue.props.selectable).toBeFalsy();
  const descriptionValue = within(view.getByTestId('native-equipment-field-description')).getByText('Тестовое описание устройства');
  expect(descriptionValue.props.selectable).toBe(true);
});

it('summarizes last maintenance on the card tab via a background works load', async () => {
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByText('Обслуживание')).toBeTruthy());
  await waitFor(() => expect(view.getByText(/20\.08\.2026/)).toBeTruthy());
  expect(view.getByText(/4 дн\. назад/)).toBeTruthy();
  expect(view.getByText('нет записей')).toBeTruthy();
  expect(databaseApi.getEquipmentWorkHistories).toHaveBeenCalledWith(equipment, ['cleaning', 'component']);
});

it('opens the works tab from the maintenance link without a second request', async () => {
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByText(/20\.08\.2026/)).toBeTruthy());
  expect((databaseApi.getEquipmentWorkHistories as jest.Mock).mock.calls.length).toBe(1);
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-all-works')); });
  await waitFor(() => expect(view.queryByTestId('native-equipment-all-works')).toBeNull());
  expect((databaseApi.getEquipmentWorkHistories as jest.Mock).mock.calls.length).toBe(1);
});

it('hides the maintenance summary when the background works load fails', async () => {
  (databaseApi.getEquipmentWorkHistories as jest.Mock).mockRejectedValue(new Error('service down'));
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByText('Инв. № INV-1')).toBeTruthy());
  await waitFor(() => expect(view.queryByText('Обслуживание')).toBeNull());
  expect(view.queryByText(/Не удалось|ещё не сохранена/)).toBeNull();
});

it('restores the maintenance summary offline from the snapshot only', async () => {
  mockOfflineMode = true;
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  (snapshotCache.readNativeEntitySnapshot as jest.Mock).mockResolvedValue({
    savedAt: 1,
    data: {
      databaseId: 'ITINVENT',
      equipment,
      acts: [],
      history: [],
      workHistory: [{ kind: 'cleaning', count: 2, last_date: '2026-08-20', time_ago_str: '4 дн. назад' }],
      unavailableWorkKinds: [],
      loadedTabs: ['works'],
    },
  });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByText('Обслуживание')).toBeTruthy());
  await waitFor(() => expect(view.getByText(/20\.08\.2026/)).toBeTruthy());
  expect(databaseApi.getEquipmentWorkHistories).not.toHaveBeenCalled();
});

it('keeps save disabled until the draft changes and confirms cancel with changes', async () => {
  mockPermissions = ['database.read', 'database.write'];
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByText('Инв. № INV-1')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-edit')); });
  await waitFor(() => expect(view.getByTestId('native-equipment-edit-serial_no')).toBeTruthy());
  expect(view.getByTestId('native-equipment-edit-save').props.accessibilityState.disabled).toBe(true);
  await act(async () => { fireEvent.changeText(view.getByTestId('native-equipment-edit-serial_no'), 'SN-NEW'); });
  await waitFor(() => expect(view.getByTestId('native-equipment-edit-save').props.accessibilityState.disabled).toBe(false));
  await act(async () => { fireEvent.press(view.getByLabelText('Закрыть редактирование')); });
  await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Отменить изменения?', expect.any(String), expect.any(Array)));
  alertSpy.mockRestore();
});

it('blocks saving an invalid IP address without calling updateEquipment', async () => {
  mockPermissions = ['database.read', 'database.write'];
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByText('Инв. № INV-1')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-edit')); });
  await waitFor(() => expect(view.getByTestId('native-equipment-edit-ip_address')).toBeTruthy());
  await act(async () => { fireEvent.changeText(view.getByTestId('native-equipment-edit-ip_address'), '999.1.1.1'); });
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-edit-save')); });
  await waitFor(() => expect(view.getByText(/четыре числа 0–255/)).toBeTruthy());
  expect(databaseApi.updateEquipment).not.toHaveBeenCalled();
});

it('picks a model through the searchable picker sheet', async () => {
  mockPermissions = ['database.read', 'database.write'];
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  (databaseApi.getEquipment as jest.Mock).mockResolvedValue({ ...equipment, type_no: 4, model_no: 7 });
  (databaseApi.listEquipmentTypes as jest.Mock).mockResolvedValue([{ type_no: 4, type_name: 'Системный блок', ci_type: 1 }]);
  (databaseApi.listEquipmentModels as jest.Mock).mockResolvedValue([
    { model_no: 7, model_name: 'OptiPlex 7010', type_no: 4 },
    { model_no: 8, model_name: 'ThinkCentre M720', type_no: 4 },
  ]);
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByText('Инв. № INV-1')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-edit')); });
  await waitFor(() => expect(view.getByTestId('native-equipment-edit-pick-model')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-edit-pick-model')); });
  await waitFor(() => expect(view.getByTestId('native-equipment-picker-search')).toBeTruthy());
  await act(async () => { fireEvent.changeText(view.getByTestId('native-equipment-picker-search'), 'think'); });
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-picker-option-8')); });
  await waitFor(() => expect(view.getByText('ThinkCentre M720')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-edit-save')); });
  await waitFor(() => expect(databaseApi.updateEquipment).toHaveBeenCalledWith('INV-1', expect.objectContaining({ model_no: 8 }), 'ITINVENT'));
});

it('copies the whole card from the overflow menu', async () => {
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-menu')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-menu')); });
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-copy-all')); });
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith(expect.stringContaining('INV-1')));
  const copied = String((Clipboard.setStringAsync as jest.Mock).mock.calls[0][0]);
  expect(copied).toContain('OptiPlex');
  expect(copied).toContain('Системный блок');
  await waitFor(() => expect(view.getByTestId('native-toast').props.children).toBe('Карточка скопирована'));
});

it('shares the card text and stays quiet when the share sheet is dismissed', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: null });
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-menu')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-menu')); });
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-share')); });
  await waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('INV-1') })));

  share.mockRejectedValueOnce(new Error('dismissed'));
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-menu')); });
  await waitFor(() => expect(view.getByTestId('native-equipment-share')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-share')); });
  await waitFor(() => expect(share).toHaveBeenCalledTimes(2));
  expect(view.queryByTestId('native-toast')).toBeNull();
  share.mockRestore();
});

it('hides the edit button and the actions sheet without database.write', async () => {
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByText('Инв. № INV-1')).toBeTruthy());
  expect(view.queryByTestId('native-equipment-edit')).toBeNull();
  expect(view.queryByTestId('native-equipment-actions-open')).toBeNull();
});

it('hides the delete item in the overflow menu for a non-admin user', async () => {
  mockPermissions = ['database.read', 'database.write'];
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByTestId('native-equipment-menu')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-menu')); });
  await waitFor(() => expect(view.getByTestId('native-equipment-copy-all')).toBeTruthy());
  expect(view.queryByTestId('native-equipment-delete')).toBeNull();
});

it('refreshes the maintenance summary after recording work from the bottom bar', async () => {
  mockPermissions = ['database.read', 'database.write'];
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  let persisted: { databaseId?: string; equipment?: { description?: string }; workHistory?: Array<{ time_ago_str?: string }> } | null = null;
  (snapshotCache.readNativeEntitySnapshot as jest.Mock).mockImplementation(async () => (persisted ? { savedAt: 1, data: persisted } : null));
  (snapshotCache.writeNativeEntitySnapshot as jest.Mock).mockImplementation(async (_scope: unknown, _user: unknown, _key: unknown, data: typeof persisted) => { persisted = data; });
  (databaseApi.getEquipment as jest.Mock)
    .mockResolvedValueOnce(equipment)
    .mockResolvedValue({ ...equipment, description: 'Новое описание' });
  (databaseApi.getEquipmentWorkHistories as jest.Mock)
    .mockResolvedValueOnce({ histories: [{ kind: 'cleaning', count: 2, last_date: '2026-08-20', time_ago_str: '4 дн. назад' }], unavailable: [], failed: [] })
    .mockResolvedValue({ histories: [{ kind: 'cleaning', count: 3, last_date: '2026-09-30', time_ago_str: 'сегодня' }], unavailable: [], failed: [] });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByText(/4 дн\. назад/)).toBeTruthy());
  const callsBefore = (databaseApi.getEquipmentWorkHistories as jest.Mock).mock.calls.length;
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-actions-open')); });
  await waitFor(() => expect(view.getByTestId('native-equipment-record-work-cleaning')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-record-work-cleaning')); });
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-action-confirm')); });
  await waitFor(() => expect(databaseApi.recordEquipmentWork).toHaveBeenCalledWith(expect.objectContaining({ kind: 'cleaning' })));
  await waitFor(() => expect((databaseApi.getEquipmentWorkHistories as jest.Mock).mock.calls.length).toBeGreaterThan(callsBefore));
  await act(async () => { fireEvent.press(view.getByLabelText('Закрыть операцию')); });
  await waitFor(() => expect(view.getByText(/сегодня/)).toBeTruthy());
  const saved = persisted as { equipment?: { description?: string }; workHistory?: Array<{ time_ago_str?: string }> } | null;
  expect(saved?.equipment?.description).toBe('Новое описание');
  expect(saved?.workHistory?.[0]?.time_ago_str).toBe('сегодня');
});

it('does not reload work history after a transfer from the bottom bar', async () => {
  mockPermissions = ['database.read', 'database.write'];
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByText(/4 дн\. назад/)).toBeTruthy());
  const callsBefore = (databaseApi.getEquipmentWorkHistories as jest.Mock).mock.calls.length;
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-actions-open')); });
  await waitFor(() => expect(view.getByTestId('native-equipment-transfer-owner')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-transfer-owner')); });
  await waitFor(() => expect(view.getByTestId('native-transfer-employee')).toBeTruthy());
  await fillEmployeeManually(view, 'Петров П.П.');
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-action-confirm')); });
  await waitFor(() => expect(databaseApi.submitEquipmentTransfer).toHaveBeenCalledWith(
    'owner',
    expect.objectContaining({ inv_nos: ['INV-1'], new_employee: 'Петров П.П.' }),
    'ITINVENT',
  ));
  await waitFor(() => expect(databaseApi.getEquipment).toHaveBeenCalledTimes(2));
  expect((databaseApi.getEquipmentWorkHistories as jest.Mock).mock.calls.length).toBe(callsBefore);
});

it('does not block an unrelated edit when the stored IP is already invalid', async () => {
  mockPermissions = ['database.read', 'database.write'];
  params.mockReturnValue({ invNo: 'INV-1', databaseId: 'ITINVENT' });
  (databaseApi.getEquipment as jest.Mock).mockResolvedValue({ ...equipment, ip_address: 'DHCP, 10.0.0.7' });
  (databaseApi.listEquipmentStatuses as jest.Mock).mockResolvedValue([{ status_no: 9, status_name: 'На складе' }]);
  const view = await render(<NativeEquipmentDetailScreen />);
  await waitFor(() => expect(view.getByText('Инв. № INV-1')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-edit')); });
  await waitFor(() => expect(view.getByTestId('native-equipment-edit-pick-status')).toBeTruthy());
  expect(view.queryByText(/IP-адрес: четыре числа/)).toBeNull();
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-edit-pick-status')); });
  await waitFor(() => expect(view.getByTestId('native-equipment-picker-option-9')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-picker-option-9')); });
  await act(async () => { fireEvent.press(view.getByTestId('native-equipment-edit-save')); });
  await waitFor(() => expect(databaseApi.updateEquipment).toHaveBeenCalledWith(
    'INV-1',
    expect.objectContaining({ status_no: 9 }),
    'ITINVENT',
  ));
});

it('opens the QR scanner once when the database screen is opened with scan=1', async () => {
  params.mockReturnValue({ scan: '1' });
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-qr-camera')).toBeTruthy());
  await waitFor(() => expect(router.setParams).toHaveBeenCalledWith({ scan: undefined }));
});

it('does not open the QR scanner from scan=1 without database.read', async () => {
  mockPermissions = [];
  params.mockReturnValue({ scan: '1' });
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByText('Нет доступа')).toBeTruthy());
  expect(view.queryByTestId('native-database-qr-camera')).toBeNull();
});

const scanQr = async (view: Awaited<ReturnType<typeof render>>, data: string) => {
  mockQrScanData = data;
  await act(async () => { fireEvent.press(view.getByTestId('native-database-qr-camera')); });
};

it('keeps the smart scanner open after the first QR and opens the card from the scan card', async () => {
  mockPermissions = ['database.read', 'database.write'];
  (databaseApi.getEquipment as jest.Mock).mockImplementation((invNo: string) => Promise.resolve({ ...equipment, inv_no: invNo }));
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-scan-qr')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });
  await waitFor(() => expect(view.getByTestId('native-database-qr-camera')).toBeTruthy());

  await scanQr(view, 'INV_NO: INV-1');
  await waitFor(() => expect(view.getByTestId('native-scan-batch-card')).toBeTruthy());
  expect(view.getByTestId('native-scan-batch-open')).toBeTruthy();
  expect(view.getByTestId('native-scan-batch-more')).toBeTruthy();
  expect(view.getByTestId('native-database-qr-camera')).toBeTruthy();

  await act(async () => { fireEvent.press(view.getByTestId('native-scan-batch-open')); });
  await waitFor(() => expect(router.push).toHaveBeenCalledWith({
    pathname: '/(shell)/database/[invNo]',
    params: { invNo: 'INV-1', databaseId: 'ITINVENT', tab: 'general' },
  }));
});

it('collects two different QRs and submits both inv_nos through the shared transfer actions', async () => {
  mockPermissions = ['database.read', 'database.write'];
  (databaseApi.getEquipment as jest.Mock).mockImplementation((invNo: string) => Promise.resolve({ ...equipment, inv_no: invNo }));
  (databaseApi.submitEquipmentTransfer as jest.Mock).mockResolvedValue({
    ...transferResultWithAct,
    success_count: 2,
    acts: [{ act_id: 'act-9', old_employee: 'Иванов И.И.', new_employee: 'Петров П.П.', equipment_count: 2, file_name: 'act-9.pdf', file_type: 'pdf' }],
  });
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-scan-qr')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });
  await waitFor(() => expect(view.getByTestId('native-database-qr-camera')).toBeTruthy());

  await scanQr(view, 'INV_NO: INV-1');
  await waitFor(() => expect(view.getByTestId('native-scan-batch-card')).toBeTruthy());
  await scanQr(view, 'https://hubit.zsgp.ru/database?inv_no=INV-2&db_id=ITINVENT');
  await waitFor(() => expect(view.getByText('Выбрано: 2')).toBeTruthy());
  expect(view.getByTestId('native-scan-batch-actions').props.accessibilityLabel).toBe('Действия для 2 позиций');

  await act(async () => { fireEvent.press(view.getByTestId('native-scan-batch-actions')); });
  await waitFor(() => expect(view.getByTestId('native-database-scan-batch')).toBeTruthy());
  expect(view.queryByTestId('native-database-qr-camera')).toBeNull();
  expect(view.getByTestId('native-database-scan-batch-row-INV-1')).toBeTruthy();
  expect(view.getByTestId('native-database-scan-batch-row-INV-2')).toBeTruthy();

  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-batch-transfer-owner')); });
  await waitFor(() => expect(view.getByTestId('native-transfer-employee')).toBeTruthy());
  await fillEmployeeManually(view, 'Петров П.П.');
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-batch-action-confirm')); });
  await waitFor(() => expect(databaseApi.submitEquipmentTransfer).toHaveBeenCalledWith(
    'owner',
    expect.objectContaining({ inv_nos: ['INV-2', 'INV-1'], new_employee: 'Петров П.П.', operation_id: expect.any(String) }),
    'ITINVENT',
  ));
  // Панель и результат остаются видимыми до явного закрытия.
  await waitFor(() => expect(view.getByTestId('native-transfer-act-act-9')).toBeTruthy());
  expect(view.getByTestId('native-transfer-email-send')).toBeTruthy();
  expect(view.getByTestId('native-database-scan-batch')).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByText('Готово')); });
  await waitFor(() => expect(view.queryByTestId('native-database-scan-batch')).toBeNull());
});

it('does not duplicate a repeated QR, highlights it and removes rows via ✕', async () => {
  mockPermissions = ['database.read', 'database.write'];
  (databaseApi.getEquipment as jest.Mock).mockImplementation((invNo: string) => Promise.resolve({ ...equipment, inv_no: invNo }));
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-scan-qr')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });

  await scanQr(view, 'INV_NO: INV-1');
  await scanQr(view, 'INV_NO: INV-2');
  await waitFor(() => expect(view.getByText('Выбрано: 2')).toBeTruthy());

  await scanQr(view, 'https://hubit.zsgp.ru/database?inv_no=INV-2&db_id=ITINVENT');
  await waitFor(() => expect(view.getByTestId('native-toast')).toBeTruthy());
  expect(view.getByTestId('native-toast').props.children).toBe('Уже в списке');
  expect(view.getByText('Выбрано: 2')).toBeTruthy();

  await act(async () => { fireEvent.press(view.getByTestId('native-scan-batch-remove-INV-2')); });
  await waitFor(() => expect(view.getByTestId('native-scan-batch-card')).toBeTruthy());
});

it('opens the consumable card and resets a one-item batch on a consumable QR (Ш5-7)', async () => {
  mockPermissions = ['database.read', 'database.write'];
  (databaseApi.getEquipment as jest.Mock).mockImplementation((invNo: string) => Promise.resolve({ ...equipment, inv_no: invNo }));
  (databaseApi.getConsumableById as jest.Mock).mockResolvedValue({
    id: 4821, inv_no: 'C-4821', type_name: 'Картридж', model_name: 'HP 12A', qty: 2,
    branch_name: 'Склад', location_name: '', part_no: '', description: '', raw: {},
  });
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-scan-qr')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });
  await scanQr(view, 'INV_NO: INV-1');
  await waitFor(() => expect(view.getByTestId('native-scan-batch-card')).toBeTruthy());

  await scanQr(view, 'https://hubit.zsgp.ru/database?consumable=4821&db_id=ITINVENT');
  await waitFor(() => expect(databaseApi.getConsumableById).toHaveBeenCalledWith(4821, 'ITINVENT'));
  await waitFor(() => expect(view.queryByTestId('native-database-qr-camera')).toBeNull());
  await waitFor(() => expect(view.getByText('HP 12A')).toBeTruthy());
  expect(view.queryByTestId('native-scan-batch-card')).toBeNull();
});

it('asks «Открыть расходник?» over a 2+ item batch; «Отмена» keeps the list (Ш5-7)', async () => {
  mockPermissions = ['database.read', 'database.write'];
  (databaseApi.getEquipment as jest.Mock).mockImplementation((invNo: string) => Promise.resolve({ ...equipment, inv_no: invNo }));
  (databaseApi.getConsumableById as jest.Mock).mockResolvedValue({
    id: 4821, inv_no: 'C-4821', type_name: 'Картридж', model_name: 'HP 12A', qty: 2,
    branch_name: 'Склад', location_name: '', part_no: '', description: '', raw: {},
  });
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-scan-qr')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });
  await scanQr(view, 'INV_NO: INV-1');
  await scanQr(view, 'INV_NO: INV-2');
  await waitFor(() => expect(view.getByText('Выбрано: 2')).toBeTruthy());

  await scanQr(view, 'https://hubit.zsgp.ru/database?consumable=4821&db_id=ITINVENT');
  expect(alertSpy).toHaveBeenCalledWith(
    'Список из 2 позиций сбросится. Открыть расходник?',
    undefined,
    expect.arrayContaining([
      expect.objectContaining({ text: 'Отмена' }),
      expect.objectContaining({ text: 'Открыть' }),
    ]),
    expect.objectContaining({ onDismiss: expect.any(Function) }),
  );
  // Пока вопрос висит — сканер и список на месте, карточка не открыта.
  expect(view.getByTestId('native-database-qr-camera')).toBeTruthy();
  expect(view.getByText('Выбрано: 2')).toBeTruthy();
  expect(databaseApi.getConsumableById).not.toHaveBeenCalled();

  const buttons = alertSpy.mock.calls.at(-1)?.[2] as Array<{ text: string; onPress?: () => void }>;
  await act(async () => { buttons.find((button) => button.text === 'Открыть')?.onPress?.(); });
  await waitFor(() => expect(databaseApi.getConsumableById).toHaveBeenCalledWith(4821, 'ITINVENT'));
  await waitFor(() => expect(view.queryByTestId('native-database-qr-camera')).toBeNull());
  expect(view.queryByText('Выбрано: 2')).toBeNull();
  alertSpy.mockRestore();
});

it('ignores repeated consumable scans while «Открыть расходник?» is open (Ш5-11)', async () => {
  mockPermissions = ['database.read', 'database.write'];
  (databaseApi.getEquipment as jest.Mock).mockImplementation((invNo: string) => Promise.resolve({ ...equipment, inv_no: invNo }));
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-scan-qr')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });
  await scanQr(view, 'INV_NO: INV-1');
  await scanQr(view, 'INV_NO: INV-2');
  await waitFor(() => expect(view.getByText('Выбрано: 2')).toBeTruthy());

  // Карточка расходника остаётся в кадре — повторный скан не должен плодить Alert.
  await scanQr(view, 'https://hubit.zsgp.ru/database?consumable=4821&db_id=ITINVENT');
  await scanQr(view, 'https://hubit.zsgp.ru/database?consumable=4822&db_id=ITINVENT');
  expect(alertSpy).toHaveBeenCalledTimes(1);
  expect(databaseApi.getConsumableById).not.toHaveBeenCalled();
  expect(view.getByText('Выбрано: 2')).toBeTruthy();

  // «Отмена» сбрасывает блокировку — следующий скан снова задаёт вопрос.
  const buttons = alertSpy.mock.calls.at(-1)?.[2] as Array<{ text: string; onPress?: () => void }>;
  await act(async () => { buttons.find((button) => button.text === 'Отмена')?.onPress?.(); });
  await scanQr(view, 'https://hubit.zsgp.ru/database?consumable=4823&db_id=ITINVENT');
  expect(alertSpy).toHaveBeenCalledTimes(2);
  alertSpy.mockRestore();
});

it('still rejects equipment from a foreign database while the batch list is non-empty', async () => {
  mockPermissions = ['database.read', 'database.write'];
  (databaseApi.getEquipment as jest.Mock).mockImplementation((invNo: string) => Promise.resolve({ ...equipment, inv_no: invNo }));
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-scan-qr')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });
  await scanQr(view, 'INV_NO: INV-1');
  await waitFor(() => expect(view.getByTestId('native-scan-batch-card')).toBeTruthy());

  await scanQr(view, 'https://hubit.zsgp.ru/database?inv_no=INV-9&db_id=OBJ-ITINVENT');
  await waitFor(() => expect(view.getByTestId('native-toast')).toBeTruthy());
  expect(view.getByTestId('native-toast').props.children).toBe('Другая база: OBJ-ITINVENT. Список собирается по одной базе');
  expect(databaseApi.getEquipment).not.toHaveBeenCalledWith('INV-9', 'OBJ-ITINVENT');
});

it('marks unresolved scans as Не найдено and keeps them out of Действия', async () => {
  mockPermissions = ['database.read', 'database.write'];
  (databaseApi.getEquipment as jest.Mock).mockImplementation((invNo: string) => (
    invNo === 'INV-404'
      ? Promise.reject({ response: { status: 404 }, isAxiosError: true })
      : Promise.resolve({ ...equipment, inv_no: invNo })
  ));
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-scan-qr')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });

  await scanQr(view, 'INV_NO: INV-1');
  await scanQr(view, 'INV_NO: INV-404');
  await waitFor(() => expect(view.getByText('Выбрано: 2')).toBeTruthy());
  expect(view.getByText('Не найдено')).toBeTruthy();
  expect(view.getByTestId('native-scan-batch-actions').props.accessibilityLabel).toBe('Действия для 1 позиций');
});

it('enforces the 100 item limit with a toast', async () => {
  mockPermissions = ['database.read', 'database.write'];
  (databaseApi.getEquipment as jest.Mock).mockImplementation((invNo: string) => Promise.resolve({ ...equipment, inv_no: invNo }));
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-scan-qr')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });

  for (let index = 0; index < 100; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await scanQr(view, `INV_NO: LIM-${index}`);
  }
  await waitFor(() => expect(view.getByText('Выбрано: 100')).toBeTruthy());

  await scanQr(view, 'INV_NO: LIM-over');
  await waitFor(() => expect(view.getByTestId('native-toast')).toBeTruthy());
  expect(view.getByTestId('native-toast').props.children).toBe('Не больше 100 за раз');
}, 60_000);

it('adds offline rows from snapshots and disables Действия without network', async () => {
  mockPermissions = ['database.read', 'database.write'];
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
      equipment: [equipment, { ...equipment, inv_no: 'INV-2' }], consumables: [], acts: [], total: 2, page: 1, pages: 1,
    },
  });
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-scan-qr')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });

  await scanQr(view, 'INV_NO: INV-1');
  await scanQr(view, 'INV_NO: INV-2');
  await waitFor(() => expect(view.getByText('Выбрано: 2')).toBeTruthy());
  expect(databaseApi.getEquipment).not.toHaveBeenCalled();
  expect(view.getByText('Нужна сеть')).toBeTruthy();
  expect(view.getByTestId('native-scan-batch-actions').props.accessibilityState?.disabled).toBe(true);
});

it('keeps the legacy single-scan behavior without database.write', async () => {
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-scan-qr')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });
  await waitFor(() => expect(view.getByTestId('native-database-qr-camera')).toBeTruthy());
  await scanQr(view, 'INV_NO: INV-1');
  await waitFor(() => expect(router.push).toHaveBeenCalledWith({
    pathname: '/(shell)/database/[invNo]',
    params: { invNo: 'INV-1', databaseId: 'ITINVENT', tab: 'general' },
  }));
  expect(view.queryByTestId('native-scan-batch-card')).toBeNull();
  expect(view.queryByTestId('native-database-scan-batch')).toBeNull();
});

it('keeps only retry_inv_nos after a partial batch transfer error', async () => {
  mockPermissions = ['database.read', 'database.write'];
  (databaseApi.getEquipment as jest.Mock).mockImplementation((invNo: string) => Promise.resolve({ ...equipment, inv_no: invNo }));
  (databaseApi.submitEquipmentTransfer as jest.Mock).mockResolvedValue({
    success_count: 1,
    failed_count: 1,
    failed: [{ inv_no: 'INV-1', error: 'Ошибка сервера' }],
    retry_inv_nos: ['INV-1'],
    acts: [],
    job_status: 'done',
  });
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-scan-qr')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });
  await scanQr(view, 'INV_NO: INV-1');
  await scanQr(view, 'INV_NO: INV-2');
  await waitFor(() => expect(view.getByText('Выбрано: 2')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-scan-batch-actions')); });
  await waitFor(() => expect(view.getByTestId('native-database-scan-batch')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-batch-transfer-owner')); });
  await fillEmployeeManually(view, 'Петров П.П.');
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-batch-action-confirm')); });
  await waitFor(() => expect(view.getByText('Перемещено: 1, ошибок: 1')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByText('Готово')); });
  await waitFor(() => expect(view.queryByTestId('native-database-scan-batch-row-INV-2')).toBeNull());
  expect(view.getByTestId('native-database-scan-batch-row-INV-1')).toBeTruthy();
});

it('does not restore a saved batch after the screen remounts (Ш5-8)', async () => {
  mockPermissions = ['database.read', 'database.write'];
  (databaseApi.getEquipment as jest.Mock).mockImplementation((invNo: string) => Promise.resolve({ ...equipment, inv_no: invNo }));
  (snapshotCache.readNativeEntitySnapshot as jest.Mock).mockImplementation(
    async (_scope: string, _userId: number, key: string) => (
      key === 'scan-batch:ITINVENT'
        ? { savedAt: 1, data: { items: [{ invNo: 'INV-7', databaseId: 'ITINVENT', equipment, status: 'ready' }] } }
        : null
    ),
  );
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-scan-qr')).toBeTruthy());
  expect(view.queryByTestId('native-database-scan-batch-open')).toBeNull();
  expect(view.queryByText(/INV-7/)).toBeNull();

  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });
  await waitFor(() => expect(view.getByTestId('native-database-qr-camera')).toBeTruthy());
  expect(view.queryByTestId('native-scan-batch-card')).toBeNull();

  await scanQr(view, 'INV_NO: INV-9');
  await waitFor(() => expect(view.getByTestId('native-scan-batch-card')).toBeTruthy());
  expect(view.getByText(/Инв\. № INV-9/)).toBeTruthy();
  expect(view.queryByText(/INV-7/)).toBeNull();
});

it('closes the scanner with one item without asking and resets the list (Ш5-8)', async () => {
  mockPermissions = ['database.read', 'database.write'];
  (databaseApi.getEquipment as jest.Mock).mockImplementation((invNo: string) => Promise.resolve({ ...equipment, inv_no: invNo }));
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-scan-qr')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });
  await scanQr(view, 'INV_NO: INV-1');
  await waitFor(() => expect(view.getByTestId('native-scan-batch-card')).toBeTruthy());

  await act(async () => { fireEvent.press(view.getByLabelText('Закрыть сканер QR-кода')); });
  expect(alertSpy).not.toHaveBeenCalled();
  await waitFor(() => expect(view.queryByTestId('native-database-qr-camera')).toBeNull());
  expect(view.queryByText('Выбрано: 1')).toBeNull();

  // Повторное открытие — пустой список, новый QR становится первой позицией.
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });
  await waitFor(() => expect(view.getByTestId('native-database-qr-camera')).toBeTruthy());
  expect(view.queryByTestId('native-scan-batch-card')).toBeNull();
  await scanQr(view, 'INV_NO: INV-5');
  await waitFor(() => expect(view.getByTestId('native-scan-batch-card')).toBeTruthy());
  expect(view.getByText(/Инв\. № INV-5/)).toBeTruthy();
  expect(view.queryByText(/INV-1/)).toBeNull();
  alertSpy.mockRestore();
});

it('asks before closing the scanner with 2+ items and «Закрыть» resets the list (Ш5-8)', async () => {
  mockPermissions = ['database.read', 'database.write'];
  (databaseApi.getEquipment as jest.Mock).mockImplementation((invNo: string) => Promise.resolve({ ...equipment, inv_no: invNo }));
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-scan-qr')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });
  await scanQr(view, 'INV_NO: INV-1');
  await scanQr(view, 'INV_NO: INV-2');
  await waitFor(() => expect(view.getByText('Выбрано: 2')).toBeTruthy());

  await act(async () => { fireEvent.press(view.getByLabelText('Закрыть сканер QR-кода')); });
  expect(alertSpy).toHaveBeenCalledWith(
    'Список из 2 позиций сбросится. Закрыть?',
    undefined,
    expect.arrayContaining([
      expect.objectContaining({ text: 'Отмена' }),
      expect.objectContaining({ text: 'Закрыть' }),
    ]),
  );
  // Пока вопрос висит — сканер и список на месте.
  expect(view.getByTestId('native-database-qr-camera')).toBeTruthy();
  expect(view.getByText('Выбрано: 2')).toBeTruthy();

  const buttons = alertSpy.mock.calls.at(-1)?.[2] as Array<{ text: string; onPress?: () => void }>;
  await act(async () => { buttons.find((button) => button.text === 'Закрыть')?.onPress?.(); });
  await waitFor(() => expect(view.queryByTestId('native-database-qr-camera')).toBeNull());
  expect(view.queryByText('Выбрано: 2')).toBeNull();

  // Повторное открытие начинается с пустого списка.
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });
  await waitFor(() => expect(view.getByTestId('native-database-qr-camera')).toBeTruthy());
  expect(view.queryByTestId('native-scan-batch-list')).toBeNull();
  alertSpy.mockRestore();
});

it('shows scanner toasts inside the open modal and does not duplicate them after close (Ш5-7)', async () => {
  mockPermissions = ['database.read', 'database.write'];
  (databaseApi.getEquipment as jest.Mock).mockImplementation((invNo: string) => Promise.resolve({ ...equipment, inv_no: invNo }));
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-scan-qr')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });
  await scanQr(view, 'INV_NO: INV-1');
  await waitFor(() => expect(view.getByTestId('native-scan-batch-card')).toBeTruthy());

  // Тот же инв. номер через другой QR — дубль по списку, а не по dedup-карте кадров.
  await scanQr(view, 'https://hubit.zsgp.ru/database?inv_no=INV-1&db_id=ITINVENT');
  await waitFor(() => expect(view.getByTestId('native-toast')).toBeTruthy());
  const scannerModal = view.getByTestId('native-qr-scanner-modal');
  expect(within(scannerModal).getByTestId('native-toast').props.children).toBe('Уже в списке');
  // Внешний хост заглушён — тост в дереве ровно один.
  expect(view.getAllByTestId('native-toast')).toHaveLength(1);

  await act(async () => { fireEvent.press(view.getByLabelText('Закрыть сканер QR-кода')); });
  await waitFor(() => expect(view.queryByTestId('native-database-qr-camera')).toBeNull());
  expect(view.queryByTestId('native-toast')).toBeNull();
});

it('«Отменить» on the batch panel resets the list, asking first at 2+ items (Ш5-8)', async () => {
  mockPermissions = ['database.read', 'database.write'];
  (databaseApi.getEquipment as jest.Mock).mockImplementation((invNo: string) => Promise.resolve({ ...equipment, inv_no: invNo }));
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-scan-qr')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });
  await scanQr(view, 'INV_NO: INV-1');
  await scanQr(view, 'INV_NO: INV-2');
  await waitFor(() => expect(view.getByText('Выбрано: 2')).toBeTruthy());

  // «Действия (N)» закрывает сканер и открывает панель, список не сбрасывается.
  await act(async () => { fireEvent.press(view.getByTestId('native-scan-batch-actions')); });
  await waitFor(() => expect(view.getByTestId('native-database-scan-batch')).toBeTruthy());
  expect(view.getByTestId('native-database-scan-batch-row-INV-1')).toBeTruthy();

  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-batch-cancel')); });
  expect(alertSpy).toHaveBeenCalledWith(
    'Список из 2 позиций сбросится. Отменить?',
    undefined,
    expect.arrayContaining([expect.objectContaining({ text: 'Отменить' })]),
  );
  expect(view.getByTestId('native-database-scan-batch-row-INV-1')).toBeTruthy();

  const buttons = alertSpy.mock.calls.at(-1)?.[2] as Array<{ text: string; onPress?: () => void }>;
  await act(async () => { buttons.find((button) => button.text === 'Отменить')?.onPress?.(); });
  await waitFor(() => expect(view.queryByTestId('native-database-scan-batch')).toBeNull());

  // Список пуст — новое открытие сканера начинается с нуля.
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });
  await waitFor(() => expect(view.getByTestId('native-database-qr-camera')).toBeTruthy());
  expect(view.queryByTestId('native-scan-batch-list')).toBeNull();
  alertSpy.mockRestore();
});

it('clears the leftover batch when the scanner reopens via scan=1 (Ш5-8)', async () => {
  mockPermissions = ['database.read', 'database.write'];
  (databaseApi.getEquipment as jest.Mock).mockImplementation((invNo: string) => Promise.resolve({ ...equipment, inv_no: invNo }));
  params.mockReturnValue({ scan: '1' });
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-qr-camera')).toBeTruthy());

  await scanQr(view, 'INV_NO: INV-1');
  await scanQr(view, 'INV_NO: INV-2');
  await waitFor(() => expect(view.getByText('Выбрано: 2')).toBeTruthy());
  // «Действия» закрывает сканер и открывает панель — список нарочно сохраняется.
  await act(async () => { fireEvent.press(view.getByTestId('native-scan-batch-actions')); });
  await waitFor(() => expect(view.getByTestId('native-database-scan-batch')).toBeTruthy());

  params.mockReturnValue({});
  await act(async () => { view.rerender(<NativeDatabaseScreen />); });
  params.mockReturnValue({ scan: '1' });
  await act(async () => { view.rerender(<NativeDatabaseScreen />); });

  await waitFor(() => expect(view.getByTestId('native-database-qr-camera')).toBeTruthy());
  expect(view.queryByTestId('native-scan-batch-list')).toBeNull();
  expect(view.queryByTestId('native-database-scan-batch')).toBeNull();
  await scanQr(view, 'INV_NO: INV-6');
  await waitFor(() => expect(view.getByTestId('native-scan-batch-card')).toBeTruthy());
  expect(view.getByText(/Инв\. № INV-6/)).toBeTruthy();
});

it('adds the bottom nav inset to the selection and scan batch panels (Ш5-6)', async () => {
  mockPermissions = ['database.read', 'database.write'];
  (databaseApi.getEquipment as jest.Mock).mockImplementation((invNo: string) => Promise.resolve({ ...equipment, inv_no: invNo }));
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByText('OptiPlex')).toBeTruthy());

  await act(async () => { fireEvent(view.getByTestId('native-equipment-INV-1'), 'longPress'); });
  await waitFor(() => expect(view.getByTestId('native-database-selection')).toBeTruthy());
  // inset = bottomNavMetrics(fontScale).contentHeight (≥72) + max(insets.bottom, 9)
  const selectionPadding = StyleSheet.flatten(view.getByTestId('native-database-selection').props.style)?.paddingBottom ?? 0;
  expect(selectionPadding).toBeGreaterThanOrEqual(66);

  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });
  await scanQr(view, 'INV_NO: INV-8');
  await scanQr(view, 'INV_NO: INV-9');
  await waitFor(() => expect(view.getByText('Выбрано: 2')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-scan-batch-actions')); });
  await waitFor(() => expect(view.getByTestId('native-database-scan-batch')).toBeTruthy());
  const batchPadding = StyleSheet.flatten(view.getByTestId('native-database-scan-batch').props.style)?.paddingBottom ?? 0;
  expect(batchPadding).toBeGreaterThanOrEqual(66);
});

it('reopens the scanner when scan=1 arrives again on the same mounted screen (Ш4-1)', async () => {
  params.mockReturnValue({ scan: '1' });
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-qr-camera')).toBeTruthy());

  await act(async () => { fireEvent.press(view.getByLabelText('Закрыть сканер QR-кода')); });
  await waitFor(() => expect(view.queryByTestId('native-database-qr-camera')).toBeNull());

  // the app consumed the param, then the launcher delivers scan=1 again
  params.mockReturnValue({});
  await act(async () => { view.rerender(<NativeDatabaseScreen />); });
  params.mockReturnValue({ scan: '1' });
  await act(async () => { view.rerender(<NativeDatabaseScreen />); });
  await waitFor(() => expect(view.getByTestId('native-database-qr-camera')).toBeTruthy());
  await waitFor(() => expect(router.setParams).toHaveBeenCalledWith({ scan: undefined }));
});

it('shows «Не найдено» for an online 404 scan and keeps the row visible (Ш5-1)', async () => {
  mockPermissions = ['database.read', 'database.write'];
  (databaseApi.getEquipment as jest.Mock).mockRejectedValue({ response: { status: 404 }, isAxiosError: true });
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-scan-qr')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });
  await waitFor(() => expect(view.getByTestId('native-database-qr-camera')).toBeTruthy());

  await scanQr(view, 'INV_NO: INV-404');
  await waitFor(() => expect(view.getByTestId('native-scan-batch-card')).toBeTruthy());
  expect(view.getByText('Не найдено')).toBeTruthy();
});

it('does not add a row on network failure and adds it when the same code is rescanned (Ш5-1)', async () => {
  mockPermissions = ['database.read', 'database.write'];
  (databaseApi.getEquipment as jest.Mock)
    .mockRejectedValueOnce({ code: 'ERR_NETWORK', isAxiosError: true })
    .mockImplementation(async (invNo: string) => ({ ...equipment, inv_no: invNo }));
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-scan-qr')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });
  await waitFor(() => expect(view.getByTestId('native-database-qr-camera')).toBeTruthy());

  const nowSpy = jest.spyOn(Date, 'now');
  try {
    let now = 1_000_000;
    nowSpy.mockImplementation(() => now);
    await scanQr(view, 'INV_NO: INV-ERR');
    await waitFor(() => expect(view.getByTestId('native-toast').props.children).toBe('Нет связи с сервером — отсканируйте ещё раз'));
    expect(view.queryByTestId('native-scan-batch-card')).toBeNull();
    expect(view.queryByText('INV-ERR')).toBeNull();

    now += 2_000;
    await scanQr(view, 'INV_NO: INV-ERR');
    await waitFor(() => expect(view.getByTestId('native-scan-batch-card')).toBeTruthy());
  } finally {
    nowSpy.mockRestore();
  }
});

it('clears the batch when «Открыть» is used on the single-item card (Ш5-3)', async () => {
  mockPermissions = ['database.read', 'database.write'];
  (databaseApi.getEquipment as jest.Mock).mockImplementation((invNo: string) => Promise.resolve({ ...equipment, inv_no: invNo }));
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-scan-qr')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });
  await scanQr(view, 'INV_NO: INV-1');
  await waitFor(() => expect(view.getByTestId('native-scan-batch-card')).toBeTruthy());

  await act(async () => { fireEvent.press(view.getByTestId('native-scan-batch-open')); });
  await waitFor(() => expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/(shell)/database/[invNo]' })));
  await waitFor(() => expect(view.queryByTestId('native-database-qr-camera')).toBeNull());
  expect(view.queryByText('Выбрано: 1')).toBeNull();

  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });
  await waitFor(() => expect(view.getByTestId('native-database-qr-camera')).toBeTruthy());
  expect(view.queryByTestId('native-scan-batch-card')).toBeNull();
});

it('fires each code at most once while two labels alternate in frame (Ш5-4)', async () => {
  mockPermissions = ['database.read', 'database.write'];
  (databaseApi.getEquipment as jest.Mock).mockImplementation((invNo: string) => Promise.resolve({ ...equipment, inv_no: invNo }));
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByTestId('native-database-scan-qr')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('native-database-scan-qr')); });
  await waitFor(() => expect(view.getByTestId('native-database-qr-camera')).toBeTruthy());

  await scanQr(view, 'INV_NO: INV-1');
  await scanQr(view, 'INV_NO: INV-2');
  await scanQr(view, 'INV_NO: INV-1');
  await scanQr(view, 'INV_NO: INV-2');
  await waitFor(() => expect(view.getByText('Выбрано: 2')).toBeTruthy());
  expect(view.queryByText('Уже в списке')).toBeNull();
});
