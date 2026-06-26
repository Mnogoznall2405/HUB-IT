import { describe, expect, it } from 'vitest';

import { buildMobileTaskCardMenuItems } from './taskCardModel';

describe('taskCardModel', () => {
  it('always includes copy link action', () => {
    const items = buildMobileTaskCardMenuItems();
    expect(items.map((item) => item.key)).toEqual(['copy']);
  });

  it('adds edit and delete when allowed', () => {
    const items = buildMobileTaskCardMenuItems({ canEdit: true, canDelete: true });
    expect(items.map((item) => item.key)).toEqual(['edit', 'copy', 'delete']);
    expect(items.find((item) => item.key === 'delete')?.tone).toBe('danger');
  });
});
