import { describe, expect, it } from 'vitest';

import {
  buildBranchOptions,
  buildDetailModelOptions,
  buildLocationOptions,
  buildNamedModelOptions,
  buildStatusOptions,
  buildTypeOptions,
  filterLocationOptions,
  formatLocationOptionLabel,
  getConsumableTypeOptions,
  getEquipmentTypeOptions,
  getSelectedOwnerOption,
  normalizeLocationOption,
  usesManualModel,
  usesManualOwner,
} from './databaseOptionModel';

describe('databaseOptionModel location helpers', () => {
  it('normalizes mixed API location shapes into autocomplete options', () => {
    expect(normalizeLocationOption({
      LOC_NO: 42,
      LOC_NAME: 'HQ Storage',
    })).toEqual({
      loc_no: '42',
      loc_name: 'HQ Storage',
      search_blob: 'hq storage 42',
    });

    expect(normalizeLocationOption({
      loc_no: 'A-7',
      DESCR: 'Remote Desk',
    })).toEqual({
      loc_no: 'A-7',
      loc_name: 'Remote Desk',
      search_blob: 'remote desk a-7',
    });
  });

  it('formats and filters location labels by normalized search blob', () => {
    const options = [
      normalizeLocationOption({ LOC_NO: 42, LOC_NAME: 'HQ Storage' }),
      normalizeLocationOption({ loc_no: 'A-7', DESCR: 'Remote Desk' }),
    ];

    expect(formatLocationOptionLabel(options[0])).toBe('HQ Storage (42)');
    expect(formatLocationOptionLabel({ loc_no: 'HQ', loc_name: 'HQ' })).toBe('HQ');
    expect(formatLocationOptionLabel({ loc_no: '', loc_name: '' })).toBe('-');
    expect(filterLocationOptions(options, { inputValue: 'storage' })).toEqual([options[0]]);
    expect(filterLocationOptions(options, { inputValue: 'a-7' })).toEqual([options[1]]);
  });

  it('builds location options and filters null ids', () => {
    expect(buildLocationOptions([
      { LOC_NO: null, LOC_NAME: 'No id' },
      { loc_no: '', loc_name: 'Empty id' },
      { LOC_NO: 17, DESCR: 'Office 17' },
    ])).toEqual([
      {
        loc_no: '17',
        loc_name: 'Office 17',
        search_blob: 'office 17 17',
      },
    ]);
  });
});

describe('databaseOptionModel option builders', () => {
  it('builds status, branch, and type options from mixed uppercase/lowercase shapes', () => {
    expect(buildStatusOptions([
      { STATUS_NO: 1, STATUS_NAME: 'Active' },
      { status_no: '2', DESCR: 'Reserve' },
      { STATUS_NO: null, STATUS_NAME: 'Missing' },
    ])).toEqual([
      { status_no: 1, status_name: 'Active' },
      { status_no: 2, status_name: 'Reserve' },
    ]);

    expect(buildBranchOptions([
      { BRANCH_NO: 10, BRANCH_NAME: 'Main' },
      { id: 'B-2', name: 'Remote' },
      { branch_no: null, branch_name: 'Missing' },
    ])).toEqual([
      { branch_no: '10', branch_name: 'Main' },
      { branch_no: 'B-2', branch_name: 'Remote' },
    ]);

    const typeOptions = buildTypeOptions([
      { CI_TYPE: 1, TYPE_NO: 101, TYPE_NAME: 'Laptop' },
      { ci_type: '4', type_no: '401', type_name: 'Cartridge' },
      { CI_TYPE: 1, TYPE_NO: null, TYPE_NAME: 'Missing' },
    ]);

    expect(typeOptions).toEqual([
      { ci_type: 1, type_no: 101, type_name: 'Laptop' },
      { ci_type: 4, type_no: 401, type_name: 'Cartridge' },
    ]);
    expect(getEquipmentTypeOptions(typeOptions)).toEqual([typeOptions[0]]);
    expect(getConsumableTypeOptions(typeOptions)).toEqual([typeOptions[1]]);
  });

  it('builds detail and named model options with expected filters', () => {
    expect(buildDetailModelOptions([
      { MODEL_NO: 9, MODEL_NAME: 'ThinkPad', TYPE_NO: 101 },
      { model_no: '10', model_name: 'LaserJet', type_no: '401' },
      { MODEL_NO: null, MODEL_NAME: 'Missing id', TYPE_NO: 101 },
    ])).toEqual([
      { model_no: 9, model_name: 'ThinkPad', type_no: 101 },
      { model_no: 10, model_name: 'LaserJet', type_no: 401 },
    ]);

    expect(buildNamedModelOptions([
      { MODEL_NO: 9, MODEL_NAME: 'ThinkPad' },
      { model_no: '10', model_name: 'LaserJet' },
      { MODEL_NO: 11, MODEL_NAME: '' },
    ])).toEqual([
      { model_no: 9, model_name: 'ThinkPad' },
      { model_no: 10, model_name: 'LaserJet' },
    ]);
  });
});

describe('databaseOptionModel manual input helpers', () => {
  it('selects an existing owner option or returns the legacy uppercase fallback shape', () => {
    const ownerOptions = [
      { owner_no: 7, owner_display_name: 'Ada Lovelace', owner_dept: 'R&D' },
      { OWNER_NO: 8, OWNER_DISPLAY_NAME: 'Grace Hopper', OWNER_DEPT: 'Platform' },
    ];

    expect(getSelectedOwnerOption({
      ownerOptions,
      ownerNo: '8',
      ownerName: 'Ignored',
      ownerDept: 'Ignored',
    })).toBe(ownerOptions[1]);

    expect(getSelectedOwnerOption({
      ownerOptions,
      ownerNo: 42,
      ownerName: 'Manual Owner',
      ownerDept: 'Ops',
    })).toEqual({
      OWNER_NO: 42,
      OWNER_DISPLAY_NAME: 'Manual Owner',
      OWNER_DEPT: 'Ops',
    });

    expect(getSelectedOwnerOption({
      ownerOptions,
      ownerNo: null,
      ownerName: 'Manual Owner',
      ownerDept: 'Ops',
    })).toBeNull();
  });

  it('detects manual owner and manual model entry states', () => {
    expect(usesManualOwner({ ownerNo: null, ownerName: 'Al' })).toBe(true);
    expect(usesManualOwner({ ownerNo: 7, ownerName: 'Al' })).toBe(false);
    expect(usesManualOwner({ ownerNo: null, ownerName: 'A' })).toBe(false);

    expect(usesManualModel({ modelNo: null, modelName: 'Custom Model', typeNo: '101' })).toBe(true);
    expect(usesManualModel({ modelNo: 9, modelName: 'Custom Model', typeNo: '101' })).toBe(false);
    expect(usesManualModel({ modelNo: null, modelName: 'Custom Model', typeNo: null })).toBe(false);
    expect(usesManualModel({ modelNo: null, modelName: 'C', typeNo: '101' })).toBe(false);
  });
});
