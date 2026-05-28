import { describe, expect, it } from 'vitest';

import { APP_BRAND_NAME, buildDocumentTitle, INVENTORY_SECTION_LABEL } from './appBranding';

describe('appBranding', () => {
  it('returns only the brand name when section is empty or equals the brand', () => {
    expect(buildDocumentTitle('')).toBe(APP_BRAND_NAME);
    expect(buildDocumentTitle(APP_BRAND_NAME)).toBe(APP_BRAND_NAME);
  });

  it('builds section titles with the brand suffix', () => {
    expect(buildDocumentTitle(INVENTORY_SECTION_LABEL)).toBe(`${INVENTORY_SECTION_LABEL} — ${APP_BRAND_NAME}`);
    expect(buildDocumentTitle('Задачи')).toBe(`Задачи — ${APP_BRAND_NAME}`);
  });
});
