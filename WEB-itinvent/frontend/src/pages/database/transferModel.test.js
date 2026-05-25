import { describe, expect, it } from 'vitest';

import {
  TRANSFER_OPERATION_ACT_ONLY,
  TRANSFER_OPERATION_LOCATION_ONLY,
  TRANSFER_OPERATION_MOVE,
} from './equipmentModel';
import {
  buildTransferActOnlyPayload,
  buildTransferEmailPayload,
  buildTransferEmployeeInputState,
  buildTransferLocationPayload,
  buildTransferMovePayload,
  buildTransferSourceDefaults,
  getSelectedTransferEmployeeOption,
  getTransferEmptyTargetError,
  getTransferResultActionError,
  isTransferJobPending,
  validateTransferEmployeeName,
} from './transferModel';

describe('transferModel', () => {
  it('builds empty transfer source defaults when no items are selected', () => {
    expect(buildTransferSourceDefaults({
      items: [],
      branchOptions: [{ branch_no: 10, branch_name: 'Main' }],
    })).toEqual({
      branch_no: null,
      loc_no: null,
      branch_name: '',
      location_name: '',
      mixed_branch: false,
      mixed_location: false,
    });
  });

  it('uses a matched branch option id over the raw source branch id', () => {
    expect(buildTransferSourceDefaults({
      items: [{
        BRANCH_NAME: ' Main Office ',
        LOCATION_NAME: 'Warehouse',
        BRANCH_NO: 1,
        LOC_NO: '22',
      }],
      branchOptions: [{ branch_no: 99, branch_name: 'main office' }],
    })).toMatchObject({
      branch_no: 99,
      loc_no: '22',
      branch_name: 'Main Office',
      location_name: 'Warehouse',
      mixed_branch: false,
      mixed_location: false,
    });
  });

  it('falls back to the raw source branch id when no branch option matches', () => {
    expect(buildTransferSourceDefaults({
      items: [{
        branch_name: 'Remote',
        location_name: 'Room 1',
        branch_no: '15',
        loc_no: '25',
      }],
      branchOptions: [{ branch_no: 99, branch_name: 'Main' }],
    })).toMatchObject({
      branch_no: '15',
      loc_no: '25',
      branch_name: 'Remote',
      location_name: 'Room 1',
    });
  });

  it('preserves non-numeric raw source ids for compatibility with string keys', () => {
    expect(buildTransferSourceDefaults({
      items: [{
        branch_name: 'Remote',
        location_name: 'Locker',
        branch_no: 'B-15',
        loc_no: 'L-25',
      }],
      branchOptions: [],
    })).toMatchObject({
      branch_no: 'B-15',
      loc_no: 'L-25',
      branch_name: 'Remote',
      location_name: 'Locker',
    });
  });

  it('marks mixed branch and location names across source items', () => {
    expect(buildTransferSourceDefaults({
      items: [
        {
          BRANCH_NAME: 'Main',
          LOCATION: 'Warehouse',
          BRANCH_NO: 10,
          LOC_NO: 20,
        },
        {
          branch_name: 'Remote',
          location: 'Office',
          branch_no: 11,
          loc_no: 21,
        },
      ],
      branchOptions: [{ branch_no: 10, branch_name: 'Main' }],
    })).toMatchObject({
      branch_no: 10,
      loc_no: '20',
      branch_name: 'Main',
      location_name: 'Warehouse',
      mixed_branch: true,
      mixed_location: true,
    });
  });

  it('selects an existing employee option or falls back to the current employee', () => {
    const options = [
      { OWNER_NO: 7, OWNER_DISPLAY_NAME: 'Ivan Petrov', OWNER_DEPT: 'IT' },
    ];

    expect(getSelectedTransferEmployeeOption({
      employeeNo: '7',
      employeeName: 'Ignored',
      employeeOptions: options,
    })).toBe(options[0]);

    expect(getSelectedTransferEmployeeOption({
      employeeNo: '9',
      employeeName: 'Manual Owner',
      employeeOptions: options,
    })).toEqual({
      OWNER_NO: '9',
      OWNER_DISPLAY_NAME: 'Manual Owner',
      OWNER_DEPT: '',
    });
  });

  it('derives create-option state for manual transfer employees', () => {
    expect(buildTransferEmployeeInputState({
      operationMode: TRANSFER_OPERATION_MOVE,
      transferResult: null,
      employeeNo: null,
      employeeName: '',
      employeeInput: '  New Person  ',
      employeeOptions: [],
    })).toMatchObject({
      inputTrimmed: 'New Person',
      hasExactMatch: false,
      canAdd: true,
      usesManualEmployee: false,
      autocompleteOptions: [{
        __create: true,
        OWNER_NO: null,
        OWNER_DISPLAY_NAME: 'New Person',
        OWNER_DEPT: '',
      }],
    });
  });

  it('blocks employee create-option for exact matches, selected owners, results and act-only mode', () => {
    const options = [{ OWNER_NO: 2, OWNER_DISPLAY_NAME: 'Ivan Petrov', OWNER_DEPT: 'IT' }];

    expect(buildTransferEmployeeInputState({
      operationMode: TRANSFER_OPERATION_MOVE,
      transferResult: null,
      employeeNo: null,
      employeeName: '',
      employeeInput: ' ivan petrov ',
      employeeOptions: options,
    }).canAdd).toBe(false);

    expect(buildTransferEmployeeInputState({
      operationMode: TRANSFER_OPERATION_MOVE,
      transferResult: null,
      employeeNo: 2,
      employeeName: 'Ivan Petrov',
      employeeInput: 'Other Person',
      employeeOptions: [],
    }).canAdd).toBe(false);

    expect(buildTransferEmployeeInputState({
      operationMode: TRANSFER_OPERATION_MOVE,
      transferResult: { success_count: 1 },
      employeeNo: null,
      employeeName: '',
      employeeInput: 'Other Person',
      employeeOptions: [],
    }).canAdd).toBe(false);

    expect(buildTransferEmployeeInputState({
      operationMode: TRANSFER_OPERATION_ACT_ONLY,
      transferResult: null,
      employeeNo: null,
      employeeName: '',
      employeeInput: 'Other Person',
      employeeOptions: [],
    }).canAdd).toBe(false);
  });

  it('builds transfer move payloads for existing and manual employees', () => {
    expect(buildTransferMovePayload({
      targetInvNos: ['1001'],
      employeeName: 'Ivan Petrov',
      employeeNo: 2,
      department: '',
      branchNo: '10',
      locationNo: '20',
    })).toEqual({
      error: '',
      payload: {
        inv_nos: ['1001'],
        new_employee: 'Ivan Petrov',
        new_employee_no: 2,
        new_employee_dept: undefined,
        branch_no: '10',
        loc_no: '20',
      },
    });

    expect(buildTransferMovePayload({
      targetInvNos: ['1001', '1002'],
      employeeName: 'New Person',
      employeeNo: null,
      department: 'IT',
      branchNo: '10',
      locationNo: '20',
    }).payload).toEqual({
      inv_nos: ['1001', '1002'],
      new_employee: 'New Person',
      new_employee_no: undefined,
      new_employee_dept: 'IT',
      branch_no: '10',
      loc_no: '20',
    });
  });

  it('builds location-only transfer payloads and validates required destination', () => {
    expect(buildTransferLocationPayload({
      targetInvNos: ['1001', '1002'],
      branchNo: '10',
      locationNo: '20',
    })).toEqual({
      error: '',
      payload: {
        inv_nos: ['1001', '1002'],
        branch_no: '10',
        loc_no: '20',
      },
    });

    expect(buildTransferLocationPayload({
      targetInvNos: [],
      branchNo: '10',
      locationNo: '20',
    }).error).toBe(getTransferEmptyTargetError(TRANSFER_OPERATION_LOCATION_ONLY));

    expect(buildTransferLocationPayload({
      targetInvNos: ['1001'],
      branchNo: '',
      locationNo: '20',
    }).error).toBe('Выберите филиал назначения из списка.');

    expect(buildTransferLocationPayload({
      targetInvNos: ['1001'],
      branchNo: '10',
      locationNo: '',
    }).error).toBe('Выберите местоположение назначения из списка.');
  });

  it('returns current validation messages for invalid transfer move input', () => {
    expect(buildTransferMovePayload({
      targetInvNos: [],
      employeeName: '',
      employeeNo: null,
      department: '',
      branchNo: '',
      locationNo: '',
    }).error).toBe(getTransferEmptyTargetError(TRANSFER_OPERATION_MOVE));

    expect(buildTransferMovePayload({
      targetInvNos: ['1001'],
      employeeName: '',
      employeeNo: null,
      department: '',
      branchNo: '10',
      locationNo: '20',
    }).error).toBe('Выберите сотрудника из списка или нажмите "Добавить сотрудника".');

    expect(buildTransferMovePayload({
      targetInvNos: ['1001'],
      employeeName: 'DROP TABLE users',
      employeeNo: null,
      department: 'IT',
      branchNo: '10',
      locationNo: '20',
    }).error).toBe('Некорректное ФИО нового сотрудника.');
  });

  it('builds act-only payloads and validates issuer', () => {
    expect(buildTransferActOnlyPayload({
      targetInvNos: ['1001'],
      issuerName: '  Ivan Petrov  ',
      issuerOwnerNo: 5,
    })).toEqual({
      error: '',
      payload: {
        inv_nos: ['1001'],
        issuer_employee: 'Ivan Petrov',
        issuer_owner_no: 5,
      },
    });

    expect(buildTransferActOnlyPayload({
      targetInvNos: ['1001'],
      issuerName: '',
      issuerOwnerNo: null,
    }).error).toBe('Укажите, кто выдал технику.');
  });

  it('builds transfer email payloads for default, manual and employee modes', () => {
    const acts = [{ act_id: 11 }, { act_id: 12 }];

    expect(buildTransferEmailPayload({
      acts,
      mode: 'new',
      manualEmail: '',
      recipient: null,
    }).payload).toEqual({
      act_ids: [11, 12],
      mode: 'new',
    });

    expect(buildTransferEmailPayload({
      acts,
      mode: 'manual',
      manualEmail: ' user@example.com ',
      recipient: null,
    }).payload).toEqual({
      act_ids: [11, 12],
      mode: 'manual',
      manual_email: 'user@example.com',
    });

    expect(buildTransferEmailPayload({
      acts,
      mode: 'employee',
      manualEmail: '',
      recipient: { OWNER_NO: '42' },
    }).payload).toEqual({
      act_ids: [11, 12],
      mode: 'employee',
      owner_no: 42,
    });
  });

  it('keeps transfer email validation and job/result helpers stable', () => {
    expect(buildTransferEmailPayload({
      acts: [{ act_id: 1 }],
      mode: 'manual',
      manualEmail: '',
      recipient: null,
    }).error).toBe('Введите email получателя.');

    expect(buildTransferEmailPayload({
      acts: [{ act_id: 1 }],
      mode: 'employee',
      manualEmail: '',
      recipient: null,
    }).error).toBe('Выберите сотрудника-получателя.');

    expect(isTransferJobPending({ job_id: 'abc', job_status: 'queued' })).toBe(true);
    expect(isTransferJobPending({ job_id: 'abc', job_status: 'done' })).toBe(false);
    expect(getTransferResultActionError({ success_count: 2, failed_count: 1 }, 'Перенесено'))
      .toBe('Перенесено 2, ошибок 1');
  });

  it('validates transfer employee names defensively', () => {
    expect(validateTransferEmployeeName('Ivan Petrov')).toBe(true);
    expect(validateTransferEmployeeName('A')).toBe(false);
    expect(validateTransferEmployeeName('Ivan <script>')).toBe(false);
    expect(validateTransferEmployeeName('SELECT Ivan')).toBe(false);
  });
});
