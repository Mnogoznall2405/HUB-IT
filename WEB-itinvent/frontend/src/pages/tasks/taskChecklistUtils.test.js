import { describe, expect, it } from 'vitest';

import {
  createEmptyChecklistItem,
  normalizeChecklistItems,
} from './taskChecklistUtils';

describe('taskChecklistUtils', () => {
  it('creates empty checklist item with id', () => {
    const item = createEmptyChecklistItem();
    expect(item.text).toBe('');
    expect(item.done).toBe(false);
    expect(String(item.id).length).toBeGreaterThan(0);
  });

  it('normalizes checklist items and drops empty text', () => {
    const items = normalizeChecklistItems([
      { id: 'a', text: '  Первая  ', done: true },
      { text: '   ' },
      { text: 'Вторая', done: false },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: 'a', text: 'Первая', done: true });
    expect(items[1].text).toBe('Вторая');
  });
});
