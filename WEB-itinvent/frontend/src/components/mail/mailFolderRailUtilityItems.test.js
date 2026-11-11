import { describe, expect, it, vi } from 'vitest';
import { buildMailFolderRailUtilityItems } from './mailFolderRailUtilityItems';

describe('buildMailFolderRailUtilityItems', () => {
  it('always includes the IT request and adds templates only for managers', () => {
    expect(buildMailFolderRailUtilityItems({
      onItRequest: vi.fn(),
      onOpenTemplates: vi.fn(),
    }).map((item) => item.id)).toEqual(['it-request']);

    expect(buildMailFolderRailUtilityItems({
      canManageUsers: true,
      onItRequest: vi.fn(),
      onOpenTemplates: vi.fn(),
    }).map((item) => ({ id: item.id, label: item.label }))).toEqual([
      { id: 'it-request', label: 'IT-заявка' },
      { id: 'templates', label: 'Шаблоны' },
    ]);
  });

  it('closes mobile navigation before opening the selected tool', () => {
    const order = [];
    const items = buildMailFolderRailUtilityItems({
      canManageUsers: true,
      onAfterClick: () => order.push('nav'),
      onItRequest: () => order.push('it'),
      onOpenTemplates: () => order.push('templates'),
    });

    items.find((item) => item.id === 'it-request').onClick();
    items.find((item) => item.id === 'templates').onClick();

    expect(order).toEqual(['nav', 'it', 'nav', 'templates']);
  });
});
