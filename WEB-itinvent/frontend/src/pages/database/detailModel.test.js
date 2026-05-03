import { describe, expect, it } from 'vitest';

import {
  buildAddEquipmentDefaults,
  buildAddEquipmentPayload,
  buildAddEquipmentSuccessMessage,
  buildDetailActSummary,
  buildDetailFormState,
  buildDetailQrFileName,
  buildDetailUpdatePayload,
  createAddEquipmentInitialForm,
  formatDetailDate,
  formatDetailHistoryTransition,
  formatDetailHistoryValue,
  hasDetailFormChanges,
  normalizeDetailComparable,
  toGroupedItem,
  toItemId,
  toOwnerOption,
} from './detailModel';

describe('detailModel', () => {
  it('creates the add-equipment form defaults', () => {
    expect(createAddEquipmentInitialForm()).toEqual({
      employee_name: '',
      employee_no: null,
      employee_dept: '',
      branch_no: '',
      loc_no: '',
      type_no: '',
      model_name: '',
      model_no: null,
      status_no: '',
      serial_number: '',
      part_no: '',
      ip_address: '',
      description: '',
    });
  });

  it('builds add-equipment defaults from selected branch and status options', () => {
    expect(buildAddEquipmentDefaults({
      selectedBranch: '  северный филиал ',
      branchOptions: [
        { branch_no: 7, branch_name: 'Южный филиал' },
        { branch_no: 12, branch_name: 'Северный филиал' },
      ],
      statusOptions: [
        { status_no: 3, status_name: 'На складе' },
        { status_no: 8, status_name: 'В эксплуатации' },
      ],
    })).toEqual({
      ...createAddEquipmentInitialForm(),
      branch_no: '12',
      status_no: '8',
    });

    expect(buildAddEquipmentDefaults({
      selectedBranch: 'Неизвестный филиал',
      branchOptions: [{ branch_no: 2, branch_name: 'Основной филиал' }],
      statusOptions: [{ status_no: 4, status_name: 'Резерв' }],
    })).toMatchObject({
      branch_no: '',
      status_no: '4',
    });
  });

  it('validates add-equipment payload fields in route order', () => {
    const valid = {
      serial_number: 'SN-1',
      employee_name: 'Owner',
      type_no: '2',
      model_name: 'Model',
      status_no: '5',
      branch_no: '10',
      loc_no: '20',
    };

    expect(buildAddEquipmentPayload({}).error).toBe('Укажите серийный номер.');
    expect(buildAddEquipmentPayload({
      ...valid,
      employee_name: '',
      type_no: '',
      model_name: '',
      status_no: '',
      branch_no: '',
      loc_no: '',
    }).error).toBe('Выберите или введите сотрудника.');
    expect(buildAddEquipmentPayload({
      ...valid,
      type_no: '',
      model_name: '',
      status_no: '',
      branch_no: '',
      loc_no: '',
    }).error).toBe('Выберите тип оборудования.');
    expect(buildAddEquipmentPayload({
      ...valid,
      model_name: '',
      status_no: '',
      branch_no: '',
      loc_no: '',
    }).error).toBe('Укажите модель оборудования.');
    expect(buildAddEquipmentPayload({
      ...valid,
      status_no: '',
      branch_no: '',
      loc_no: '',
    }).error).toBe('Выберите статус оборудования.');
    expect(buildAddEquipmentPayload({
      ...valid,
      branch_no: '',
      loc_no: '',
    }).error).toBe('Выберите филиал.');
    expect(buildAddEquipmentPayload({
      ...valid,
      loc_no: '',
    }).error).toBe('Выберите местоположение.');
  });

  it('builds trimmed add-equipment payloads with undefined optional empties', () => {
    expect(buildAddEquipmentPayload({
      serial_number: ' SN-77 ',
      employee_name: '  Ivan Petrov  ',
      employee_no: '',
      employee_dept: '  IT  ',
      branch_no: 12,
      loc_no: ' 34 ',
      type_no: '2',
      model_name: '  Latitude 7440  ',
      model_no: '',
      status_no: '5',
      part_no: '   ',
      description: '  рабочее место  ',
      ip_address: '',
    })).toEqual({
      error: '',
      payload: {
        serial_no: 'SN-77',
        employee_name: 'Ivan Petrov',
        employee_no: undefined,
        employee_dept: 'IT',
        branch_no: '12',
        loc_no: '34',
        type_no: 2,
        model_name: 'Latitude 7440',
        model_no: undefined,
        status_no: 5,
        part_no: undefined,
        description: 'рабочее место',
        ip_address: undefined,
        hw_serial_no: undefined,
      },
    });
  });

  it('builds add-equipment success messages with inventory and extras', () => {
    expect(buildAddEquipmentSuccessMessage({
      inv_no: ' INV-100 ',
      created_owner: true,
      created_model: true,
    })).toBe('Оборудование добавлено. Инвентарный номер: INV-100 (создан сотрудник, создана модель).');

    expect(buildAddEquipmentSuccessMessage({
      inv_no: 'INV-101',
      created_model: true,
    })).toBe('Оборудование добавлено. Инвентарный номер: INV-101 (создана модель).');

    expect(buildAddEquipmentSuccessMessage({
      created_owner: true,
    })).toBe('Оборудование добавлено. (создан сотрудник)');

    expect(buildAddEquipmentSuccessMessage({})).toBe('Оборудование добавлено.');
  });

  it('normalizes owner options and item ids', () => {
    expect(toOwnerOption({
      OWNER_NO: '5',
      OWNER_DISPLAY_NAME: ' Ivan ',
      OWNER_DEPT: ' IT ',
    })).toEqual({
      owner_no: 5,
      owner_display_name: 'Ivan',
      owner_dept: 'IT',
    });
    expect(toItemId({ id: 77 })).toBe('77');
  });

  it('builds editable detail form state from mixed API fields', () => {
    expect(buildDetailFormState({
      TYPE_NO: '10',
      TYPE_NAME: 'PC',
      model_no: '20',
      MODEL_NAME: 'OptiPlex',
      SERIAL_NO: 'SN',
      HW_SERIAL_NO: 'HW',
      PART_NO: 'PN',
      DESCRIPTION: 'Desk device',
      STATUS_NO: '1',
      EMPL_NO: '9',
      OWNER_DISPLAY_NAME: 'Owner',
      OWNER_DEPT: 'IT',
      BRANCH_NO: 3,
      BRANCH_NAME: 'HQ',
      LOC_NO: 4,
      LOCATION_NAME: 'Office',
      IP_ADDRESS: '10.0.0.1',
      MAC_ADDRESS: 'AA',
      NETBIOS_NAME: 'HOST-1',
      DOMAIN_NAME: 'domain.local',
    })).toMatchObject({
      type_no: 10,
      model_no: 20,
      employee_name: 'Owner',
      branch_no: '3',
      loc_no: '4',
      network_name: 'HOST-1',
      domain_name: 'domain.local',
    });
  });

  it('maps API detail rows back into grouped equipment item shape', () => {
    expect(toGroupedItem({
      id: 1,
      inv_no: '1001',
      qty: '3',
      type_name: 'PC',
      model_name: 'OptiPlex',
      employee_name: 'Owner',
      location: 'Office',
      status: 'Active',
    })).toMatchObject({
      ID: 1,
      INV_NO: '1001',
      QTY: 3,
      TYPE_NAME: 'PC',
      MODEL_NAME: 'OptiPlex',
      OWNER_DISPLAY_NAME: 'Owner',
      LOCATION_NAME: 'Office',
      DESCR: 'Active',
    });
  });

  it('formats dates with empty and invalid fallbacks', () => {
    expect(formatDetailDate('')).toBe('-');
    expect(formatDetailDate(null)).toBe('-');
    expect(formatDetailDate('not-a-date')).toBe('not-a-date');
  });

  it('builds act summaries from mixed key shapes and fallbacks', () => {
    expect(buildDetailActSummary({
      DOC_NO: 10,
      doc_number: ' A-15 ',
      DOC_DATE: '2026-04-30',
      type_no: 3,
      branch_name: ' HQ ',
      LOCATION_NAME: ' Storage ',
      employee_name: ' Ivan ',
      ITEM_ID: ' 99 ',
      create_date: '2026-05-01',
      CREATE_USER_NAME: ' admin ',
      CH_DATE: '2026-05-02',
      ch_user: ' operator ',
      ADDINFO: '  extra details  ',
    })).toEqual({
      docNo: '10',
      docNumber: 'A-15',
      docDate: '2026-04-30',
      typeName: '3',
      branchName: 'HQ',
      locationName: 'Storage',
      employeeName: 'Ivan',
      itemId: '99',
      createDate: '2026-05-01',
      createUser: 'admin',
      changeDate: '2026-05-02',
      changeUser: 'operator',
      addInfo: 'extra details',
    });

    expect(buildDetailActSummary({ DOC_NO: ' ', ADD_INFO: '  note  ' })).toMatchObject({
      docNo: '-',
      docNumber: '-',
      addInfo: 'note',
    });
    expect(buildDetailActSummary(null)).toBeNull();
  });

  it('formats detail history values and transitions with fallbacks', () => {
    const row = {
      OLD_VALUE: ' old ',
      new_value: '',
    };

    expect(formatDetailHistoryValue(row, ['old_value', 'OLD_VALUE'])).toBe('old');
    expect(formatDetailHistoryValue(row, ['new_value', 'NEW_VALUE'])).toBe('-');
    expect(formatDetailHistoryValue(row, ['missing'])).toBe('-');
    expect(formatDetailHistoryTransition(row, ['OLD_VALUE'], ['new_value'])).toBe('old -> -');
  });

  it('normalizes comparable detail forms and detects changes', () => {
    const initial = {
      type_no: '10',
      model_no: 20,
      serial_no: ' SN ',
      hw_serial_no: null,
      part_no: ' PN ',
      ip_address: ' 10.0.0.1 ',
      mac_address: ' AA ',
      network_name: ' HOST ',
      description: ' Desk ',
      status_no: '1',
      empl_no: '9',
      branch_no: 3,
      loc_no: '4',
    };
    const same = {
      type_no: 10,
      model_no: '20',
      serial_no: 'SN',
      hw_serial_no: '',
      part_no: 'PN',
      ip_address: '10.0.0.1',
      mac_address: 'AA',
      network_name: 'HOST',
      description: 'Desk',
      status_no: 1,
      empl_no: 9,
      branch_no: '3',
      loc_no: 4,
    };

    expect(normalizeDetailComparable(initial)).toEqual({
      type_no: 10,
      model_no: 20,
      serial_no: 'SN',
      hw_serial_no: '',
      part_no: 'PN',
      ip_address: '10.0.0.1',
      mac_address: 'AA',
      network_name: 'HOST',
      description: 'Desk',
      status_no: 1,
      empl_no: 9,
      branch_no: '3',
      loc_no: '4',
    });
    expect(hasDetailFormChanges(same, initial)).toBe(false);
    expect(hasDetailFormChanges({ ...same, description: 'Different' }, initial)).toBe(true);
    expect(hasDetailFormChanges(null, initial)).toBe(false);
    expect(hasDetailFormChanges(same, null)).toBe(false);
  });

  it('builds empty detail update payloads when comparable forms did not change', () => {
    const initial = {
      type_no: 10,
      model_no: 20,
      serial_no: 'SN',
      hw_serial_no: '',
      part_no: 'PN',
      ip_address: '10.0.0.1',
      mac_address: 'AA',
      network_name: 'HOST',
      description: 'Desk',
      status_no: 1,
      empl_no: 9,
      branch_no: '3',
      loc_no: '4',
    };

    expect(buildDetailUpdatePayload({ ...initial }, initial)).toEqual({});
  });

  it('builds detail update payloads with changed fields only', () => {
    const initial = {
      type_no: 10,
      model_no: 20,
      serial_no: 'SN-1',
      hw_serial_no: 'HW-1',
      part_no: 'PN-1',
      ip_address: '10.0.0.1',
      mac_address: 'AA',
      network_name: 'HOST',
      description: 'Desk',
      status_no: 1,
      empl_no: 9,
      branch_no: '3',
      loc_no: '4',
    };
    const current = {
      ...initial,
      serial_no: ' SN-2 ',
      status_no: '2',
      description: 'Desk',
    };

    expect(buildDetailUpdatePayload(current, initial)).toEqual({
      serial_no: 'SN-2',
      status_no: 2,
    });
  });

  it('builds empty detail update payloads for null or empty inputs', () => {
    const form = {
      type_no: 10,
      model_no: 20,
      serial_no: 'SN',
      status_no: 1,
      branch_no: '3',
      loc_no: '4',
    };

    expect(buildDetailUpdatePayload(null, form)).toEqual({});
    expect(buildDetailUpdatePayload(form, null)).toEqual({});
    expect(buildDetailUpdatePayload({}, form)).toEqual({});
    expect(buildDetailUpdatePayload(form, {})).toEqual({});
  });

  it('keeps detail update payloads stable after trimming and numeric normalization', () => {
    const initial = {
      type_no: 10,
      model_no: 20,
      serial_no: 'SN',
      hw_serial_no: null,
      part_no: 'PN',
      ip_address: '10.0.0.1',
      mac_address: 'AA',
      network_name: 'HOST',
      description: 'Desk',
      status_no: 1,
      empl_no: 9,
      branch_no: 3,
      loc_no: '4',
    };
    const current = {
      type_no: '10',
      model_no: '20',
      serial_no: ' SN ',
      hw_serial_no: '',
      part_no: ' PN ',
      ip_address: ' 10.0.0.1 ',
      mac_address: ' AA ',
      network_name: ' HOST ',
      description: ' Desk ',
      status_no: '1',
      empl_no: '9',
      branch_no: '3',
      loc_no: 4,
    };

    expect(buildDetailUpdatePayload(current, initial)).toEqual({});
  });

  it('builds sanitized detail QR filenames with fallback', () => {
    expect(buildDetailQrFileName({ INV_NO: ' INV 12/34 ' })).toBe('qr_INV_12_34.png');
    expect(buildDetailQrFileName({ inv_no: 'abc-DEF_123' })).toBe('qr_abc-DEF_123.png');
    expect(buildDetailQrFileName({ INV_NO: ' ' })).toBe('qr_equipment.png');
    expect(buildDetailQrFileName(null)).toBe('qr_equipment.png');
  });
});
