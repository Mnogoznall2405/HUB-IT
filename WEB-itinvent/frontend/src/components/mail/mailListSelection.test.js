import { describe, expect, it } from 'vitest';

import { resolveAdjacentMailListItem } from './mailListSelection';

const items = [
  { id: 'msg-1' },
  { id: 'msg-2' },
  { id: 'msg-3' },
];

describe('resolveAdjacentMailListItem', () => {
  it('returns the next and previous list items without wrapping', () => {
    expect(resolveAdjacentMailListItem({ items, selectedId: 'msg-2', delta: 1 }))
      .toEqual({ next: items[2], nextId: 'msg-3' });
    expect(resolveAdjacentMailListItem({ items, selectedId: 'msg-2', delta: -1 }))
      .toEqual({ next: items[0], nextId: 'msg-1' });
    expect(resolveAdjacentMailListItem({ items, selectedId: 'msg-1', delta: -1 })).toBeNull();
    expect(resolveAdjacentMailListItem({ items, selectedId: 'msg-3', delta: 1 })).toBeNull();
  });

  it('selects the first item when nothing is currently selected', () => {
    expect(resolveAdjacentMailListItem({ items, selectedId: '', delta: 1 }))
      .toEqual({ next: items[0], nextId: 'msg-1' });
  });

  it('ignores empty lists and items without ids', () => {
    expect(resolveAdjacentMailListItem({ items: [], selectedId: 'msg-1', delta: 1 })).toBeNull();
    expect(resolveAdjacentMailListItem({ items: [{ subject: 'no-id' }], selectedId: '', delta: 1 })).toBeNull();
  });
});
