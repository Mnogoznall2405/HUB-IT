import { describe, expect, it } from 'vitest';

import {
  buildAddConsumableDefaults,
  buildAddConsumablePayload,
  buildAddConsumableSuccessMessage,
  buildEditConsumableQtyPayload,
  createAddConsumableInitialForm,
  flattenGroupedConsumables,
  formatConsumableSourceLabel,
  getEditConsumableQtyInitialValue,
  isCartridgeLikeConsumable,
  toConsumableSourceOption,
} from './consumableModel';

const MESSAGES = {
  noType: '\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u0438\u043f \u0440\u0430\u0441\u0445\u043e\u0434\u043d\u0438\u043a\u0430.',
  noModel: '\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u043c\u043e\u0434\u0435\u043b\u044c \u0440\u0430\u0441\u0445\u043e\u0434\u043d\u0438\u043a\u0430.',
  noBranch: '\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0444\u0438\u043b\u0438\u0430\u043b.',
  noLocation: '\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043c\u0435\u0441\u0442\u043e\u043f\u043e\u043b\u043e\u0436\u0435\u043d\u0438\u0435.',
  invalidAddQty: '\u041a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e \u0434\u043e\u043b\u0436\u043d\u043e \u0431\u044b\u0442\u044c \u0431\u043e\u043b\u044c\u0448\u0435 0.',
  missingEditItem: '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0438\u0442\u044c \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u044b\u0439 \u0440\u0430\u0441\u0445\u043e\u0434\u043d\u0438\u043a.',
  invalidEditQty: '\u041a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e \u0434\u043e\u043b\u0436\u043d\u043e \u0431\u044b\u0442\u044c \u0446\u0435\u043b\u044b\u043c \u0447\u0438\u0441\u043b\u043e\u043c 0 \u0438\u043b\u0438 \u0431\u043e\u043b\u044c\u0448\u0435.',
  missingEditIdentity: '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0438\u0442\u044c ID \u0438\u043b\u0438 \u0438\u043d\u0432\u0435\u043d\u0442\u0430\u0440\u043d\u044b\u0439 \u043d\u043e\u043c\u0435\u0440 \u0440\u0430\u0441\u0445\u043e\u0434\u043d\u0438\u043a\u0430.',
};

describe('consumableModel', () => {
  it('creates the add-consumable form defaults', () => {
    expect(createAddConsumableInitialForm()).toEqual({
      branch_no: '',
      loc_no: '',
      type_no: '',
      model_name: '',
      model_no: null,
      qty: 1,
    });
  });

  it('builds add-consumable defaults with the normalized selected branch', () => {
    expect(buildAddConsumableDefaults({
      selectedBranch: ' hq ',
      branchOptions: [
        { branch_no: 11, branch_name: 'Remote' },
        { branch_no: 7, branch_name: 'HQ' },
      ],
    })).toEqual({
      ...createAddConsumableInitialForm(),
      branch_no: '7',
    });
  });

  it('validates add-consumable payload inputs', () => {
    const validForm = {
      branch_no: '10',
      loc_no: '20',
      type_no: '3',
      model_name: 'HP 12A',
      model_no: null,
      qty: '2',
    };

    expect(buildAddConsumablePayload({ ...validForm, type_no: '' })).toEqual({
      error: MESSAGES.noType,
      payload: null,
    });
    expect(buildAddConsumablePayload({ ...validForm, model_name: '  ' })).toEqual({
      error: MESSAGES.noModel,
      payload: null,
    });
    expect(buildAddConsumablePayload({ ...validForm, branch_no: '  ' })).toEqual({
      error: MESSAGES.noBranch,
      payload: null,
    });
    expect(buildAddConsumablePayload({ ...validForm, loc_no: '' })).toEqual({
      error: MESSAGES.noLocation,
      payload: null,
    });
    expect(buildAddConsumablePayload({ ...validForm, qty: '0' })).toEqual({
      error: MESSAGES.invalidAddQty,
      payload: null,
    });
  });

  it('builds add-consumable payloads and success messages', () => {
    expect(buildAddConsumablePayload({
      branch_no: ' 10 ',
      loc_no: ' 20 ',
      type_no: '3',
      model_name: ' HP 12A ',
      model_no: null,
      qty: '2.8',
    })).toEqual({
      error: '',
      payload: {
        branch_no: '10',
        loc_no: '20',
        type_no: 3,
        model_name: 'HP 12A',
        model_no: undefined,
        qty: 2,
      },
    });

    expect(buildAddConsumableSuccessMessage({ inv_no: ' C-10 ' }))
      .toBe('\u0420\u0430\u0441\u0445\u043e\u0434\u043d\u0438\u043a \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d. \u0418\u043d\u0432\u0435\u043d\u0442\u0430\u0440\u043d\u044b\u0439 \u043d\u043e\u043c\u0435\u0440: C-10.');
    expect(buildAddConsumableSuccessMessage({}))
      .toBe('\u0420\u0430\u0441\u0445\u043e\u0434\u043d\u0438\u043a \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d.');
  });

  it('builds edit-consumable quantity initial values from current quantity', () => {
    expect(getEditConsumableQtyInitialValue({ QTY: '4.8' })).toBe('4');
    expect(getEditConsumableQtyInitialValue({ qty: '-2' })).toBe('0');
    expect(getEditConsumableQtyInitialValue({ qty: 'bad' })).toBe('0');
  });

  it('validates edit-consumable quantity payload inputs', () => {
    expect(buildEditConsumableQtyPayload({ item: { ID: 1 }, value: '1.5' })).toEqual({
      error: MESSAGES.invalidEditQty,
      payload: null,
    });
    expect(buildEditConsumableQtyPayload({ item: { ID: 1 }, value: '-1' })).toEqual({
      error: MESSAGES.invalidEditQty,
      payload: null,
    });
  });

  it('validates edit-consumable item identity', () => {
    expect(buildEditConsumableQtyPayload({ item: null, value: '1' })).toEqual({
      error: MESSAGES.missingEditItem,
      payload: null,
    });
    expect(buildEditConsumableQtyPayload({ item: { MODEL_NAME: 'HP 12A' }, value: '1' })).toEqual({
      error: MESSAGES.missingEditIdentity,
      payload: null,
    });
  });

  it('builds valid edit-consumable quantity payloads', () => {
    expect(buildEditConsumableQtyPayload({
      item: { ID: '12', INV_NO: ' C-12 ' },
      value: '5',
    })).toEqual({
      error: '',
      payload: {
        item_id: 12,
        inv_no: 'C-12',
        qty: 5,
      },
    });

    expect(buildEditConsumableQtyPayload({
      item: { inv_no: ' C-13 ' },
      value: '0',
    })).toEqual({
      error: '',
      payload: {
        item_id: undefined,
        inv_no: 'C-13',
        qty: 0,
      },
    });
  });

  it('normalizes consumable source rows from upper and lower case API fields', () => {
    expect(toConsumableSourceOption({
      ID: '7',
      INV_NO: ' C-1 ',
      TYPE_NAME: 'Cartridge',
      MODEL_NAME: 'HP 12A',
      QTY: '4',
      BRANCH_NAME: 'HQ',
      LOCATION: 'Stock',
    })).toEqual({
      id: 7,
      inv_no: 'C-1',
      type_name: 'Cartridge',
      model_name: 'HP 12A',
      qty: 4,
      branch_name: 'HQ',
      location_name: 'Stock',
    });
  });

  it('formats labels and detects cartridge-like consumables', () => {
    const row = { type_name: 'Toner', model_name: 'HP 12A', qty: 2, branch_name: 'HQ', location_name: 'Stock' };

    expect(formatConsumableSourceLabel(row)).toBe('HP 12A | Toner | HQ / Stock | \u041e\u0441\u0442\u0430\u0442\u043e\u043a: 2');
    expect(isCartridgeLikeConsumable(row)).toBe(true);
    expect(isCartridgeLikeConsumable({ type_name: 'SSD', model_name: 'Samsung' })).toBe(false);
  });

  it('flattens grouped consumables in branch/location order', () => {
    expect(flattenGroupedConsumables({
      HQ: { Stock: [{ id: 1 }, { id: 2 }] },
      Remote: { Shelf: [{ id: 3 }] },
    })).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });
});
