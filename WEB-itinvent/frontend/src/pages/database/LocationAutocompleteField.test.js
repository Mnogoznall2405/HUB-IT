import { describe, expect, it } from 'vitest';

import {
  filterLocationOptions,
  formatLocationOptionLabel,
  normalizeLocationOption,
} from './LocationAutocompleteField';

describe('LocationAutocompleteField helpers', () => {
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
      search_blob: 'remote desk A-7'.toLowerCase(),
    });
  });

  it('formats labels without duplicating identical name and id', () => {
    expect(formatLocationOptionLabel({ loc_no: '42', loc_name: 'HQ Storage' })).toBe('HQ Storage (42)');
    expect(formatLocationOptionLabel({ loc_no: 'HQ', loc_name: 'HQ' })).toBe('HQ');
    expect(formatLocationOptionLabel({ loc_no: '', loc_name: '' })).toBe('-');
  });

  it('filters options by normalized search blob', () => {
    const options = [
      normalizeLocationOption({ LOC_NO: 42, LOC_NAME: 'HQ Storage' }),
      normalizeLocationOption({ LOC_NO: 77, LOC_NAME: 'Remote Desk' }),
    ];

    expect(filterLocationOptions(options, { inputValue: 'storage' })).toEqual([options[0]]);
    expect(filterLocationOptions(options, { inputValue: '77' })).toEqual([options[1]]);
    expect(filterLocationOptions(options, { inputValue: '' })).toEqual(options);
  });
});
