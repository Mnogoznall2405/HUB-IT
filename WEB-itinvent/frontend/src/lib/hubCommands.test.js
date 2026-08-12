import { describe, expect, it, vi } from 'vitest';
import { buildHubCommands, searchHubCommands } from './hubCommands';

describe('hubCommands', () => {
  it('uses only the already permission-filtered navigation list', () => {
    const commands = buildHubCommands({
      visibleNavigationItems: [
        { path: '/dashboard', label: 'Главная' },
        { path: '/tasks', label: 'Задачи' },
      ],
      hasPermission: () => false,
    });

    expect(commands.map((command) => command.route)).toEqual(['/dashboard', '/tasks']);
    expect(commands.some((command) => command.route === '/passwords')).toBe(false);
  });

  it('adds only quick-create routes backed by an explicit permission and route contract', () => {
    const hasPermission = vi.fn((permission) => ['tasks.create', 'mail.access'].includes(permission));
    const commands = buildHubCommands({
      visibleNavigationItems: [
        { path: '/tasks', label: 'Задачи' },
        { path: '/tickets', label: 'Билеты' },
        { path: '/mail', label: 'Почта' },
      ],
      hasPermission,
    });

    expect(commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'action:new-task', route: '/tasks?create=1' }),
      expect.objectContaining({ id: 'action:new-mail', route: '/mail?compose=new' }),
    ]));
    expect(commands.some((command) => command.id === 'action:new-ticket')).toBe(false);
  });

  it('keeps Desktop actions out of regular browser sessions', () => {
    expect(buildHubCommands({ includeDesktopActions: false })
      .some((command) => command.kind === 'desktop')).toBe(false);
    expect(buildHubCommands({ includeDesktopActions: true })
      .filter((command) => command.kind === 'desktop')).toHaveLength(4);
  });

  it('matches Russian labels and keywords with stable ranking', () => {
    const commands = buildHubCommands({
      visibleNavigationItems: [
        { path: '/tasks', label: 'Задачи' },
        { path: '/kb', label: 'IT База знаний' },
      ],
    });

    expect(searchHubCommands(commands, 'зада').map((command) => command.id)).toEqual([
      'navigate:/tasks',
    ]);
    expect(searchHubCommands(commands, 'знаний').map((command) => command.id)).toEqual([
      'navigate:/kb',
    ]);
  });
});
