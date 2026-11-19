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

  it('navigates by conversation_id in conversations mode', () => {
    const conversations = [
      { conversation_id: 'conv-1' },
      { conversation_id: 'conv-2' },
      { conversation_id: 'conv-3' },
    ];
    expect(resolveAdjacentMailListItem({ items: conversations, selectedId: 'conv-2', delta: 1, mode: 'conversations' }))
      .toEqual({ next: conversations[2], nextId: 'conv-3' });
    expect(resolveAdjacentMailListItem({ items: conversations, selectedId: 'conv-2', delta: -1, mode: 'conversations' }))
      .toEqual({ next: conversations[0], nextId: 'conv-1' });
    expect(resolveAdjacentMailListItem({ items: conversations, selectedId: 'conv-1', delta: -1, mode: 'conversations' }))
      .toBeNull();
  });

  it('keys messages by id even when they carry conversation_id', () => {
    const messages = [
      { id: 'msg-1', conversation_id: 'conv-1' },
      { id: 'msg-2', conversation_id: 'conv-1' },
    ];
    expect(resolveAdjacentMailListItem({ items: messages, selectedId: 'msg-1', delta: 1, mode: 'messages' }))
      .toEqual({ next: messages[1], nextId: 'msg-2' });
  });
});
