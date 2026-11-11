import { describe, expect, it } from 'vitest';

import {
  getChatFolderNavigationList,
  resolveAdjacentFolderKey,
  resolveFolderSwipeTarget,
} from './chatFolderUtils';

const customFolders = [
  { id: 'folder-a', name: 'Работа' },
  { id: 'folder-b', name: 'Семья' },
];

describe('chat folder swipe navigation utils', () => {
  it('builds navigation list in tab order without archive or All', () => {
    expect(getChatFolderNavigationList(customFolders).map((item) => item.key)).toEqual([
      'personal',
      'groups',
      'tasks',
      'folder-a',
      'folder-b',
    ]);
  });

  it('resolves next and previous folder keys', () => {
    const tabs = getChatFolderNavigationList(customFolders);

    expect(resolveAdjacentFolderKey({ tabs, activeKey: 'personal', direction: 'next' })).toBe('groups');
    expect(resolveAdjacentFolderKey({ tabs, activeKey: 'groups', direction: 'next' })).toBe('tasks');
    expect(resolveAdjacentFolderKey({ tabs, activeKey: 'tasks', direction: 'prev' })).toBe('groups');
    expect(resolveAdjacentFolderKey({ tabs, activeKey: 'folder-a', direction: 'next' })).toBe('folder-b');
    expect(resolveAdjacentFolderKey({ tabs, activeKey: 'folder-b', direction: 'prev' })).toBe('folder-a');
  });

  it('returns null at navigation boundaries', () => {
    const tabs = getChatFolderNavigationList(customFolders);

    expect(resolveAdjacentFolderKey({ tabs, activeKey: 'personal', direction: 'prev' })).toBeNull();
    expect(resolveAdjacentFolderKey({ tabs, activeKey: 'folder-b', direction: 'next' })).toBeNull();
  });

  it('resolves swipe target from archived to personal', () => {
    expect(resolveFolderSwipeTarget('archived', 'next', customFolders)).toBe('personal');
    expect(resolveFolderSwipeTarget('archived', 'prev', customFolders)).toBe('personal');
  });

  it('can still resolve archived to All when includeAllTab is forced on', () => {
    expect(resolveFolderSwipeTarget('archived', 'next', customFolders, { includeAllTab: true })).toBe('all');
    expect(resolveFolderSwipeTarget('archived', 'prev', customFolders, { includeAllTab: true })).toBe('all');
  });

  it('builds navigation list with All tab only when requested', () => {
    expect(getChatFolderNavigationList(customFolders, { includeAllTab: true }).map((item) => item.key)).toEqual([
      'personal',
      'groups',
      'tasks',
      'folder-a',
      'folder-b',
      'all',
    ]);
  });

  it('delegates active folders to adjacent resolver', () => {
    expect(resolveFolderSwipeTarget('tasks', 'next', customFolders)).toBe('folder-a');
    expect(resolveFolderSwipeTarget('tasks', 'prev', customFolders)).toBe('groups');
    expect(resolveFolderSwipeTarget('personal', 'next', customFolders)).toBe('groups');
  });
});
