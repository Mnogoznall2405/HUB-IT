import { describe, expect, it } from 'vitest';
import {
  MAIL_FOLDER_LABELS,
  buildFallbackMailFolderTreeItems,
  getMailFolderLabel,
  mergeMailFolderTreeWithSummary,
  resolveMailFolderTreeView,
} from './mailFolderTreeModel';

describe('mailFolderTreeModel', () => {
  it('builds fallback well-known folders with summary counts', () => {
    const items = buildFallbackMailFolderTreeItems({
      inbox: { total: 12, unread: 3 },
      archive: { total: 1, unread: 0 },
    });

    expect(items.map((item) => item.id)).toEqual(Object.keys(MAIL_FOLDER_LABELS));
    expect(items.find((item) => item.id === 'inbox')).toMatchObject({
      label: 'Входящие',
      well_known_key: 'inbox',
      scope: 'mailbox',
      total: 12,
      unread: 3,
    });
    expect(items.find((item) => item.id === 'archive')).toMatchObject({
      scope: 'archive',
      total: 1,
    });
  });

  it('prefers a live folder tree and overlays summary by well_known_key', () => {
    const merged = mergeMailFolderTreeWithSummary(
      [
        { id: 'team', label: 'Команда', well_known_key: null, total: 4, unread: 1 },
        { id: 'inbox', label: 'Inbox', well_known_key: 'INBOX', total: 0, unread: 0 },
      ],
      { inbox: { total: 9, unread: 2 } },
      buildFallbackMailFolderTreeItems(),
    );

    expect(merged[0]).toMatchObject({ id: 'team', total: 4, unread: 1 });
    expect(merged[1]).toMatchObject({ id: 'inbox', label: 'Inbox', total: 9, unread: 2 });
  });

  it('falls back to well-known labels when the live tree is empty', () => {
    const view = resolveMailFolderTreeView({
      folderTree: [],
      folderSummary: { sent: { total: 5, unread: 0 } },
      folder: 'sent',
    });

    expect(view.effectiveFolderTreeItems).toHaveLength(Object.keys(MAIL_FOLDER_LABELS).length);
    expect(view.currentFolderLabel).toBe('Отправленные');
    expect(view.folderLabelMap.get('sent')).toBe('Отправленные');
  });

  it('uses the live folder label, then well-known labels, then Письма', () => {
    const view = resolveMailFolderTreeView({
      folderTree: [{ id: 'projects', label: 'Проекты', well_known_key: '' }],
      folder: 'projects',
    });
    expect(view.currentFolderLabel).toBe('Проекты');
    expect(getMailFolderLabel('inbox')).toBe('Входящие');
    expect(getMailFolderLabel('unknown')).toBe('Письма');
  });
});
