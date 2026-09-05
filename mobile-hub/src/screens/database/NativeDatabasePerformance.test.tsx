import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as databaseApi from '../../api/databaseApi';
import type { ConsumableRecord, EquipmentAct, EquipmentRecord } from '../../api/databaseApi';
import { NativeDatabaseScreen } from './NativeDatabaseScreen';

const mockEquipmentRowRender = jest.fn();
const mockConsumableRowRender = jest.fn();
const mockActCardRender = jest.fn();
let mockParams: { mode?: string } = {};
let mockPermissions = ['database.read'];

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 17, role: 'user' },
    offlineMode: false,
    hasPermission: (permission: string) => mockPermissions.includes(permission),
  }),
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'dark' } }),
}));

jest.mock('../../api/databaseApi', () => ({
  deleteConsumable: jest.fn(),
  getCurrentDatabase: jest.fn(),
  listAvailableDatabases: jest.fn(),
  listConsumables: jest.fn(),
  listEquipment: jest.fn(),
  listRecentEquipmentActs: jest.fn(),
  listRecentEquipmentCards: jest.fn(),
  searchEquipment: jest.fn(),
  searchEquipmentActs: jest.fn(),
  switchDatabase: jest.fn(),
  touchRecentEquipmentAct: jest.fn(),
  touchRecentEquipmentCard: jest.fn(),
  updateConsumableQuantity: jest.fn(),
}));

jest.mock('../../cache/nativeSnapshotCache', () => ({
  readNativeCollectionSnapshot: jest.fn(async () => null),
  readNativeSnapshot: jest.fn(async () => null),
  writeNativeCollectionSnapshot: jest.fn(async () => undefined),
  writeNativeSnapshot: jest.fn(async () => undefined),
}));

jest.mock('../../components/database/NativeEquipmentRow', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    NativeEquipmentRow: React.memo(({ item }: { item: { inv_no: string; model_name: string } }) => {
      mockEquipmentRowRender(item.inv_no);
      return React.createElement(Text, null, item.model_name);
    }),
  };
});

jest.mock('../../components/database/NativeConsumableRow', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    NativeConsumableRow: React.memo(({ item }: { item: { id: number; model_name: string } }) => {
      mockConsumableRowRender(item.id);
      return React.createElement(Text, null, item.model_name);
    }),
  };
});

jest.mock('../../components/database/NativeEquipmentActCard', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    NativeEquipmentActCard: React.memo(({ act }: { act: { doc_no: number; doc_number: string } }) => {
      mockActCardRender(act.doc_no);
      return React.createElement(Text, null, act.doc_number);
    }),
  };
});
jest.mock('../../components/database/NativeEquipmentActions', () => ({ NativeEquipmentActions: () => null }));
jest.mock('../../components/database/NativeDatabaseCreateModal', () => ({ NativeDatabaseCreateModal: () => null }));
jest.mock('../../components/database/NativeDatabaseActUploadModal', () => ({ NativeDatabaseActUploadModal: () => null }));
jest.mock('../../components/database/NativeDatabaseQrScannerModal', () => ({ NativeDatabaseQrScannerModal: () => null }));

const equipment: EquipmentRecord[] = Array.from({ length: 30 }, (_, index) => ({
  inv_no: `INV-${index}`,
  serial_no: `SN-${index}`,
  hw_serial_no: '',
  part_no: '',
  type_name: 'Системный блок',
  model_name: `Computer ${String(index).padStart(2, '0')}`,
  vendor_name: 'Vendor',
  status_name: 'В работе',
  employee_name: 'Иванов И.И.',
  employee_dept: 'ИТ',
  employee_email: 'ivanov@example.com',
  branch_name: 'Главный офис',
  location_name: 'Кабинет 12',
  ip_address: `10.0.0.${index + 1}`,
  mac_address: '',
  network_name: '',
  domain_name: '',
  description: '',
  hub_db_id: 'ITINVENT',
  hub_db_name: 'Основная',
  raw: {},
}));

const consumables: ConsumableRecord[] = Array.from({ length: 30 }, (_, index) => ({
  id: index + 1,
  inv_no: `CON-${index}`,
  type_name: 'Картридж',
  model_name: `Consumable ${String(index).padStart(2, '0')}`,
  qty: 3,
  branch_name: 'Главный офис',
  location_name: 'Склад',
  part_no: '',
  description: '',
  raw: {},
}));

const acts: EquipmentAct[] = Array.from({ length: 30 }, (_, index) => ({
  doc_no: index + 1,
  doc_number: `Act ${String(index).padStart(2, '0')}`,
  doc_date: '2026-09-02T10:00:00+05:00',
  type_name: 'Передача',
  branch_name: 'Главный офис',
  location_name: 'Кабинет 12',
  employee_name: 'Иванов И.И.',
  has_file: true,
  items: [{ inv_no: `INV-${index}`, serial_no: `SN-${index}`, model_name: `Computer ${index}` }],
  raw: {},
}));

const mockedApi = databaseApi as jest.Mocked<typeof databaseApi>;

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockPermissions = ['database.read'];
  mockedApi.listAvailableDatabases.mockResolvedValue([{ id: 'ITINVENT', name: 'Основная' }]);
  mockedApi.getCurrentDatabase.mockResolvedValue({ id: 'ITINVENT', name: 'Основная', locked: false });
  mockedApi.listRecentEquipmentCards.mockResolvedValue([]);
  mockedApi.listRecentEquipmentActs.mockResolvedValue([]);
  mockedApi.listEquipment.mockResolvedValue({ equipment, total: equipment.length, page: 1, pages: 1 });
  mockedApi.listConsumables.mockResolvedValue({ consumables, total: consumables.length, truncated: false });
  mockedApi.searchEquipmentActs.mockResolvedValue({ acts, total: acts.length, truncated: false });
});

it('does not rerender mounted inventory rows for a draft keystroke or refresh spinner', async () => {
  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByText('Computer 00')).toBeTruthy());
  mockEquipmentRowRender.mockClear();

  await fireEvent.changeText(view.getByTestId('native-database-search'), 'c');
  const draftTypingRenders = mockEquipmentRowRender.mock.calls.length;
  mockEquipmentRowRender.mockClear();

  mockedApi.listEquipment.mockReturnValueOnce(new Promise(() => undefined));
  await act(async () => {
    view.getByTestId('native-database-results').props.onRefresh();
  });
  const refreshSpinnerRenders = mockEquipmentRowRender.mock.calls.length;

  expect({ draftTypingRenders, refreshSpinnerRenders }).toEqual({
    draftTypingRenders: 0,
    refreshSpinnerRenders: 0,
  });
});

it('does not rerender mounted consumables for a draft keystroke or refresh spinner', async () => {
  mockParams = { mode: 'consumables' };
  mockPermissions = ['database.read', 'database.write', 'database.delete'];

  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByText('Consumable 00')).toBeTruthy());
  mockConsumableRowRender.mockClear();

  await fireEvent.changeText(view.getByTestId('native-database-search'), 'c');
  const draftTypingRenders = mockConsumableRowRender.mock.calls.length;
  mockConsumableRowRender.mockClear();

  mockedApi.listConsumables.mockReturnValueOnce(new Promise(() => undefined));
  await act(async () => {
    view.getByTestId('native-database-results').props.onRefresh();
  });
  const refreshSpinnerRenders = mockConsumableRowRender.mock.calls.length;

  expect({ draftTypingRenders, refreshSpinnerRenders }).toEqual({
    draftTypingRenders: 0,
    refreshSpinnerRenders: 0,
  });
});

it('does not rerender mounted acts for a draft keystroke or refresh spinner', async () => {
  mockParams = { mode: 'acts' };

  const view = await render(<NativeDatabaseScreen />);
  await waitFor(() => expect(view.getByText('Act 00')).toBeTruthy());
  mockActCardRender.mockClear();

  await fireEvent.changeText(view.getByTestId('native-database-search'), 'a');
  const draftTypingRenders = mockActCardRender.mock.calls.length;
  mockActCardRender.mockClear();

  mockedApi.searchEquipmentActs.mockReturnValueOnce(new Promise(() => undefined));
  await act(async () => {
    view.getByTestId('native-database-results').props.onRefresh();
  });
  const refreshSpinnerRenders = mockActCardRender.mock.calls.length;

  expect({ draftTypingRenders, refreshSpinnerRenders }).toEqual({
    draftTypingRenders: 0,
    refreshSpinnerRenders: 0,
  });
});
