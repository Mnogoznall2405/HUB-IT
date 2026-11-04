import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearSWRCache } from '../lib/swrCache';
import {
  EMPLOYEE_COMPARE_MAX_AGE_MS,
  EMPLOYEE_COMPARE_REFRESH_INTERVAL_MS,
} from './database/employeeCompareModel';

const mockApi = vi.hoisted(() => ({
  equipmentAPI: {
    getTypes: vi.fn(),
    getStatuses: vi.fn(),
    getBranchesList: vi.fn(),
    getAllEquipmentGrouped: vi.fn(),
    getAllConsumablesGrouped: vi.fn(),
    getByInvNos: vi.fn(),
    getCurrentActs: vi.fn(),
    searchUniversal: vi.fn(),
    getEquipmentHistory: vi.fn(),
    getEquipmentActs: vi.fn(),
    getRecentCards: vi.fn(),
    getRecentActs: vi.fn(),
    touchRecentCard: vi.fn(),
    removeRecentCard: vi.fn(),
    clearRecentCards: vi.fn(),
    identifyWorkspace: vi.fn(),
  },
  databaseAPI: {
    getCurrentDatabase: vi.fn(),
    getAvailableDatabases: vi.fn(),
    switchDatabase: vi.fn(),
  },
  settingsAPI: {
    getMySettings: vi.fn(),
    updateMySettings: vi.fn(),
  },
  equipmentSearchAPI: {
    searchByEmployee: vi.fn(),
    getEmployeeEquipment: vi.fn(),
  },
  warehouse1cAPI: {
    getEmployeeCompareSummary: vi.fn(),
    getEmployeeWarehouse: vi.fn(),
    getWarehouseMovements: vi.fn(),
    getMissingWarehouseHints: vi.fn(),
  },
  equipmentPhotosAPI: {
    list: vi.fn(),
    upload: vi.fn(),
    remove: vi.fn(),
    verify: vi.fn(),
    unverify: vi.fn(),
    fetchContent: vi.fn(),
  },
  equipmentOneCMarksAPI: {
    list: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(),
  },
  warehousePartNoCheckAPI: {
    check: vi.fn(),
  },
  grantedPermissions: new Set(['database.read', 'database.write']),
}));

vi.mock('../api/equipmentOneCMarks', () => ({
  equipmentOneCMarksAPI: mockApi.equipmentOneCMarksAPI,
}));

vi.mock('../api/warehousePartNoCheck', () => ({
  warehousePartNoCheckAPI: mockApi.warehousePartNoCheckAPI,
}));

vi.mock('../api/equipmentPhotos', () => ({
  equipmentPhotosAPI: mockApi.equipmentPhotosAPI,
}));

vi.mock('../api/client', () => ({
  equipmentAPI: mockApi.equipmentAPI,
  settingsAPI: mockApi.settingsAPI,
  API_V1_BASE: '/api/v1',
  UPLOADED_ACT_PARSE_TIMEOUT_MS: 180000,
}));

vi.mock('../api/database', () => ({
  databaseAPI: mockApi.databaseAPI,
}));

vi.mock('../api/equipmentSearch', () => ({
  equipmentSearchAPI: mockApi.equipmentSearchAPI,
}));

vi.mock('../api/json_client', () => ({
  default: {},
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'admin', username: 'admin' },
    hasPermission: (permission) => mockApi.grantedPermissions.has(permission),
  }),
}));

vi.mock('../api/warehouse1c', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    warehouse1cAPI: {
      ...actual.warehouse1cAPI,
      getEmployeeCompareSummary: mockApi.warehouse1cAPI.getEmployeeCompareSummary,
      getEmployeeWarehouse: mockApi.warehouse1cAPI.getEmployeeWarehouse,
      getWarehouseMovements: mockApi.warehouse1cAPI.getWarehouseMovements,
      getMissingWarehouseHints: mockApi.warehouse1cAPI.getMissingWarehouseHints,
    },
  };
});

vi.mock('../contexts/NotificationContext', () => ({
  useNotification: () => ({
    notifySuccess: vi.fn(),
    notifyInfo: vi.fn(),
    notifyWarning: vi.fn(),
    notifyError: vi.fn(),
  }),
}));

vi.mock('../components/layout/MainLayout', () => ({
  default: ({ children, headerMode = 'default', showDatabaseSelector }) => (
    <div
      data-testid="main-layout"
      data-header-mode={headerMode}
      data-show-database-selector={String(showDatabaseSelector)}
    >
      {children}
    </div>
  ),
}));

vi.mock('../components/layout/PageShell', () => ({
  default: ({ children }) => <div data-testid="page-shell">{children}</div>,
}));

vi.mock('../components/common', () => ({
  LoadingSpinner: ({ message }) => <div>{message || 'loading'}</div>,
  StatusChip: ({ children, label }) => <span>{label || children || 'status'}</span>,
  ActionMenu: ({ onAction, item }) => (
    <button type="button" onClick={() => onAction?.('view', item)}>
      actions
    </button>
  ),
}));

function installMatchMedia({ mobile = false } = {}) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: mobile
      ? query.includes('max-width:599.95px') || query.includes('(hover: none) and (pointer: coarse)')
      : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

import {
  buildUploadActInvVerification,
  buildUploadActParseErrorMessage,
  clearUploadActReminderSearch,
  default as Database,
  getUploadActReminderDeepLinkAction,
  getEquipmentRowActions,
  isApiUnavailableForActParseError,
  isUploadActProxyUnavailableError,
  isUploadActCommitDisabled,
  validateUploadActPdfFile,
  parseInvNosInput,
  parseUploadActReminderDeepLink,
  resolveDataModeRefreshBehavior,
  removeItemFromGrouped,
  UPLOAD_ACT_MAX_SIZE_MB,
} from './Database';

function renderDatabase(initialEntry = '/database') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Database />
    </MemoryRouter>,
  );
}

async function openFirstEquipmentDetail() {
  renderDatabase();

  fireEvent.click(await screen.findByText('HQ'));
  fireEvent.click(await screen.findByText('Office'));
  fireEvent.click(await screen.findByRole('row', { name: /1001/ }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Просмотр' }));

  return screen.findByRole('tab', { name: 'История перемещений' });
}

function installIntersectionObserverMock() {
  class MockIntersectionObserver {
    observe() {}

    disconnect() {}
  }

  window.IntersectionObserver = MockIntersectionObserver;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.grantedPermissions.clear();
  mockApi.grantedPermissions.add('database.read');
  mockApi.grantedPermissions.add('database.write');
  mockApi.equipmentOneCMarksAPI.list.mockResolvedValue({});
  mockApi.warehousePartNoCheckAPI.check.mockResolvedValue({ available: true, missing: [] });
  mockApi.warehouse1cAPI.getEmployeeCompareSummary.mockResolvedValue({
    meta: { status: 'ok', as_of: new Date().toISOString() },
    items: [],
  });
  mockApi.warehouse1cAPI.getEmployeeWarehouse.mockResolvedValue({
    status: 'none',
    warehouse: null,
    candidates: [],
    balances: [],
  });
  mockApi.warehouse1cAPI.getWarehouseMovements.mockResolvedValue({
    items: [],
    has_more: false,
    status: 'ok',
  });
  mockApi.warehouse1cAPI.getMissingWarehouseHints.mockResolvedValue({ items: [] });
  clearSWRCache();
  installMatchMedia({ mobile: false });
  installIntersectionObserverMock();
  localStorage.clear();
  localStorage.setItem('user', JSON.stringify({ id: 1, username: 'admin' }));

  mockApi.settingsAPI.getMySettings.mockResolvedValue({
    database_branch_filters: {},
  });
  mockApi.settingsAPI.updateMySettings.mockResolvedValue({
    database_branch_filters: {},
  });

  mockApi.databaseAPI.getCurrentDatabase.mockResolvedValue({
    id: 'main',
    name: 'Основная база',
  });
  mockApi.databaseAPI.getAvailableDatabases.mockResolvedValue([
    { id: 'main', name: 'Основная база' },
  ]);
  mockApi.databaseAPI.switchDatabase.mockImplementation(async (databaseId) => ({
    success: true,
    database: { id: databaseId, name: databaseId },
  }));
  mockApi.equipmentAPI.getTypes.mockResolvedValue([]);
  mockApi.equipmentAPI.getStatuses.mockResolvedValue([]);
  mockApi.equipmentAPI.getBranchesList.mockResolvedValue([
    { BRANCH_NO: 1, BRANCH_NAME: 'HQ' },
    { BRANCH_NO: 2, BRANCH_NAME: 'Remote' },
  ]);
  mockApi.equipmentAPI.getByInvNos.mockResolvedValue({
    equipment: [
      {
        id: 1,
        inv_no: '1001',
        serial_no: 'SN-1001',
        part_no: 'PN-1001',
        type_name: 'PC',
        model_name: 'OptiPlex',
        employee_name: 'Current Holder',
        empl_no: 42,
        branch_name: 'HQ',
        location: 'Office',
        status: 'Active',
      },
    ],
    not_found: [],
    requested: 1,
  });
  mockApi.equipmentAPI.getCurrentActs.mockResolvedValue({ items: [] });
  mockApi.equipmentPhotosAPI.list.mockResolvedValue({ photos: [] });
  mockApi.equipmentPhotosAPI.upload.mockResolvedValue({});
  mockApi.equipmentAPI.searchUniversal.mockResolvedValue({ equipment: [], total: 0, page: 1, pages: 1 });
  mockApi.equipmentAPI.getEquipmentActs.mockResolvedValue({ acts: [], total: 0 });
  mockApi.equipmentAPI.getRecentCards.mockResolvedValue({ items: [] });
  mockApi.equipmentAPI.getRecentActs.mockResolvedValue({ items: [] });
  mockApi.equipmentAPI.touchRecentCard.mockResolvedValue({
    inv_no: '1001',
    db_id: 'main',
    last_action: 'view',
    last_action_label: 'Открыта',
    last_activity_at: '2026-05-27T08:00:00+00:00',
    activity_count: 1,
    snapshot: { INV_NO: '1001', MODEL_NAME: 'OptiPlex' },
  });
  mockApi.equipmentAPI.removeRecentCard.mockResolvedValue({ removed: 1 });
  mockApi.equipmentAPI.clearRecentCards.mockResolvedValue({ removed: 1 });
  mockApi.equipmentAPI.getEquipmentHistory.mockResolvedValue({
    inv_no: '1001',
    item_id: 1,
    total: 1,
    history: [
      {
        hist_id: 3,
        ch_date: '2026-04-27T09:15:00',
        ch_user: 'web',
        ch_comment: 'handover',
        old_employee_name: 'Old Holder',
        new_employee_name: 'New Holder',
        old_branch_name: 'Old Branch',
        new_branch_name: 'HQ',
        old_location_name: 'Stock',
        new_location_name: 'Office',
      },
    ],
  });
  mockApi.equipmentAPI.identifyWorkspace.mockResolvedValue({
    success: false,
    message: 'not found',
  });
  mockApi.equipmentSearchAPI.searchByEmployee.mockResolvedValue({ employees: [] });
  mockApi.equipmentSearchAPI.getEmployeeEquipment.mockResolvedValue({
    equipment: [{
      INV_NO: '1001',
      MODEL_NAME: 'OptiPlex',
      SERIAL_NO: 'SN-1001',
      PART_NO: 'PN-1001',
    }],
  });
  mockApi.equipmentAPI.getAllEquipmentGrouped.mockImplementation(async ({ page = 1 } = {}) => {
    if (page === 1) {
      return {
    grouped: {
      HQ: {
        Office: [
          {
            ID: 1,
            INV_NO: '1001',
            SERIAL_NO: 'SN-1001',
            PART_NO: 'PN-1001',
            TYPE_NAME: 'ПК',
            MODEL_NAME: 'OptiPlex',
            EMPL_NO: 42,
            OWNER_DISPLAY_NAME: 'Иванов И.И.',
            STATUS_NAME: 'В работе',
            BRANCH_NAME: 'HQ',
            LOCATION_NAME: 'Office',
          },
        ],
      },
    },
        total: 3,
        pages: 3,
      };
    }

    if (page === 2) {
      return {
        grouped: {
          HQ: {
            Lab: [
              {
                ID: 2,
                INV_NO: '1002',
                SERIAL_NO: 'SN-1002',
                TYPE_NAME: 'РџРљ',
                MODEL_NAME: 'ThinkCentre',
                OWNER_DISPLAY_NAME: 'РџРµС‚СЂРѕРІ Рџ.Рџ.',
                STATUS_NAME: 'Р’ СЂР°Р±РѕС‚Рµ',
                BRANCH_NAME: 'HQ',
                LOCATION_NAME: 'Lab',
              },
            ],
          },
        },
        total: 3,
        pages: 3,
      };
    }

    return {
      grouped: {
        Remote: {
          Desk: [
            {
              ID: 3,
              INV_NO: '1003',
              SERIAL_NO: 'SN-1003',
              TYPE_NAME: 'РќРѕСѓС‚Р±СѓРє',
              MODEL_NAME: 'Latitude',
              OWNER_DISPLAY_NAME: 'РЎРёРґРѕСЂРѕРІ РЎ.РЎ.',
              STATUS_NAME: 'Р’ СЂР°Р±РѕС‚Рµ',
              BRANCH_NAME: 'Remote',
              LOCATION_NAME: 'Desk',
            },
          ],
        },
      },
      total: 3,
      pages: 3,
    };
  });
  mockApi.equipmentAPI.getAllConsumablesGrouped.mockResolvedValue({
    grouped: {
      HQ: {
        Stock: [
          {
            ID: 2,
            INV_NO: '2001',
            TYPE_NAME: 'Картридж',
            MODEL_NAME: 'HP 85A',
            QTY: 3,
          },
        ],
      },
    },
    total: 1,
    pages: 1,
  });
});

// Фильтры списка — чипы с выпадающим списком: открыть чип, выбрать значение.
const chooseListFilter = async (filterBar, chipName, optionName) => {
  fireEvent.click(await within(filterBar).findByRole('button', { name: chipName }));
  fireEvent.click(await screen.findByRole('menuitem', { name: optionName }));
};

describe('Database equipment row helpers', () => {
  it('opens a database-scoped equipment QR link directly on the requested tab', async () => {
    mockApi.databaseAPI.getCurrentDatabase.mockImplementation(async () => {
      const id = localStorage.getItem('selected_database') || 'main';
      return { id, name: id };
    });
    renderDatabase('/database?inv_no=1001&db_id=archive&tab=history');

    await waitFor(() => {
      expect(mockApi.databaseAPI.switchDatabase).toHaveBeenCalledWith('archive');
    });
    expect(await screen.findByRole('tab', { name: 'История перемещений' })).toHaveAttribute('aria-selected', 'true');
    expect(localStorage.getItem('selected_database')).toBe('archive');
  });

  it('replaces the portal header with a compact page header that carries the database selector', async () => {
    renderDatabase();

    const layout = await screen.findByTestId('main-layout');
    expect(layout).toHaveAttribute('data-header-mode', 'integrated');
    expect(layout).toHaveAttribute('data-show-database-selector', 'false');
    const header = await screen.findByTestId('database-desktop-header');
    expect(within(header).getByRole('tab', { name: 'Оборудование' })).toBeInTheDocument();
    expect(within(header).getByRole('combobox', { name: 'База данных' })).toBeInTheDocument();
    expect(within(header).getByPlaceholderText('Поиск по инв. №, парт. №, модели, сотруднику...')).toBeInTheDocument();
  });

  it('shows desktop quick actions outside the mobile FAB', async () => {
    renderDatabase();

    expect(await screen.findByRole('button', { name: 'QR Сканер' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Загрузить акт' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Добавить оборудование' })).toBeInTheDocument();
  });

  it('renders the mobile control strip without the legacy FAB', async () => {
    installMatchMedia({ mobile: true });

    renderDatabase();

    expect(await screen.findByTestId('database-mobile-control-strip')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'QR' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ещё' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Оборудование' })).toHaveStyle({ minHeight: '44px' });
    expect(screen.getByRole('tab', { name: 'Расходники' })).toHaveStyle({ minHeight: '44px' });
    expect(screen.queryByRole('button', { name: 'Open actions' })).not.toBeInTheDocument();
    expect(screen.getByTestId('main-layout')).toHaveAttribute('data-header-mode', 'hidden');
  });

  it('shows the remaining desktop toolbar actions without manual load-more button', async () => {
    renderDatabase();

    expect(await screen.findByRole('button', { name: 'Определить ПК' })).toBeInTheDocument();
    expect((await screen.findAllByText('Филиал')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Загрузить ещё/ })).not.toBeInTheDocument();
    expect(await screen.findByTestId('equipment-load-more-sentinel')).toBeInTheDocument();

    fireEvent.click(screen.getByText('HQ'));

    expect(await screen.findByRole('button', { name: 'Свернуть разделы' })).toBeInTheDocument();
  });

  it('searches the whole database server-side, not only loaded pages', async () => {
    renderDatabase();

    // Страница 1 + prefetch страницы 2; страница 3 ещё не загружена.
    await waitFor(() => expect(mockApi.equipmentAPI.getAllEquipmentGrouped).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2 }),
    ));
    expect(await screen.findByText('HQ')).toBeInTheDocument();

    // Серверный universal находит строку, которой нет в загруженных страницах.
    mockApi.equipmentAPI.searchUniversal.mockResolvedValue({
      equipment: [
        {
          id: 77,
          inv_no: 'INV-777',
          model_name: 'Latitude 7420',
          type_name: 'PC',
          branch_name: 'HQ',
          location: 'Office',
        },
      ],
      total: 1,
      page: 1,
      pages: 1,
    });

    // Поиск по сотруднику идёт параллельно основному поиску (для любого текста) и
    // возвращает валидный ответ контракта EmployeeSearchResponse (employees/total/page/pages).
    mockApi.equipmentSearchAPI.searchByEmployee.mockResolvedValue({
      employees: [], total: 0, page: 1, pages: 0,
    });

    const searchInput = screen.getByPlaceholderText('Поиск по инв. №, парт. №, модели, сотруднику...');
    fireEvent.change(searchInput, { target: { value: 'Latitude' } });
    fireEvent.keyDown(searchInput, { key: 'Enter' });

    await waitFor(() => expect(mockApi.equipmentAPI.searchUniversal).toHaveBeenCalledWith('Latitude', 1, 200, { typeNo: null, field: '' }));
    await waitFor(() => expect(mockApi.equipmentSearchAPI.searchByEmployee).toHaveBeenCalledWith(
      'Latitude', 1, 50, expect.objectContaining({ databaseId: 'main' }),
    ));
    expect(mockApi.equipmentSearchAPI.searchByEmployee).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Latitude 7420')).toBeInTheDocument();
  });

  it('shows equipment part number in the desktop table', async () => {
    renderDatabase();

    fireEvent.click(await screen.findByText('HQ'));
    fireEvent.click(await screen.findByText('Office'));

    expect(await screen.findByText('Part Number')).toBeInTheDocument();
    expect(screen.getByText('PN-1001')).toBeInTheDocument();
  });

  it('filters loaded rows by photo presence and shows photo stats in group headers', async () => {
    mockApi.equipmentAPI.getCurrentActs.mockResolvedValue({
      items: [
        { item_id: 1, available: false, photo_count: 2 },
        { item_id: 2, available: false, photo_count: 0 },
      ],
    });
    renderDatabase();

    const filterBar = await screen.findByTestId('equipment-list-filters');
    await waitFor(() => expect(screen.getByRole('button', { name: /HQ.*с фото 1 из 2/ })).toBeInTheDocument());

    fireEvent.click(screen.getByText('HQ'));
    expect(await screen.findByText('Office')).toBeInTheDocument();
    expect(screen.getByText('Lab')).toBeInTheDocument();

    await chooseListFilter(filterBar, 'Фильтр по наличию фото', 'Без фото (1)');
    await waitFor(() => expect(screen.queryByText('Office')).not.toBeInTheDocument());
    expect(screen.getByText('Lab')).toBeInTheDocument();
    // Автоподгрузка на время фильтра выключена — только ручная кнопка.
    expect(screen.queryByTestId('equipment-load-more-sentinel')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Загрузить ещё' })).toBeInTheDocument();

    await chooseListFilter(filterBar, 'Фильтр по наличию фото', 'Все');
    expect(await screen.findByText('Office')).toBeInTheDocument();
  });

  it('marks the list camera by photo checks: red for rejected, plain without marks', async () => {
    mockApi.equipmentAPI.getCurrentActs.mockResolvedValue({
      items: [
        { item_id: 1, available: false, photo_count: 2, photo_verified_count: 1, photo_rejected_count: 1 },
        { item_id: 2, available: false, photo_count: 1, photo_verified_count: 0, photo_rejected_count: 0 },
      ],
    });
    renderDatabase();

    fireEvent.click(await screen.findByText('HQ'));
    fireEvent.click(await screen.findByText('Office'));
    // Отклонённое фото важнее проверенного: камера красная.
    expect(await screen.findByRole('button', { name: 'Открыть фото: 2, отклонено 1' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('Lab'));
    expect(await screen.findByRole('button', { name: 'Открыть фото: 1' })).toBeInTheDocument();
  });

  it('filters loaded rows by current act presence', async () => {
    mockApi.equipmentAPI.getCurrentActs.mockResolvedValue({
      items: [
        { item_id: 1, available: true, doc_no: 901, doc_number: 'ACT-901', photo_count: 0 },
        { item_id: 2, available: false, photo_count: 0 },
      ],
    });
    renderDatabase();

    const filterBar = await screen.findByTestId('equipment-list-filters');
    fireEvent.click(screen.getByText('HQ'));
    expect(await screen.findByText('Office')).toBeInTheDocument();
    expect(screen.getByText('Lab')).toBeInTheDocument();

    await chooseListFilter(filterBar, 'Фильтр по наличию акта', 'Без акта (1)');
    await waitFor(() => expect(screen.queryByText('Office')).not.toBeInTheDocument());
    expect(screen.getByText('Lab')).toBeInTheDocument();

    // Фильтры складываются: «без акта» + «с фото» — подходящих строк нет.
    await chooseListFilter(filterBar, 'Фильтр по наличию фото', /С фото/);
    await waitFor(() => expect(screen.queryByText('Lab')).not.toBeInTheDocument());
    expect(screen.getByText('Среди загруженных строк нет подходящей техники')).toBeInTheDocument();
  });

  it('keeps the photo filter off the consumables tab', async () => {
    renderDatabase();
    expect(await screen.findByTestId('equipment-list-filters')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Расходники' }));

    await waitFor(() => expect(screen.queryByTestId('equipment-list-filters')).not.toBeInTheDocument());
  });

  it('walks the batch photo queue: next item without photos opens on the photos tab', async () => {
    mockApi.equipmentAPI.getCurrentActs.mockResolvedValue({
      items: [
        { item_id: 1, available: false, photo_count: 0 },
        { item_id: 2, available: false, photo_count: 0 },
      ],
    });
    await openFirstEquipmentDetail();
    fireEvent.click(screen.getByRole('tab', { name: 'Фото' }));

    // 1001 открыта, во втором филиале/локации ещё одна без фото — страница 2 подгружена префетчем.
    const nextButton = await screen.findByRole('button', { name: 'Следующая без фото (1)' });
    fireEvent.click(nextButton);

    await waitFor(() => expect(mockApi.equipmentPhotosAPI.list).toHaveBeenCalledWith(2, expect.anything()));
    // Очередь пуста: пропущенная 1001 больше не предлагается.
    const exhausted = await screen.findByRole('button', { name: 'Следующая без фото' });
    expect(exhausted).toBeDisabled();
  });

  it('shows recent equipment cards under search and opens detail from the card', async () => {
    mockApi.equipmentAPI.getRecentCards.mockResolvedValue({
      items: [
        {
          inv_no: '1001',
          db_id: 'main',
          last_action: 'view',
          last_action_label: 'Открыта',
          last_activity_at: '2026-05-27T08:00:00+00:00',
          activity_count: 1,
          snapshot: {
            INV_NO: '1001',
            SERIAL_NO: 'SN-1001',
            MODEL_NAME: 'OptiPlex Recent',
            OWNER_DISPLAY_NAME: 'Recent Holder',
            BRANCH_NAME: 'HQ',
            LOCATION_NAME: 'Office',
            STATUS_NAME: 'Active',
          },
        },
      ],
    });

    renderDatabase();

    expect(await screen.findByTestId('database-recent-cards')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Показать последние карточки'));
    expect(await screen.findByText('OptiPlex Recent')).toBeInTheDocument();
    fireEvent.click(screen.getByText('OptiPlex Recent'));

    await waitFor(() => {
      expect(mockApi.equipmentAPI.touchRecentCard).toHaveBeenCalledWith(expect.objectContaining({
        invNo: '1001',
        actionType: 'view',
      }));
    });
    await waitFor(() => {
      expect(mockApi.equipmentAPI.getByInvNos).toHaveBeenCalledWith(['1001']);
    });
  });

  it('collapses and expands recent equipment cards', async () => {
    mockApi.equipmentAPI.getRecentCards.mockResolvedValue({
      items: [
        {
          inv_no: '1001',
          db_id: 'main',
          last_action: 'view',
          last_action_label: 'Открыта',
          last_activity_at: '2026-05-27T08:00:00+00:00',
          activity_count: 1,
          snapshot: {
            INV_NO: '1001',
            MODEL_NAME: 'OptiPlex Recent',
            OWNER_DISPLAY_NAME: 'Recent Holder',
            BRANCH_NAME: 'HQ',
            LOCATION_NAME: 'Office',
            STATUS_NAME: 'Active',
          },
        },
      ],
    });

    renderDatabase();

    expect(await screen.findByTestId('database-recent-cards')).toBeInTheDocument();
    expect(screen.queryByText('OptiPlex Recent')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Показать последние карточки'));
    expect(await screen.findByText('OptiPlex Recent')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Скрыть последние карточки'));
    await waitFor(() => {
      expect(screen.queryByText('OptiPlex Recent')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Показать последние карточки'));
    expect(await screen.findByText('OptiPlex Recent')).toBeInTheDocument();
  });

  it('records a recent view when a row action opens a card', async () => {
    renderDatabase();

    fireEvent.click(await screen.findByText('HQ'));
    fireEvent.click(await screen.findByText('Office'));
    fireEvent.click(await screen.findByRole('row', { name: /1001/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Просмотр' }));

    await waitFor(() => {
      expect(mockApi.equipmentAPI.touchRecentCard).toHaveBeenCalledWith(expect.objectContaining({
        invNo: '1001',
        actionType: 'view',
      }));
    });
  });

  it('hides recent equipment cards on the consumables tab', async () => {
    mockApi.equipmentAPI.getRecentCards.mockResolvedValue({
      items: [
        {
          inv_no: '1001',
          db_id: 'main',
          last_action: 'view',
          last_action_label: 'Открыта',
          last_activity_at: '2026-05-27T08:00:00+00:00',
          activity_count: 1,
          snapshot: { INV_NO: '1001', MODEL_NAME: 'OptiPlex Recent' },
        },
      ],
    });

    renderDatabase();

    expect(await screen.findByTestId('database-recent-cards')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('tab')[1]);

    await waitFor(() => {
      expect(mockApi.equipmentAPI.getAllConsumablesGrouped).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('database-recent-cards')).not.toBeInTheDocument();
  });

  it('switches desktop quick action to consumables add button on the consumables tab', async () => {
    renderDatabase();

    expect(await screen.findByRole('button', { name: 'Добавить оборудование' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Расходники' }));

    await waitFor(() => {
      expect(mockApi.equipmentAPI.getAllConsumablesGrouped).toHaveBeenCalled();
    });

    expect(await screen.findByRole('button', { name: 'Добавить расходник' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Загрузить акт' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Добавить оборудование' })).not.toBeInTheDocument();
    // the QR scanner stays available on the consumables tab (the toolbar always offers it)
    expect(screen.getByRole('button', { name: 'QR Сканер' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Оборудование' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Расходники' })).toBeInTheDocument();
  });

  it('keeps tabs and search visible while switching modes', async () => {
    renderDatabase();

    expect(await screen.findByRole('tab', { name: 'Оборудование' })).toBeInTheDocument();
    const searchInput = screen.getByRole('textbox');

    fireEvent.click(screen.getByRole('tab', { name: 'Расходники' }));

    await waitFor(() => {
      expect(mockApi.equipmentAPI.getAllConsumablesGrouped).toHaveBeenCalled();
    });

    expect(screen.getByRole('tab', { name: 'Оборудование' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Расходники' })).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBe(searchInput);
    expect(screen.queryByText('Загрузка данных...')).not.toBeInTheDocument();
  });

  it('filters consumables by model from the consumables search field', async () => {
    mockApi.equipmentAPI.getAllConsumablesGrouped.mockResolvedValue({
      grouped: {
        HQ: {
          Stock: [
            {
              ID: 2,
              INV_NO: '2001',
              TYPE_NAME: 'Картридж',
              MODEL_NAME: 'HP 85A',
              QTY: 3,
            },
            {
              ID: 3,
              INV_NO: '2002',
              TYPE_NAME: 'Картридж',
              MODEL_NAME: 'Canon 725',
              QTY: 4,
            },
          ],
        },
      },
      total: 2,
      pages: 1,
    });

    renderDatabase();
    fireEvent.click(await screen.findByRole('tab', { name: 'Расходники' }));

    await waitFor(() => {
      expect(mockApi.equipmentAPI.getAllConsumablesGrouped).toHaveBeenCalled();
    });

    fireEvent.click(await screen.findByText('HQ'));
    fireEvent.click(await screen.findByText('Stock'));
    expect(await screen.findByText('HP 85A')).toBeInTheDocument();
    expect(screen.getByText('Canon 725')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText('Поиск по ID, типу, модели...');
    fireEvent.change(searchInput, { target: { value: 'Canon 725' } });
    fireEvent.keyDown(searchInput, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.queryByText('HP 85A')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Canon 725')).toBeInTheDocument();
  });

  it('keeps the same branch filter when switching between equipment and consumables tabs', async () => {
    renderDatabase();

    await screen.findByRole('tab', { name: 'Оборудование' });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Филиал' }));
    fireEvent.click(await screen.findByRole('option', { name: 'HQ' }));

    fireEvent.click(screen.getByRole('tab', { name: 'Расходники' }));
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Филиал' })).toHaveTextContent('HQ');
    });

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Филиал' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Remote' }));

    fireEvent.click(screen.getByRole('tab', { name: 'Оборудование' }));

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Филиал' })).toHaveTextContent('Remote');
    });
  });

  it('persists branch filter in localStorage when a branch is selected', async () => {
    renderDatabase();

    await screen.findByRole('tab', { name: 'Оборудование' });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Филиал' }));
    fireEvent.click(await screen.findByRole('option', { name: 'HQ' }));

    expect(localStorage.getItem('database_branch_filters')).toBe(JSON.stringify({ main: 'HQ' }));
  });

  it('persists all-branches filter locally and on the server', async () => {
    renderDatabase();

    await screen.findByRole('tab', { name: 'Оборудование' });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Филиал' }));
    fireEvent.click(await screen.findByRole('option', { name: 'HQ' }));
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Филиал' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Все филиалы' }));

    expect(localStorage.getItem('database_branch_filters')).toBe(JSON.stringify({ main: '' }));

    await waitFor(() => {
      expect(mockApi.settingsAPI.updateMySettings).toHaveBeenCalledWith(
        expect.objectContaining({ database_branch_filters: { main: '' } }),
      );
    }, { timeout: 1000 });
  });

  it('restores all-branches filter from server settings', async () => {
    mockApi.settingsAPI.getMySettings.mockResolvedValue({
      database_branch_filters: { main: '' },
    });

    renderDatabase();

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Филиал' })).toHaveTextContent('Все филиалы');
    });
    expect(localStorage.getItem('database_branch_filters')).toBe(JSON.stringify({ main: '' }));
  });

  it('restores branch filter from localStorage on remount', async () => {
    localStorage.setItem('database_branch_filters', JSON.stringify({ main: 'HQ' }));
    mockApi.settingsAPI.getMySettings.mockResolvedValue({
      database_branch_filters: { main: 'HQ' },
    });

    renderDatabase();

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Филиал' })).toHaveTextContent('HQ');
    });
  });

  it('merges database branch filters into localStorage when settings are loaded', async () => {
    mockApi.settingsAPI.getMySettings.mockResolvedValue({
      database_branch_filters: { main: 'Remote' },
    });

    renderDatabase();

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Филиал' })).toHaveTextContent('Remote');
    });
    expect(localStorage.getItem('database_branch_filters')).toBe(JSON.stringify({ main: 'Remote' }));
  });

  it('does not refetch equipment grouped pages when returning to a cached tab', async () => {
    renderDatabase();

    await waitFor(() => {
      expect(mockApi.equipmentAPI.getAllEquipmentGrouped).toHaveBeenCalled();
    });
    const equipmentCallsBeforeSwitch = mockApi.equipmentAPI.getAllEquipmentGrouped.mock.calls.length;

    fireEvent.click(screen.getByRole('tab', { name: 'Расходники' }));
    await waitFor(() => {
      expect(mockApi.equipmentAPI.getAllConsumablesGrouped).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Оборудование' }));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Оборудование' })).toHaveAttribute('aria-selected', 'true');
    });
    expect(mockApi.equipmentAPI.getAllEquipmentGrouped.mock.calls.length).toBe(equipmentCallsBeforeSwitch);
  });

  it('lazy-loads equipment movement history from the detail tab', async () => {
    const historyTab = await openFirstEquipmentDetail();

    expect(mockApi.equipmentAPI.getEquipmentHistory).not.toHaveBeenCalled();

    fireEvent.click(historyTab);

    await waitFor(() => {
      expect(mockApi.equipmentAPI.getEquipmentHistory).toHaveBeenCalledWith('1001');
    });
    expect(await screen.findByText('Old Holder -> New Holder')).toBeInTheDocument();
    expect(screen.getByText('Old Branch -> HQ')).toBeInTheDocument();
    expect(screen.getByText('Stock -> Office')).toBeInTheDocument();
  });

  it('shows an empty movement history state in the detail tab', async () => {
    mockApi.equipmentAPI.getEquipmentHistory.mockResolvedValueOnce({
      inv_no: '1001',
      item_id: 1,
      total: 0,
      history: [],
    });

    const historyTab = await openFirstEquipmentDetail();
    fireEvent.click(historyTab);

    expect(await screen.findByText('История перемещений для этого оборудования пока пустая.')).toBeInTheDocument();
  });

  it('returns from an equipment card to the employee dialog without resetting its search', async () => {
    await openFirstEquipmentDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Иванов И.И.' }));

    // Диалог сотрудника подгружается через lazy() — под нагрузкой чанк может
    // превышать дефолтный asyncTimeout (1s); даём запас.
    const employeeDialog = await screen.findByRole('dialog', { name: 'Оборудование сотрудника' }, { timeout: 5000 });
    const searchInput = await screen.findByRole('textbox', { name: 'Поиск' });
    fireEvent.change(searchInput, { target: { value: 'OptiPlex' } });
    fireEvent.click(await screen.findByRole('button', { name: '1001' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Назад' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Назад' })).not.toBeInTheDocument();
    });
    expect(employeeDialog).toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: 'Поиск' })).toHaveValue('OptiPlex');
    expect(mockApi.equipmentSearchAPI.getEmployeeEquipment).toHaveBeenCalledTimes(1);
  });

  it('adds delete action only with delete permission in equipment mode', () => {
    const item = {
      INV_NO: '1001',
      TYPE_NAME: 'PC',
      MODEL_NAME: 'Office Workstation',
      VENDOR_NAME: 'Dell',
    };

    expect(getEquipmentRowActions({
      item,
      dataMode: 'equipment',
      canWrite: true,
      canDeleteEquipment: true,
    })).toContain('delete');

    expect(getEquipmentRowActions({
      item,
      dataMode: 'equipment',
      canWrite: true,
      canDeleteEquipment: false,
    })).not.toContain('delete');

    expect(getEquipmentRowActions({
      item,
      dataMode: 'consumables',
      canWrite: true,
      canDeleteEquipment: true,
    })).toEqual([]);
  });

  it('removes deleted item from grouped data and prunes empty groups', () => {
    const grouped = {
      BranchA: {
        Location1: [
          { INV_NO: '1001', MODEL_NAME: 'A' },
        ],
      },
      BranchB: {
        Location2: [
          { INV_NO: '2001', MODEL_NAME: 'B' },
          { INV_NO: '2002', MODEL_NAME: 'C' },
        ],
      },
    };

    expect(removeItemFromGrouped(grouped, '1001')).toEqual({
      BranchB: {
        Location2: [
          { INV_NO: '2001', MODEL_NAME: 'B' },
          { INV_NO: '2002', MODEL_NAME: 'C' },
        ],
      },
    });

    expect(removeItemFromGrouped(grouped, '2001')).toEqual({
      BranchA: {
        Location1: [
          { INV_NO: '1001', MODEL_NAME: 'A' },
        ],
      },
      BranchB: {
        Location2: [
          { INV_NO: '2002', MODEL_NAME: 'C' },
        ],
      },
    });
  });

  it('builds success verification state when API and final inv numbers match', () => {
    expect(buildUploadActInvVerification(['100887', '100888'], '100887, 100888')).toEqual(
      expect.objectContaining({
        severity: 'success',
        hasRecognizedInvNos: true,
        hasFinalInvNos: true,
        hasDifferences: false,
        recognizedInvNos: ['100887', '100888'],
        finalInvNos: ['100887', '100888'],
        onlyRecognizedInvNos: [],
        onlyFinalInvNos: [],
      })
    );
  });

  it('keeps only numeric inventory numbers in manual input and normalizes decimal suffixes', () => {
    expect(parseInvNosInput('№101795, 101796.0, abc, 1/2')).toEqual(['101795', '101796']);
  });

  it('ignores invalid recognized and final tokens when building verification state', () => {
    expect(buildUploadActInvVerification(['101795', 'номер', '1/2'], '№101795, abc, 101796.0')).toEqual(
      expect.objectContaining({
        severity: 'warning',
        recognizedInvNos: ['101795'],
        finalInvNos: ['101795', '101796'],
        commonInvNos: ['101795'],
        onlyRecognizedInvNos: [],
        onlyFinalInvNos: ['101796'],
      })
    );
  });

  it('builds warning verification state when final inv numbers differ from API result', () => {
    expect(buildUploadActInvVerification(['100887', '100888'], '100887, 100999')).toEqual(
      expect.objectContaining({
        severity: 'warning',
        hasRecognizedInvNos: true,
        hasFinalInvNos: true,
        hasDifferences: true,
        commonInvNos: ['100887'],
        onlyRecognizedInvNos: ['100888'],
        onlyFinalInvNos: ['100999'],
      })
    );
  });

  it('treats manual-only inv numbers as warning state that still has final values', () => {
    expect(buildUploadActInvVerification([], '200001, 200002')).toEqual(
      expect.objectContaining({
        severity: 'warning',
        hasRecognizedInvNos: false,
        hasFinalInvNos: true,
        hasDifferences: true,
        recognizedInvNos: [],
        finalInvNos: ['200001', '200002'],
        onlyFinalInvNos: ['200001', '200002'],
      })
    );
  });

  it('blocks upload act commit until draft, final inv numbers and confirmation are present', () => {
    expect(isUploadActCommitDisabled({
      hasDraft: true,
      hasFinalInvNos: true,
      isParsing: false,
      isCommitting: false,
      isEmailLoading: false,
      isInventoryVerified: true,
    })).toBe(false);

    expect(isUploadActCommitDisabled({
      hasDraft: true,
      hasFinalInvNos: true,
      isParsing: false,
      isCommitting: false,
      isEmailLoading: false,
      isInventoryVerified: false,
    })).toBe(true);

    expect(isUploadActCommitDisabled({
      hasDraft: true,
      hasFinalInvNos: false,
      isParsing: false,
      isCommitting: false,
      isEmailLoading: false,
      isInventoryVerified: true,
    })).toBe(true);
  });

  it('blocks oversized uploaded act PDF before sending it to the API', () => {
    const file = new File(['x'], 'signed-act.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'size', {
      configurable: true,
      value: (UPLOAD_ACT_MAX_SIZE_MB * 1024 * 1024) + 1,
    });

    expect(validateUploadActPdfFile(file)).toContain(`Максимальный размер для акта: ${UPLOAD_ACT_MAX_SIZE_MB} МБ`);
  });

  it('classifies timeout and network failures as not reaching the recognition API', () => {
    const error = {
      code: 'ECONNABORTED',
      message: 'timeout of 30000ms exceeded',
    };
    const file = new File(['pdf'], 'act.pdf', { type: 'application/pdf' });

    expect(isApiUnavailableForActParseError(error)).toBe(false);
    expect(buildUploadActParseErrorMessage({ error, file, manualMode: false })).toContain(
      'Запрос не дошёл до API распознавания'
    );
    expect(buildUploadActParseErrorMessage({ error, file, manualMode: false })).toContain('axios=ECONNABORTED');
  });

  it('allows manual fallback only for backend OpenRouter/API failures', () => {
    expect(isApiUnavailableForActParseError({
      response: {
        status: 400,
        data: { detail: 'Ошибка OpenRouter: provider unavailable' },
      },
    })).toBe(true);

    expect(buildUploadActParseErrorMessage({
      error: {
        response: {
          status: 400,
          data: { detail: 'Размер файла превышает лимит 15 МБ' },
        },
      },
      file: new File(['pdf'], 'act.pdf', { type: 'application/pdf' }),
      manualMode: true,
    })).toContain('Backend вернул ошибку: Размер файла превышает лимит 15 МБ');
  });

  it('classifies bare 502 proxy failures without OpenRouter fallback', () => {
    const error = {
      code: 'ERR_BAD_RESPONSE',
      response: {
        status: 502,
        data: '',
      },
    };

    expect(isUploadActProxyUnavailableError(error)).toBe(true);
    expect(isApiUnavailableForActParseError(error)).toBe(false);
    expect(buildUploadActParseErrorMessage({
      error,
      file: new File(['pdf'], 'act.pdf', { type: 'application/pdf' }),
      manualMode: true,
    })).toContain('Backend или IIS/ARR proxy не вернул ответ');
  });

  it('skips the first data-mode effect run and refreshes only after lifecycle is initialized', () => {
    expect(resolveDataModeRefreshBehavior({
      hasInitializedEffect: false,
      isLifecycleReady: true,
    })).toEqual({
      shouldRefresh: false,
      nextHasInitializedEffect: true,
    });

    expect(resolveDataModeRefreshBehavior({
      hasInitializedEffect: true,
      isLifecycleReady: false,
    })).toEqual({
      shouldRefresh: false,
      nextHasInitializedEffect: true,
    });

    expect(resolveDataModeRefreshBehavior({
      hasInitializedEffect: true,
      isLifecycleReady: true,
    })).toEqual({
      shouldRefresh: true,
      nextHasInitializedEffect: true,
    });
  });

  it('parses upload-act deep link and preserves reminder signature parts', () => {
    expect(
      parseUploadActReminderDeepLink('?upload_act=1&reminder_id=rem-1&source_task_id=task-9&db_id=main')
    ).toEqual({
      reminderId: 'rem-1',
      sourceTaskId: 'task-9',
      dbId: 'main',
      signature: 'rem-1|task-9|main',
    });

    expect(parseUploadActReminderDeepLink('?reminder_id=rem-1')).toBeNull();
  });

  it('clears only upload-act reminder query params and keeps unrelated search params', () => {
    expect(
      clearUploadActReminderSearch('?upload_act=1&reminder_id=rem-1&source_task_id=task-9&db_id=main&tab=history')
    ).toBe('?tab=history');

    expect(clearUploadActReminderSearch('?tab=history')).toBeNull();
  });

  it('waits for database sync before opening upload-act deep link', () => {
    expect(
      getUploadActReminderDeepLinkAction({
        search: '?upload_act=1&reminder_id=rem-1&source_task_id=task-9&db_id=main',
        currentDbId: 'archive',
        handledSignature: '',
        isModalOpen: false,
      })
    ).toEqual({
      action: 'sync_db',
      deepLink: {
        reminderId: 'rem-1',
        sourceTaskId: 'task-9',
        dbId: 'main',
        signature: 'rem-1|task-9|main',
      },
    });
  });

  it('opens deep link only once and stays idle while modal is already open', () => {
    expect(
      getUploadActReminderDeepLinkAction({
        search: '?upload_act=1&reminder_id=rem-1&source_task_id=task-9&db_id=main',
        currentDbId: 'main',
        handledSignature: '',
        isModalOpen: false,
      })
    ).toEqual({
      action: 'open',
      deepLink: {
        reminderId: 'rem-1',
        sourceTaskId: 'task-9',
        dbId: 'main',
        signature: 'rem-1|task-9|main',
      },
    });

    expect(
      getUploadActReminderDeepLinkAction({
        search: '?upload_act=1&reminder_id=rem-1&source_task_id=task-9&db_id=main',
        currentDbId: 'main',
        handledSignature: 'rem-1|task-9|main',
        isModalOpen: false,
      }).action
    ).toBe('idle');

    expect(
      getUploadActReminderDeepLinkAction({
        search: '?upload_act=1&reminder_id=rem-1&source_task_id=task-9&db_id=main',
        currentDbId: 'main',
        handledSignature: '',
        isModalOpen: true,
      }).action
    ).toBe('idle');
  });

  it('waits for database readiness before any cold data requests', async () => {
    mockApi.grantedPermissions.add('warehouse_1c.read');
    let resolveCurrentDb;
    let resolveFirstPage;
    mockApi.databaseAPI.getCurrentDatabase.mockImplementation(
      () => new Promise((resolve) => { resolveCurrentDb = resolve; }),
    );
    mockApi.equipmentAPI.getAllEquipmentGrouped.mockImplementation(
      () => new Promise((resolve) => { resolveFirstPage = resolve; }),
    );

    renderDatabase();

    await waitFor(() => {
      expect(mockApi.databaseAPI.getCurrentDatabase).toHaveBeenCalled();
    });
    expect(mockApi.equipmentAPI.getAllEquipmentGrouped).not.toHaveBeenCalled();
    expect(mockApi.equipmentAPI.getRecentCards).not.toHaveBeenCalled();
    expect(mockApi.equipmentAPI.getRecentActs).not.toHaveBeenCalled();
    expect(mockApi.warehouse1cAPI.getEmployeeCompareSummary).not.toHaveBeenCalled();

    await act(async () => {
      resolveCurrentDb({ id: 'main', name: 'Основная база' });
    });

    await waitFor(() => {
      expect(mockApi.equipmentAPI.getAllEquipmentGrouped).toHaveBeenCalledTimes(1);
      expect(mockApi.equipmentAPI.getRecentCards).toHaveBeenCalledTimes(1);
      expect(mockApi.equipmentAPI.getRecentActs).toHaveBeenCalledTimes(1);
    });
    expect(mockApi.warehouse1cAPI.getEmployeeCompareSummary).not.toHaveBeenCalled();

    await act(async () => {
      resolveFirstPage({
        grouped: {
          HQ: {
            Office: [
              {
                ID: 1,
                INV_NO: '1001',
                MODEL_NAME: 'OptiPlex',
                OWNER_DISPLAY_NAME: 'Иванов И.И.',
                BRANCH_NAME: 'HQ',
                LOCATION_NAME: 'Office',
              },
            ],
          },
        },
        total: 1,
        pages: 1,
      });
    });

    await waitFor(() => {
      expect(mockApi.warehouse1cAPI.getEmployeeCompareSummary).toHaveBeenCalledTimes(1);
    });
    expect(mockApi.equipmentAPI.getAllEquipmentGrouped).toHaveBeenCalledTimes(1);
  });
});

describe('Database inventory 1C compare badges', () => {
  const PHILIPS_PART_NO = 'ЦБ-00195776';
  const PHILIPS_KEY = 'цб-00195776';

  const philipsRow = (overrides = {}) => ({
    ID: 21,
    INV_NO: '100021',
    SERIAL_NO: 'PH-1',
    PART_NO: PHILIPS_PART_NO,
    TYPE_NAME: 'Монитор',
    MODEL_NAME: 'Philips 243V',
    EMPL_NO: 42,
    OWNER_DISPLAY_NAME: 'Иванов И.И.',
    STATUS_NAME: 'В работе',
    BRANCH_NAME: 'HQ',
    LOCATION_NAME: 'Office',
    ...overrides,
  });

  const philipsSummaryItem = ({ status = 'match', hubCount = 2, qty1c = 2 } = {}) => ({
    owner_no: 42,
    employee_name: 'Иванов И.И.',
    warehouse_ref: 'wh-1',
    warehouse_name: 'Иванов И.И.',
    status,
    part_status: { [PHILIPS_KEY]: status },
    part_quantities: { [PHILIPS_KEY]: { hub_count: hubCount, qty_1c: qty1c } },
    counts: {
      match: status === 'match' ? 1 : 0,
      diff: status === 'diff' ? 1 : 0,
      only_hub: 0,
      only_1c: 0,
      no_part: 0,
      not_in_1c: 0,
      hub_items: 2,
    },
  });

  const philipsSummaryResponse = (overrides = {}) => ({
    meta: { status: 'ok', as_of: new Date().toISOString() },
    items: [philipsSummaryItem(overrides)],
  });

  const installPhilipsScenario = ({ balancesAsOf = new Date().toISOString() } = {}) => {
    mockApi.grantedPermissions.add('warehouse_1c.read');
    mockApi.equipmentAPI.getAllEquipmentGrouped.mockResolvedValue({
      grouped: {
        HQ: {
          Office: [
            philipsRow({ ID: 21, INV_NO: '100021' }),
            philipsRow({ ID: 22, INV_NO: '100022' }),
          ],
        },
      },
      total: 2,
      pages: 1,
    });
    mockApi.equipmentSearchAPI.getEmployeeEquipment.mockResolvedValue({
      equipment: [
        { ID: 21, INV_NO: '100021', MODEL_NAME: 'Philips 243V', PART_NO: PHILIPS_PART_NO, EMPL_NO: 42 },
        { ID: 22, INV_NO: '100022', MODEL_NAME: 'Philips 243V', PART_NO: PHILIPS_PART_NO, EMPL_NO: 42 },
      ],
    });
    mockApi.warehouse1cAPI.getEmployeeWarehouse.mockImplementation(async ({ loadBalances } = {}) => (
      loadBalances
        ? {
          status: 'matched',
          warehouse: { ref: 'wh-1', name: 'Иванов И.И.' },
          balances: [{
            nomenclature_ref: 'nom-1',
            nomenclature_code: PHILIPS_PART_NO,
            nomenclature_name: 'Монитор Philips 243V',
            qty_balance: 1,
          }],
          balances_meta: { status: 'ok', as_of: balancesAsOf },
        }
        : {
          status: 'matched',
          warehouse: { ref: 'wh-1', name: 'Иванов И.И.' },
          balances: [],
        }
    ));
  };

  const expandPhilipsRows = async () => {
    fireEvent.click(await screen.findByText('HQ'));
    fireEvent.click(await screen.findByText('Office'));
    await screen.findByText('100021');
    await screen.findByText('100022');
  };

  const openEmployeeDialog = async () => {
    const employeeButtons = await screen.findAllByRole('button', { name: 'Иванов И.И.' });
    fireEvent.click(employeeButtons[0]);
    return screen.findByRole('dialog', { name: 'Оборудование сотрудника' }, { timeout: 5000 });
  };

  const closeEmployeeDialog = async (dialog) => {
    const closeButtons = Array.from(dialog.querySelectorAll('button'))
      .filter((button) => button.getAttribute('aria-label') === 'Закрыть' || button.textContent.trim() === 'Закрыть');
    fireEvent.click(closeButtons[0]);
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Оборудование сотрудника' })).not.toBeInTheDocument();
    });
  };

  it('corrects green badges to warnings after the employee dialog shows 2-vs-1', async () => {
    installPhilipsScenario();
    mockApi.warehouse1cAPI.getEmployeeCompareSummary.mockResolvedValue(philipsSummaryResponse());

    renderDatabase();
    await expandPhilipsRows();

    expect(await screen.findAllByText('1С ✓')).toHaveLength(2);

    const dialog = await openEmployeeDialog();

    expect(mockApi.equipmentSearchAPI.getEmployeeEquipment).toHaveBeenCalledWith(42, {
      employeeName: 'Иванов И.И.',
      allDatabases: false,
    });

    await waitFor(() => {
      expect(dialog.querySelectorAll('[data-compare-status="diff"]')).toHaveLength(3);
    });

    await closeEmployeeDialog(dialog);

    expect(await screen.findAllByText('1С ≠')).toHaveLength(2);
    expect(screen.queryByText('1С ✓')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-compare-status="diff"]')).toHaveLength(2);

    fireEvent.mouseOver(document.querySelector('[data-compare-status="diff"]'));
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Хаб: 2');
    expect(tooltip).toHaveTextContent('1С: 1');

    const reopened = await openEmployeeDialog();
    await waitFor(() => {
      expect(reopened.querySelectorAll('[data-compare-status="diff"]')).toHaveLength(3);
    });
    await closeEmployeeDialog(reopened);
    expect(await screen.findAllByText('1С ≠')).toHaveLength(2);
    expect(screen.queryByText('1С ✓')).not.toBeInTheDocument();
  });

  it('filters the list by the automatic 1C check and resets all filters in one click', async () => {
    installPhilipsScenario();
    mockApi.warehouse1cAPI.getEmployeeCompareSummary.mockResolvedValue(philipsSummaryResponse());

    renderDatabase();
    await expandPhilipsRows();
    expect(await screen.findAllByText('1С ✓')).toHaveLength(2);

    const filterBar = await screen.findByTestId('equipment-list-filters');
    await chooseListFilter(filterBar, 'Фильтр по сверке с 1С', /Расхождение/);
    expect(await screen.findByText('Среди загруженных строк нет подходящей техники')).toBeInTheDocument();
    expect(screen.queryByText('100021')).not.toBeInTheDocument();

    fireEvent.click(within(filterBar).getByTestId('list-filters-reset'));
    expect(await screen.findByText('HQ')).toBeInTheDocument();

    // Раскрытые ветки остаются раскрытыми: после сброса и «Сверено» строки на месте.
    await chooseListFilter(filterBar, 'Фильтр по сверке с 1С', 'Сверено (2)');
    expect(await screen.findByText('100021')).toBeInTheDocument();
    expect(screen.getByText('100022')).toBeInTheDocument();
  });

  it('marks a card as «does not match 1C» only with a comment, then shows the red chip', async () => {
    installPhilipsScenario();
    mockApi.grantedPermissions.add('database.one_c_mark');
    mockApi.warehouse1cAPI.getEmployeeCompareSummary.mockResolvedValue(philipsSummaryResponse());
    mockApi.equipmentOneCMarksAPI.set.mockResolvedValue({
      inv_no: '100021', kind: 'mismatch', marked_by: 'admin', marked_at: '2026-10-20T08:00:00Z', note: 'в 1С остаток 1',
    });

    renderDatabase();
    await expandPhilipsRows();
    fireEvent.click((await screen.findAllByText('Philips 243V'))[0]);
    fireEvent.click(await screen.findByText('Не сходится с 1С…'));

    const dialog = await screen.findByTestId('one-c-mismatch-dialog');
    const save = within(dialog).getByTestId('one-c-mismatch-save');
    expect(save).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Комментарий к отметке «не сходится с 1С»'), {
      target: { value: '  в 1С остаток 1  ' },
    });
    fireEvent.click(save);

    await waitFor(() => expect(mockApi.equipmentOneCMarksAPI.set).toHaveBeenCalledWith('100021', 'в 1С остаток 1', 'mismatch'));
    expect(await screen.findByText('1С ✕')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('one-c-mismatch-dialog')).not.toBeInTheDocument());
  });

  it('highlights rows whose PART_NO has no nomenclature in 1C and filters them', async () => {
    installPhilipsScenario();
    mockApi.warehouse1cAPI.getEmployeeCompareSummary.mockResolvedValue(philipsSummaryResponse());
    mockApi.warehousePartNoCheckAPI.check.mockResolvedValue({ available: true, missing: [PHILIPS_PART_NO] });

    renderDatabase();
    await expandPhilipsRows();

    expect(await screen.findAllByText('1С ?')).toHaveLength(2);
    expect(mockApi.warehousePartNoCheckAPI.check).toHaveBeenCalledWith([PHILIPS_PART_NO]);

    const filterBar = await screen.findByTestId('equipment-list-filters');
    await chooseListFilter(filterBar, 'Фильтр по сверке с 1С', /Нет в номенклатуре/);
    expect(await screen.findByText('100021')).toBeInTheDocument();
    expect(screen.getByText('100022')).toBeInTheDocument();
  });

  it('ignores a stale summary response resolved after the dialog correction', async () => {
    installPhilipsScenario();
    let resolveSummary;
    mockApi.warehouse1cAPI.getEmployeeCompareSummary.mockImplementation(
      () => new Promise((resolve) => { resolveSummary = resolve; }),
    );

    renderDatabase();
    await expandPhilipsRows();

    const dialog = await openEmployeeDialog();
    await waitFor(() => {
      expect(dialog.querySelectorAll('[data-compare-status="diff"]')).toHaveLength(3);
    });
    await closeEmployeeDialog(dialog);

    expect(await screen.findAllByText('1С ≠')).toHaveLength(2);

    const staleResponse = philipsSummaryResponse();
    staleResponse.meta.as_of = new Date(Date.now() - 30_000).toISOString();
    await act(async () => {
      resolveSummary(staleResponse);
    });

    expect(screen.getAllByText('1С ≠')).toHaveLength(2);
    expect(screen.queryByText('1С ✓')).not.toBeInTheDocument();
  });

  it('lets a genuinely newer batch supersede the dialog correction', async () => {
    installPhilipsScenario({ balancesAsOf: new Date(Date.now() - 60_000).toISOString() });
    let resolveSummary;
    mockApi.warehouse1cAPI.getEmployeeCompareSummary.mockImplementation(
      () => new Promise((resolve) => { resolveSummary = resolve; }),
    );

    renderDatabase();
    await expandPhilipsRows();

    const dialog = await openEmployeeDialog();
    await waitFor(() => {
      expect(dialog.querySelectorAll('[data-compare-status="diff"]')).toHaveLength(3);
    });
    await closeEmployeeDialog(dialog);

    expect(await screen.findAllByText('1С ≠')).toHaveLength(2);

    const newerResponse = philipsSummaryResponse();
    newerResponse.meta.as_of = new Date(Date.now() - 30_000).toISOString();
    await act(async () => {
      resolveSummary(newerResponse);
    });

    expect(await screen.findAllByText('1С ✓')).toHaveLength(2);
    expect(screen.queryByText('1С ≠')).not.toBeInTheDocument();
  });

  it('never paints green from summary metadata without a usable timestamp', async () => {
    installPhilipsScenario();
    mockApi.warehouse1cAPI.getEmployeeCompareSummary.mockResolvedValue({
      meta: { status: 'ok' },
      items: [philipsSummaryItem()],
    });

    renderDatabase();
    await expandPhilipsRows();
    await waitFor(() => {
      expect(mockApi.warehouse1cAPI.getEmployeeCompareSummary).toHaveBeenCalled();
    });
    expect(screen.queryByText('1С ✓')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-compare-status]')).toHaveLength(0);

    mockApi.warehouse1cAPI.getEmployeeCompareSummary.mockResolvedValue({
      meta: { status: 'ok', as_of: 'not-a-date' },
      items: [philipsSummaryItem()],
    });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(screen.queryByText('1С ✓')).not.toBeInTheDocument();

    mockApi.warehouse1cAPI.getEmployeeCompareSummary.mockResolvedValue({
      meta: { status: 'ok', as_of: new Date(Date.now() + 60_000).toISOString() },
      items: [philipsSummaryItem()],
    });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(screen.queryByText('1С ✓')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-compare-status]')).toHaveLength(0);
  });

  it('keeps badges green only while summary evidence is fresh and complete', async () => {
    installPhilipsScenario();
    mockApi.warehouse1cAPI.getEmployeeCompareSummary.mockResolvedValue(
      philipsSummaryResponse({ status: 'match', hubCount: 2, qty1c: 2 }),
    );

    renderDatabase();
    await expandPhilipsRows();
    expect(await screen.findAllByText('1С ✓')).toHaveLength(2);

    mockApi.warehouse1cAPI.getEmployeeCompareSummary.mockResolvedValue({
      meta: { status: 'incomplete', balances_status: 'unknown', as_of: new Date().toISOString() },
      items: [philipsSummaryItem()],
    });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => {
      expect(screen.queryByText('1С ✓')).not.toBeInTheDocument();
    });

    mockApi.warehouse1cAPI.getEmployeeCompareSummary.mockResolvedValue(philipsSummaryResponse());
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(await screen.findAllByText('1С ✓')).toHaveLength(2);
  });

  it('hides badges immediately when a refresh fails before the snapshot expiry', async () => {
    installPhilipsScenario();
    mockApi.warehouse1cAPI.getEmployeeCompareSummary.mockResolvedValue(philipsSummaryResponse());

    renderDatabase();
    await expandPhilipsRows();
    expect(await screen.findAllByText('1С ✓')).toHaveLength(2);

    mockApi.warehouse1cAPI.getEmployeeCompareSummary.mockRejectedValue(new Error('1C down'));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => {
      expect(screen.queryByText('1С ✓')).not.toBeInTheDocument();
      expect(document.querySelectorAll('[data-compare-status]')).toHaveLength(0);
    });
  });

  it('clears badges when a refresh fails and never restores the stale green', async () => {
    vi.useFakeTimers();
    try {
      installPhilipsScenario();
      mockApi.warehouse1cAPI.getEmployeeCompareSummary
        .mockImplementationOnce(async () => philipsSummaryResponse())
        .mockRejectedValue(new Error('1C down'));

      renderDatabase();
      for (let i = 0; i < 20; i += 1) {
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        if (screen.queryByText('HQ')) break;
      }
      fireEvent.click(screen.getByText('HQ'));
      fireEvent.click(screen.getByText('Office'));
      for (let i = 0; i < 20; i += 1) {
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        if (screen.queryByText('100021')) break;
      }
      expect(document.querySelectorAll('[data-compare-status="match"]')).toHaveLength(2);

      await act(async () => { await vi.advanceTimersByTimeAsync(EMPLOYEE_COMPARE_REFRESH_INTERVAL_MS + 1_000); });
      expect(document.querySelectorAll('[data-compare-status="match"]')).toHaveLength(0);
      expect(screen.queryByText('1С ✓')).not.toBeInTheDocument();

      await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
      expect(screen.queryByText('1С ✓')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('expires badges on the source timestamp and restores them only with fresh evidence', async () => {
    vi.useFakeTimers();
    try {
      installPhilipsScenario();
      let resolveRefresh;
      let call = 0;
      mockApi.warehouse1cAPI.getEmployeeCompareSummary.mockImplementation(() => {
        call += 1;
        if (call === 1) {
          return Promise.resolve({
            meta: { status: 'ok', as_of: new Date(Date.now() - (EMPLOYEE_COMPARE_MAX_AGE_MS - 10_000)).toISOString() },
            items: [philipsSummaryItem()],
          });
        }
        return new Promise((resolve) => { resolveRefresh = resolve; });
      });

      renderDatabase();
      for (let i = 0; i < 20; i += 1) {
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        if (screen.queryByText('HQ')) break;
      }
      fireEvent.click(screen.getByText('HQ'));
      fireEvent.click(screen.getByText('Office'));
      for (let i = 0; i < 20; i += 1) {
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        if (screen.queryByText('100021')) break;
      }
      expect(document.querySelectorAll('[data-compare-status="match"]')).toHaveLength(2);

      await act(async () => { await vi.advanceTimersByTimeAsync(11_000); });
      expect(document.querySelectorAll('[data-compare-status]')).toHaveLength(0);
      expect(screen.queryByText('1С ✓')).not.toBeInTheDocument();
      expect(mockApi.warehouse1cAPI.getEmployeeCompareSummary).toHaveBeenCalledWith({ refresh: true });

      await act(async () => {
        resolveRefresh(philipsSummaryResponse());
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(document.querySelectorAll('[data-compare-status="match"]')).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('forces a cache-bypassing refresh when inventory data advances during a pending summary', async () => {
    installPhilipsScenario();
    let resolvePageTwo;
    mockApi.equipmentAPI.getAllEquipmentGrouped.mockImplementation(async ({ page = 1 } = {}) => {
      if (page === 1) {
        return {
          grouped: {
            HQ: {
              Office: [
                philipsRow({ ID: 21, INV_NO: '100021' }),
                philipsRow({ ID: 22, INV_NO: '100022' }),
              ],
            },
          },
          total: 3,
          pages: 2,
          data_version: 1,
        };
      }
      return new Promise((resolve) => {
        resolvePageTwo = () => resolve({ grouped: {}, total: 3, pages: 2, data_version: 2 });
      });
    });
    let resolveStale;
    let call = 0;
    mockApi.warehouse1cAPI.getEmployeeCompareSummary.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return new Promise((resolve) => { resolveStale = resolve; });
      }
      return Promise.resolve(philipsSummaryResponse({ status: 'diff', hubCount: 2, qty1c: 1 }));
    });

    renderDatabase();
    await expandPhilipsRows();
    await waitFor(() => {
      expect(mockApi.warehouse1cAPI.getEmployeeCompareSummary).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(typeof resolvePageTwo).toBe('function');
    });

    await act(async () => {
      resolvePageTwo();
    });

    await waitFor(() => {
      expect(mockApi.warehouse1cAPI.getEmployeeCompareSummary).toHaveBeenCalledWith({ refresh: true });
    });
    expect(await screen.findAllByText('1С ≠')).toHaveLength(2);

    const staleResponse = philipsSummaryResponse();
    staleResponse.meta.as_of = new Date(Date.now() - 30_000).toISOString();
    await act(async () => {
      resolveStale(staleResponse);
    });
    expect(screen.getAllByText('1С ≠')).toHaveLength(2);
    expect(screen.queryByText('1С ✓')).not.toBeInTheDocument();
  });

  it('restores badges after a fresh successful refresh', async () => {
    vi.useFakeTimers();
    try {
      installPhilipsScenario();
      mockApi.warehouse1cAPI.getEmployeeCompareSummary
        .mockImplementation(async () => philipsSummaryResponse());

      renderDatabase();
      for (let i = 0; i < 20; i += 1) {
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        if (screen.queryByText('HQ')) break;
      }
      fireEvent.click(screen.getByText('HQ'));
      fireEvent.click(screen.getByText('Office'));
      for (let i = 0; i < 20; i += 1) {
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        if (screen.queryByText('100021')) break;
      }
      expect(document.querySelectorAll('[data-compare-status="match"]')).toHaveLength(2);

      await act(async () => { await vi.advanceTimersByTimeAsync(EMPLOYEE_COMPARE_REFRESH_INTERVAL_MS + 1_000); });
      expect(document.querySelectorAll('[data-compare-status="match"]')).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a summary response that resolves after the database switched', async () => {
    installPhilipsScenario();
    let resolveSummary;
    let call = 0;
    mockApi.warehouse1cAPI.getEmployeeCompareSummary.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return new Promise((resolve) => { resolveSummary = resolve; });
      }
      return Promise.resolve({ meta: { status: 'ok', as_of: new Date().toISOString() }, items: [] });
    });

    renderDatabase();
    await expandPhilipsRows();

    mockApi.databaseAPI.getCurrentDatabase.mockResolvedValue({ id: 'archive', name: 'Archive' });
    await act(async () => {
      localStorage.setItem('selected_database', 'archive');
      window.dispatchEvent(new CustomEvent('database-changed', { detail: { databaseId: 'archive' } }));
    });
    await waitFor(() => {
      expect(mockApi.warehouse1cAPI.getEmployeeCompareSummary.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    await act(async () => {
      resolveSummary(philipsSummaryResponse());
    });

    expect(screen.queryByText('1С ✓')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-compare-status]')).toHaveLength(0);
  });

  it('closes the employee dialog on database switch and ignores a late load', async () => {
    installPhilipsScenario();
    mockApi.warehouse1cAPI.getEmployeeCompareSummary.mockResolvedValue(philipsSummaryResponse());
    let resolveHub;
    mockApi.equipmentSearchAPI.getEmployeeEquipment.mockImplementation(
      () => new Promise((resolve) => { resolveHub = resolve; }),
    );

    renderDatabase();
    await expandPhilipsRows();
    expect(await screen.findAllByText('1С ✓')).toHaveLength(2);

    await openEmployeeDialog();
    expect(screen.getByRole('dialog', { name: 'Оборудование сотрудника' })).toBeInTheDocument();

    mockApi.databaseAPI.getCurrentDatabase.mockResolvedValue({ id: 'archive', name: 'Archive' });
    mockApi.warehouse1cAPI.getEmployeeCompareSummary.mockResolvedValue({
      meta: { status: 'ok', as_of: new Date().toISOString() },
      items: [],
    });
    await act(async () => {
      localStorage.setItem('selected_database', 'archive');
      window.dispatchEvent(new CustomEvent('database-changed', { detail: { databaseId: 'archive' } }));
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Оборудование сотрудника' })).not.toBeInTheDocument();
    });

    await act(async () => {
      resolveHub({ equipment: [] });
    });

    fireEvent.click(await screen.findByText('HQ'));
    fireEvent.click(await screen.findByText('Office'));
    await waitFor(() => {
      expect(screen.getByText('100021')).toBeInTheDocument();
    });
    expect(screen.queryByText('1С ✓')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-compare-status]')).toHaveLength(0);
  });
});
