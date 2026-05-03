import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { equipmentAPI } from '../../api/client';
import { useDatabaseDetailRuntime } from './useDatabaseDetailRuntime';

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,qr'),
  },
}));

vi.mock('../../api/client', () => ({
  API_V1_BASE: '/api/v1',
  equipmentAPI: {
    getByInvNos: vi.fn(),
    getEquipmentActs: vi.fn(),
    getEquipmentHistory: vi.fn(),
    updateByInvNo: vi.fn(),
  },
}));

const detailItem = {
  ID: 1,
  INV_NO: '1001',
  TYPE_NO: 10,
  TYPE_NAME: 'PC',
  MODEL_NO: 20,
  MODEL_NAME: 'OptiPlex',
  SERIAL_NO: 'SN-1',
  HW_SERIAL_NO: 'HW-1',
  PART_NO: 'PN-1',
  IP_ADDRESS: '10.0.0.1',
  MAC_ADDRESS: '00:11:22:33:44:55',
  NETWORK_NAME: 'PC-1',
  DOMAIN_NAME: 'corp.local',
  STATUS_NO: 1,
  DESCR: 'In use',
  EMPL_NO: 5,
  OWNER_DISPLAY_NAME: 'Ivan Petrov',
  OWNER_DEPT: 'IT',
  BRANCH_NO: 'b1',
  BRANCH_NAME: 'HQ',
  LOC_NO: 'l1',
  LOCATION_NAME: 'Office',
  VENDOR_NAME: 'Dell',
  DESCRIPTION: 'Workstation',
};

const updatedItem = {
  ...detailItem,
  SERIAL_NO: 'SN-2',
  BRANCH_NAME: 'HQ',
  LOCATION_NAME: 'Office',
};

const grouped = {
  HQ: {
    Office: [
      { INV_NO: '1001', MODEL_NAME: 'Old', SERIAL_NO: 'SN-1' },
      { INV_NO: '1002', MODEL_NAME: 'ThinkCentre' },
    ],
  },
};

const createStateSetter = (initialValue) => {
  let value = initialValue;
  const setter = vi.fn((next) => {
    value = typeof next === 'function' ? next(value) : next;
  });
  return { setter, get value() { return value; } };
};

const renderDetailHook = (options = {}) => {
  const props = {
    canDatabaseWrite: true,
    findEquipmentByInvNo: vi.fn((invNo) => (String(invNo) === '1001' ? detailItem : null)),
    searchOwnersCached: vi.fn(),
    getLocationsCached: vi.fn(),
    getModelsCached: vi.fn(),
    ...options,
  };
  return renderHook(() => useDatabaseDetailRuntime(props));
};

const openLoadedDetail = async (result, item = detailItem) => {
  act(() => {
    result.current.openDetailView(item);
  });
  await waitFor(() => {
    expect(result.current.detailForm?.serial_no).toBe(item.SERIAL_NO);
  });
};

describe('useDatabaseDetailRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    equipmentAPI.getByInvNos.mockResolvedValue({ equipment: [detailItem] });
    equipmentAPI.getEquipmentActs.mockResolvedValue({ acts: [] });
    equipmentAPI.getEquipmentHistory.mockResolvedValue({ history: [] });
    equipmentAPI.updateByInvNo.mockResolvedValue(updatedItem);
  });

  it('opens detail view and resets transient detail state for the next item', async () => {
    const { result } = renderDetailHook();
    await openLoadedDetail(result);

    act(() => {
      result.current.startDetailEdit();
      result.current.patchDetailForm({ serial_no: 'changed' });
      result.current.setDetailTab('acts');
      result.current.setDetailActs([{ DOC_NO: 'A-1' }]);
      result.current.setDetailActsError('acts failed');
      result.current.setDetailQrOpen(true);
      result.current.handleOpenActFields({ DOC_NO: 'A-1' });
    });

    act(() => {
      result.current.openDetailView('2002');
    });

    expect(result.current.detailModal).toEqual({
      open: true,
      data: null,
      loading: true,
      invNo: '2002',
    });
    expect(result.current.detailEditMode).toBe(false);
    expect(result.current.detailForm).toBeNull();
    expect(result.current.detailTab).toBe('general');
    expect(result.current.detailActs).toEqual([]);
    expect(result.current.detailActsError).toBe('');
    expect(result.current.detailQrOpen).toBe(false);
    expect(result.current.detailActFieldsOpen).toBe(false);
    expect(result.current.detailActSelected).toBeNull();

    await waitFor(() => {
      expect(result.current.detailModal.loading).toBe(false);
    });
  });

  it('blocks save when a changed branch has no location selected', async () => {
    const { result } = renderDetailHook();
    await openLoadedDetail(result);

    act(() => {
      result.current.startDetailEdit();
      result.current.patchDetailForm({ branch_no: 'b2', loc_no: null });
    });
    await waitFor(() => {
      expect(result.current.detailForm.branch_no).toBe('b2');
      expect(result.current.detailForm.loc_no).toBeNull();
    });
    act(() => {
      void result.current.handleDetailSave();
    });

    expect(equipmentAPI.updateByInvNo).not.toHaveBeenCalled();
    expect(result.current.detailEditMode).toBe(true);
    expect(result.current.detailError).toContain('местоположение');
  });

  it('exits edit mode without API call when there are no detail changes', async () => {
    const { result } = renderDetailHook();
    await openLoadedDetail(result);

    act(() => {
      result.current.startDetailEdit();
    });
    act(() => {
      void result.current.handleDetailSave();
    });

    expect(equipmentAPI.updateByInvNo).not.toHaveBeenCalled();
    expect(result.current.detailEditMode).toBe(false);
    expect(result.current.detailError).toBe('');
  });

  it('saves changes and upserts the updated equipment into grouped state', async () => {
    const allEquipment = createStateSetter(grouped);
    const { result } = renderDetailHook({ setAllEquipment: allEquipment.setter });
    await openLoadedDetail(result);

    act(() => {
      result.current.startDetailEdit();
      result.current.patchDetailForm({ serial_no: 'SN-2' });
    });
    await waitFor(() => {
      expect(result.current.detailForm.serial_no).toBe('SN-2');
    });
    act(() => {
      void result.current.handleDetailSave();
    });
    await waitFor(() => {
      expect(equipmentAPI.updateByInvNo).toHaveBeenCalledWith('1001', { serial_no: 'SN-2' });
    });

    expect(result.current.detailModal.data).toEqual(updatedItem);
    expect(result.current.detailForm.serial_no).toBe('SN-2');
    expect(result.current.detailEditMode).toBe(false);
    expect(result.current.detailSuccess).toBe('Изменения сохранены.');
    expect(allEquipment.value.HQ.Office[0]).toMatchObject({
      INV_NO: '1001',
      SERIAL_NO: 'SN-2',
      MODEL_NAME: 'OptiPlex',
    });
    expect(allEquipment.value.HQ.Office).toHaveLength(2);
  });

  it('guards Enter save from autocomplete/listbox targets', async () => {
    const { result } = renderDetailHook();
    await openLoadedDetail(result);

    act(() => {
      result.current.startDetailEdit();
      result.current.patchDetailForm({ serial_no: 'SN-2' });
    });
    await waitFor(() => {
      expect(result.current.detailForm.serial_no).toBe('SN-2');
    });

    const event = {
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      target: {
        tagName: 'INPUT',
        isContentEditable: false,
        getAttribute: vi.fn(() => 'combobox'),
        closest: vi.fn(() => null),
      },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    act(() => {
      result.current.handleDetailEditKeyDown(event);
    });

    expect(equipmentAPI.updateByInvNo).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it('opens equipment act file with item, inventory and database URL params', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({});
    window.localStorage.setItem('selected_database', ' main-db ');
    const { result } = renderDetailHook();
    await openLoadedDetail(result);

    act(() => {
      result.current.handleOpenEquipmentActFile({
        DOC_NO: 'DOC 77',
        ITEM_ID: '42',
      });
    });

    expect(openSpy).toHaveBeenCalledWith(
      expect.any(String),
      '_blank',
      'noopener,noreferrer'
    );
    const openedUrl = new URL(openSpy.mock.calls[0][0]);
    expect(openedUrl.pathname).toBe('/api/v1/equipment/acts/DOC%2077/file');
    expect(openedUrl.searchParams.get('item_id')).toBe('42');
    expect(openedUrl.searchParams.get('inv_no')).toBe('1001');
    expect(openedUrl.searchParams.get('db_id')).toBe('main-db');
    expect(result.current.detailActsError).toBe('');
    expect(result.current.detailActOpeningDocNo).toBe('');

    openSpy.mockRestore();
  });
});
