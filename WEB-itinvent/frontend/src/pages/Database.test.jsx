import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearSWRCache } from '../lib/swrCache';

const mockApi = vi.hoisted(() => ({
  equipmentAPI: {
    getTypes: vi.fn(),
    getStatuses: vi.fn(),
    getBranchesList: vi.fn(),
    getAllEquipmentGrouped: vi.fn(),
    getAllConsumablesGrouped: vi.fn(),
    identifyWorkspace: vi.fn(),
  },
  databaseAPI: {
    getCurrentDatabase: vi.fn(),
    getAvailableDatabases: vi.fn(),
  },
}));

vi.mock('../api/client', () => ({
  equipmentAPI: mockApi.equipmentAPI,
  databaseAPI: mockApi.databaseAPI,
  API_V1_BASE: '/api/v1',
}));

vi.mock('../api/json_client', () => ({
  default: {},
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'admin', username: 'admin' },
    hasPermission: (permission) => permission === 'database.read' || permission === 'database.write',
  }),
}));

vi.mock('../contexts/NotificationContext', () => ({
  useNotification: () => ({
    notifySuccess: vi.fn(),
    notifyInfo: vi.fn(),
    notifyWarning: vi.fn(),
    notifyError: vi.fn(),
  }),
}));

vi.mock('../components/layout/MainLayout', () => ({
  default: ({ children, headerMode = 'default' }) => (
    <div data-testid="main-layout" data-header-mode={headerMode}>
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
  ActionMenu: () => <button type="button">actions</button>,
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
  clearUploadActReminderSearch,
  default as Database,
  getUploadActReminderDeepLinkAction,
  getEquipmentRowActions,
  isUploadActCommitDisabled,
  parseInvNosInput,
  parseUploadActReminderDeepLink,
  resolveDataModeRefreshBehavior,
  removeItemFromGrouped,
} from './Database';

function renderDatabase() {
  return render(
    <MemoryRouter initialEntries={['/database']}>
      <Database />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  clearSWRCache();
  installMatchMedia({ mobile: false });
  localStorage.clear();

  mockApi.databaseAPI.getCurrentDatabase.mockResolvedValue({
    id: 'main',
    name: 'Основная база',
  });
  mockApi.databaseAPI.getAvailableDatabases.mockResolvedValue([
    { id: 'main', name: 'Основная база' },
  ]);
  mockApi.equipmentAPI.getTypes.mockResolvedValue([]);
  mockApi.equipmentAPI.getStatuses.mockResolvedValue([]);
  mockApi.equipmentAPI.getBranchesList.mockResolvedValue([
    { BRANCH_NO: 1, BRANCH_NAME: 'HQ' },
    { BRANCH_NO: 2, BRANCH_NAME: 'Remote' },
  ]);
  mockApi.equipmentAPI.identifyWorkspace.mockResolvedValue({
    success: false,
    message: 'not found',
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
            TYPE_NAME: 'ПК',
            MODEL_NAME: 'OptiPlex',
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

describe('Database equipment row helpers', () => {
  it('shows desktop quick actions outside the mobile FAB', async () => {
    renderDatabase();

    expect(await screen.findByRole('button', { name: 'QR Сканер' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Загрузить акт' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Добавить оборудование' })).toBeInTheDocument();
  });

  it('shows the remaining desktop toolbar actions from the mobile FAB', async () => {
    renderDatabase();

    expect(await screen.findByRole('button', { name: 'Определить ПК' })).toBeInTheDocument();
    expect((await screen.findAllByText('Филиал')).length).toBeGreaterThan(0);
    expect(await screen.findByRole('button', { name: /Загрузить ещё/ })).toBeInTheDocument();

    fireEvent.click(screen.getByText('HQ'));

    expect(await screen.findByRole('button', { name: 'Свернуть разделы' })).toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: 'QR Сканер' })).not.toBeInTheDocument();
  });

  it('adds delete action only for admins in equipment mode', () => {
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
      isAdmin: true,
    })).toContain('delete');

    expect(getEquipmentRowActions({
      item,
      dataMode: 'equipment',
      canWrite: true,
      isAdmin: false,
    })).not.toContain('delete');

    expect(getEquipmentRowActions({
      item,
      dataMode: 'consumables',
      canWrite: true,
      isAdmin: true,
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
});
