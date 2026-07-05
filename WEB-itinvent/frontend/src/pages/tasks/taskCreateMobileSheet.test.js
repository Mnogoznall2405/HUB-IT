import { describe, expect, it } from 'vitest';

import {
  CREATE_MOBILE_SHEET_TITLES,
  getCreateMobileSheetTitle,
  isCreateDescriptionMobileSheet,
  isCreateTallMobileSheet,
} from './taskCreateMobileSheet';

describe('taskCreateMobileSheet', () => {
  it('maps known sheet keys to titles', () => {
    expect(getCreateMobileSheetTitle('observers')).toBe(CREATE_MOBILE_SHEET_TITLES.observers);
    expect(getCreateMobileSheetTitle('unknown')).toBe('');
  });

  it('detects description and tall sheets', () => {
    expect(isCreateDescriptionMobileSheet('description')).toBe(true);
    expect(isCreateDescriptionMobileSheet('files')).toBe(false);
    expect(isCreateTallMobileSheet('assignees')).toBe(true);
    expect(isCreateTallMobileSheet('priority')).toBe(false);
  });
});
