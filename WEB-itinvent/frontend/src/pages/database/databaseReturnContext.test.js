import { describe, expect, it } from 'vitest';

import { normalizeDatabaseReturnContext } from './databaseReturnContext';

describe('normalizeDatabaseReturnContext', () => {
  it('preserves a warehouse-only employee result for reopening after Warehouse 1C', () => {
    const context = normalizeDatabaseReturnContext({
      returnTo: '/database',
      returnLabel: 'Назад к результату поиска',
      reopenEmployee: {
        ownerNo: null,
        employeeName: 'Иванов И.И.',
        warehouseRef: 'wh-1',
      },
    });

    expect(context).toEqual(expect.objectContaining({
      ownerNo: '',
      employeeName: 'Иванов И.И.',
      warehouseRef: 'wh-1',
      returnTo: '/database',
      returnLabel: 'Назад к результату поиска',
    }));
  });
});
