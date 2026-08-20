import { describe, expect, it } from 'vitest';

import { buildPcCleaningPayload, filterRemainingPcs, readRemainingPcs } from './pcRemaining';

const SAMPLE = [
  {
    inv_no: '1001',
    serial_no: 'SN-AAA',
    hw_serial_no: '',
    location: 'Кабинет 12',
    model_name: 'HP ProDesk',
    employee: 'Иванов',
  },
  {
    inv_no: '1002',
    serial_no: 'SN-BBB',
    hw_serial_no: 'HW-2',
    location: 'Склад',
    model_name: 'Lenovo ThinkCentre',
    employee: 'Петров',
  },
];

describe('filterRemainingPcs', () => {
  it('returns the original list when query is empty', () => {
    expect(filterRemainingPcs(SAMPLE, '  ')).toEqual(SAMPLE);
  });

  it('filters by inventory number, serial, location and employee', () => {
    expect(filterRemainingPcs(SAMPLE, '1001').map((row) => row.inv_no)).toEqual(['1001']);
    expect(filterRemainingPcs(SAMPLE, 'sn-bbb').map((row) => row.inv_no)).toEqual(['1002']);
    expect(filterRemainingPcs(SAMPLE, 'кабинет').map((row) => row.inv_no)).toEqual(['1001']);
    expect(filterRemainingPcs(SAMPLE, 'петров').map((row) => row.inv_no)).toEqual(['1002']);
  });

  it('treats a missing list as empty', () => {
    expect(filterRemainingPcs(null, 'pc')).toEqual([]);
  });
});

describe('readRemainingPcs', () => {
  it('reads remaining_pcs from a statistics row or axios payload', () => {
    expect(readRemainingPcs({ remaining_pcs: SAMPLE })).toEqual(SAMPLE);
    expect(readRemainingPcs({ data: { remaining_pcs: SAMPLE } })).toEqual(SAMPLE);
    expect(readRemainingPcs({ remaining_pc: 4 })).toEqual([]);
  });
});

describe('buildPcCleaningPayload', () => {
  it('builds a cleaning payload from a remaining PC row', () => {
    expect(buildPcCleaningPayload(SAMPLE[1], { branch: 'Москва', dbName: 'main' })).toEqual({
      payload: {
        serial_number: 'SN-BBB',
        employee: 'Петров',
        branch: 'Москва',
        location: 'Склад',
        inv_no: '1002',
        db_name: 'main',
        hw_serial_no: 'HW-2',
        model_name: 'Lenovo ThinkCentre',
        manufacturer: undefined,
        current_description: undefined,
      },
    });
  });

  it('rejects a PC without a serial number', () => {
    expect(buildPcCleaningPayload({ inv_no: '9', location: 'Склад' }, { branch: 'Москва' })).toEqual({
      error: 'У ПК нет серийного номера — чистку поставить нельзя',
    });
  });
});
