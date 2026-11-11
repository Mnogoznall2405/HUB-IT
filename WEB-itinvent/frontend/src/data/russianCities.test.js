import { describe, expect, it } from 'vitest';
import {
  formatSettlementRoute,
  normalizeCitySearch,
  settlementOptionLabel,
  settlementOptionSecondary,
} from './russianCities';

describe('settlement helpers', () => {
  it('normalizes yo/ye for search', () => {
    expect(normalizeCitySearch('Посёлок')).toBe('поселок');
  });

  it('formats settlement option labels', () => {
    expect(settlementOptionLabel({ name: 'Тюмень', type_label: 'город', region: 'Тюменская область' })).toBe('Тюмень');
    expect(settlementOptionSecondary({ name: 'Тюмень', type_label: 'город', region: 'Тюменская область' }))
      .toBe('город · Тюменская область');
  });

  it('formats full settlement route for form value', () => {
    expect(formatSettlementRoute({
      name: 'Эльбан',
      type_label: 'рабочий посёлок',
      region: 'Хабаровский край',
    })).toBe('Эльбан, рабочий посёлок, Хабаровский край');
    expect(formatSettlementRoute('Свой вариант')).toBe('Свой вариант');
    expect(formatSettlementRoute({ name: 'Москва' })).toBe('Москва');
  });
});
