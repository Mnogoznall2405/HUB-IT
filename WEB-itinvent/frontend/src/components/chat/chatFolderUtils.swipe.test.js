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
  it('builds navigation list in tab order without archive', () => {
    expect(getChatFolderNavigationList(customFolders).map((item) => item.key)).toEqual([
      'personal',
      'tasks',
      'folder-a',
      'folder-b',
      'all',
    ]);
  });

  it('resolves next and previous folder keys', () => {
    const tabs = getChatFolderNavigationList(customFolders);

    expect(resolveAdjacentFolderKey({ tabs, activeKey: 'personal', direction: 'next' })).toBe('tasks');
    expect(resolveAdjacentFolderKey({ tabs, activeKey: 'tasks', direction: 'prev' })).toBe('personal');
    expect(resolveAdjacentFolderKey({ tabs, activeKey: 'folder-a', direction: 'next' })).toBe('folder-b');
    expect(resolveAdjacentFolderKey({ tabs, activeKey: 'all', direction: 'prev' })).toBe('folder-b');
  });

  it('returns null at navigation boundaries', () => {
    const tabs = getChatFolderNavigationList(customFolders);

    expect(resolveAdjacentFolderKey({ tabs, activeKey: 'personal', direction: 'prev' })).toBeNull();
    expect(resolveAdjacentFolderKey({ tabs, activeKey: 'all', direction: 'next' })).toBeNull();
  });

  it('resolves swipe target from archived to all', () => {
    expect(resolveFolderSwipeTarget('archived', 'next', customFolders)).toBe('all');
    expect(resolveFolderSwipeTarget('archived', 'prev', customFolders)).toBe('all');
  });

  it('resolves swipe target from archived to personal when All tab is hidden', () => {
    expect(resolveFolderSwipeTarget('archived', 'next', customFolders, { includeAllTab: false })).toBe('personal');
    expect(resolveFolderSwipeTarget('archived', 'prev', customFolders, { includeAllTab: false })).toBe('personal');
  });

  it('builds navigation list without All tab when requested', () => {
    expect(getChatFolderNavigationList(customFolders, { includeAllTab: false }).map((item) => item.key)).toEqual([
      'personal',
      'tasks',
      'folder-a',
      'folder-b',
    ]);
  });

  it('delegates active folders to adjacent resolver', () => {
    expect(resolveFolderSwipeTarget('tasks', 'next', customFolders)).toBe('folder-a');
    expect(resolveFolderSwipeTarget('tasks', 'prev', customFolders)).toBe('personal');
  });
});
