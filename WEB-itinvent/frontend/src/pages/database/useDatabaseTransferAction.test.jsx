import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { equipmentAPI } from '../../api/client';
import { TRANSFER_OPERATION_ACT_ONLY, TRANSFER_OPERATION_MOVE } from './equipmentModel';
import { useDatabaseTransferAction } from './useDatabaseTransferAction';

vi.mock('../../api/client', () => ({
  equipmentAPI: {
    createTransferActOnly: vi.fn(),
    downloadTransferAct: vi.fn(),
    getTransferActJob: vi.fn(),
    sendTransferActsEmail: vi.fn(),
    transfer: vi.fn(),
  },
}));

const actionModal = { open: false, type: 'transfer', invNo: '1001', componentKind: null };

const createProps = (overrides = {}) => ({
  actionModal,
  canDatabaseWrite: true,
  selectedItems: [],
  branchOptions: [
    { branch_no: '10', branch_name: 'HQ' },
  ],
  findEquipmentByInvNo: vi.fn(() => ({
    INV_NO: '1001',
    BRANCH_NAME: 'HQ',
    LOCATION_NAME: 'Office',
    BRANCH_NO: '10',
    LOC_NO: '20',
  })),
  searchOwnersCached: vi.fn().mockResolvedValue({ owners: [] }),
  getOwnerDepartmentsCached: vi.fn().mockResolvedValue({ departments: ['IT'] }),
  getLocationsCached: vi.fn().mockResolvedValue([{ LOC_NO: '20', LOC_NAME: 'Office' }]),
  fetchAllEquipment: vi.fn(),
  setActionError: vi.fn(),
  setSelectedItems: vi.fn(),
  detailInvNo: '1001',
  resetDetailHistory: vi.fn(),
  navigate: vi.fn(),
  openUploadActModalForReminder: vi.fn(),
  ...overrides,
});

describe('useDatabaseTransferAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resets transfer state and cancels active polling', () => {
    const props = createProps();
    const { result } = renderHook(() => useDatabaseTransferAction(props));

    act(() => {
      result.current.transferActionHandlers.onModeChange(TRANSFER_OPERATION_ACT_ONLY);
      result.current.setTransferResult({ acts: [{ act_id: 1 }] });
      result.current.setTransferEmailMode('manual');
      result.current.setTransferManualEmail('user@example.com');
      result.current.resetTransferState();
    });

    expect(result.current.transferOperationMode).toBe(TRANSFER_OPERATION_MOVE);
    expect(result.current.newEmployee).toBe('');
    expect(result.current.transferEmployeeInput).toBe('');
    expect(result.current.transferResult).toBeNull();
    expect(result.current.transferJobPolling).toBe(false);
    expect(result.current.transferEmailMode).toBe('old');
    expect(result.current.transferManualEmail).toBe('');
  });

  it('switches mode and prepares act-only employee defaults', () => {
    const props = createProps();
    const { result } = renderHook(() => useDatabaseTransferAction(props));

    act(() => {
      result.current.setTransferResult({ acts: [{ act_id: 1 }] });
      result.current.transferActionHandlers.onModeChange(TRANSFER_OPERATION_ACT_ONLY);
    });

    expect(result.current.transferOperationMode).toBe(TRANSFER_OPERATION_ACT_ONLY);
    expect(result.current.transferResult).toBeNull();
    expect(result.current.newEmployee).toBeTruthy();
    expect(result.current.transferEmployeeInput).toBe(result.current.newEmployee);
    expect(props.setActionError).toHaveBeenCalledWith('');
  });

  it('validates created employees before accepting manual owner input', () => {
    const props = createProps();
    const { result } = renderHook(() => useDatabaseTransferAction(props));

    act(() => {
      result.current.transferActionHandlers.onEmployeeInputChange('A<bad');
      result.current.transferActionHandlers.onCreateEmployee();
    });

    expect(result.current.newEmployee).toBe('');
    expect(props.setActionError).toHaveBeenLastCalledWith(expect.stringContaining('ФИО'));

    act(() => {
      result.current.transferActionHandlers.onEmployeeInputChange('Ivan Petrov');
    });
    act(() => {
      result.current.transferActionHandlers.onCreateEmployee();
    });

    expect(result.current.newEmployee).toBe('Ivan Petrov');
    expect(result.current.newEmployeeNo).toBeNull();
    expect(props.setActionError).toHaveBeenLastCalledWith('');
  });

  it('surfaces email payload errors and sends a valid manual email payload', async () => {
    equipmentAPI.sendTransferActsEmail.mockResolvedValue({
      success_count: 1,
      failed_count: 0,
      errors: [],
    });
    const props = createProps();
    const { result } = renderHook(() => useDatabaseTransferAction(props));

    act(() => {
      result.current.setTransferResult({ acts: [{ act_id: 77 }] });
      result.current.transferActionHandlers.onEmailModeChange('manual');
    });

    await act(async () => {
      await result.current.transferActionHandlers.onSendEmail();
    });

    expect(equipmentAPI.sendTransferActsEmail).not.toHaveBeenCalled();
    expect(result.current.transferEmailError).toBeTruthy();

    act(() => {
      result.current.transferActionHandlers.onManualEmailChange('user@example.com');
    });
    await act(async () => {
      await result.current.transferActionHandlers.onSendEmail();
    });

    expect(equipmentAPI.sendTransferActsEmail).toHaveBeenCalledWith({
      act_ids: [77],
      mode: 'manual',
      manual_email: 'user@example.com',
    });
    expect(result.current.transferEmailStatus).toContain('1');
    expect(result.current.transferEmailError).toBe('');
  });

  it('refreshes equipment and detail history when polling finishes successfully', async () => {
    equipmentAPI.getTransferActJob.mockResolvedValue({
      job_status: 'done',
      success_count: 1,
      failed_count: 0,
      acts: [{ act_id: 88 }],
    });
    const props = createProps();
    const { result } = renderHook(() => useDatabaseTransferAction(props));

    await act(async () => {
      await result.current.pollTransferActJob('job-1', {
        refreshEquipment: true,
        targetInvNos: ['1001'],
        pollDelayMs: 0,
        maxAttempts: 1,
      });
    });

    expect(equipmentAPI.getTransferActJob).toHaveBeenCalledWith('job-1');
    expect(result.current.transferResult).toMatchObject({ job_status: 'done' });
    expect(result.current.transferJobPolling).toBe(false);
    expect(props.resetDetailHistory).toHaveBeenCalled();
    expect(props.fetchAllEquipment).toHaveBeenCalledWith({ force: true });
    expect(props.setActionError).toHaveBeenLastCalledWith('');
  });
});
