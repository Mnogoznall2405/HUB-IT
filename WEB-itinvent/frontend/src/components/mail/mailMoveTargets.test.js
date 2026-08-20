import { describe, expect, it } from 'vitest';
import { filterMailMoveTargets, isUsefulMailMoveTarget, serializeMailMoveTargets } from './mailMoveTargets';

describe('mailMoveTargets', () => {
  it('keeps regular destination folders and drops Outlook system folders', () => {
    const targets = [
      { value: 'junk', label: 'Нежелательные', well_known_key: 'junk' },
      { value: 'sent', label: 'Отправленные', well_known_key: 'sent' },
      { value: 'custom-1', label: 'Проекты' },
      { value: 'rss', label: 'RSS-каналы' },
      { value: 'journal', label: 'Журнал бесед' },
      { value: 'outbox', label: 'Исходящие' },
      { value: 'conflicts', label: 'Конфликты' },
      { value: 'local-errors', label: 'Локальные ошибки' },
    ];

    expect(filterMailMoveTargets(targets, 'inbox').map((item) => item.value)).toEqual([
      'junk',
      'sent',
      'custom-1',
    ]);
    expect(isUsefulMailMoveTarget({ label: 'RSS-каналы' })).toBe(false);
    expect(isUsefulMailMoveTarget({ label: 'Проекты' })).toBe(true);
  });

  it('serializes folder tree items and excludes the current folder', () => {
    const items = serializeMailMoveTargets([
      { id: 'inbox', label: 'Входящие', well_known_key: 'inbox', icon_key: 'inbox' },
      { id: 'sent', label: 'Отправленные', well_known_key: 'sent', icon_key: 'sent' },
      { id: 'rss', label: 'RSS-каналы' },
    ], 'inbox');

    expect(items).toEqual([
      {
        value: 'sent',
        label: 'Отправленные',
        icon_key: 'sent',
        well_known_key: 'sent',
      },
    ]);
  });
});
