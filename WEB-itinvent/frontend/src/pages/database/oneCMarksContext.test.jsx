import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { equipmentOneCMarksAPI } from '../../api/equipmentOneCMarks';
import { useEquipmentOneCMarks } from './oneCMarksContext';

vi.mock('../../api/equipmentOneCMarks', () => ({
  equipmentOneCMarksAPI: { list: vi.fn(), set: vi.fn(), clear: vi.fn() },
}));

const MARK = { inv_no: '1001', marked_by: 'admin', marked_at: '2026-10-20T08:00:00Z', note: '' };

describe('useEquipmentOneCMarks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    equipmentOneCMarksAPI.list.mockResolvedValue({});
  });

  it('sets and clears a mark by patching the local map, without reloading the list', async () => {
    equipmentOneCMarksAPI.set.mockResolvedValue(MARK);
    equipmentOneCMarksAPI.clear.mockResolvedValue(true);
    const notifySuccess = vi.fn();
    const { result } = renderHook(() => useEquipmentOneCMarks({ dbKey: 'OBJ', canMark: true, notifySuccess }));
    await waitFor(() => expect(equipmentOneCMarksAPI.list).toHaveBeenCalledTimes(1));

    await act(async () => { await result.current.applyAction('one_c_mark', { INV_NO: '1001.0' }); });
    expect(equipmentOneCMarksAPI.set).toHaveBeenCalledWith('1001');
    expect(result.current.value.marks).toEqual({ 1001: MARK });

    await act(async () => { await result.current.applyAction('one_c_unmark', '1001'); });
    expect(equipmentOneCMarksAPI.clear).toHaveBeenCalledWith('1001');
    expect(result.current.value.marks).toEqual({});
    expect(notifySuccess).toHaveBeenCalledTimes(2);
    expect(equipmentOneCMarksAPI.list).toHaveBeenCalledTimes(1);
  });

  it('leaves the map untouched and reports the server message when saving fails', async () => {
    equipmentOneCMarksAPI.set.mockRejectedValue({ response: { data: { detail: 'Хранилище недоступно' } } });
    const notifyError = vi.fn();
    const { result } = renderHook(() => useEquipmentOneCMarks({ dbKey: 'OBJ', canMark: true, notifyError }));
    await waitFor(() => expect(equipmentOneCMarksAPI.list).toHaveBeenCalled());

    await act(async () => { await result.current.applyAction('one_c_mark', '1001'); });

    expect(result.current.value.marks).toEqual({});
    expect(notifyError).toHaveBeenCalledWith('Хранилище недоступно');
  });

  it('does nothing without the permission', async () => {
    const { result } = renderHook(() => useEquipmentOneCMarks({ dbKey: 'OBJ', canMark: false }));
    await waitFor(() => expect(equipmentOneCMarksAPI.list).toHaveBeenCalled());

    await act(async () => { await result.current.applyAction('one_c_mark', '1001'); });

    expect(equipmentOneCMarksAPI.set).not.toHaveBeenCalled();
  });
});
