const MAXIMUM_COMMANDS = 64;
const MAXIMUM_RESULTS = 20;

const normalizeSearchText = (value) => String(value || '')
  .trim()
  .toLocaleLowerCase('ru-RU')
  .replace(/\s+/gu, ' ');

const createNavigationCommand = (item) => ({
  id: `navigate:${item.path}`,
  label: String(item.label || item.shortLabel || item.path),
  description: 'Раздел HUB',
  keywords: normalizeSearchText(`${item.label || ''} ${item.shortLabel || ''} ${item.path}`),
  route: item.path,
  kind: 'navigation',
});

export function buildHubCommands({
  visibleNavigationItems = [],
  hasPermission = () => false,
  includeDesktopActions = false,
} = {}) {
  const commands = [];
  const visiblePaths = new Set();
  (Array.isArray(visibleNavigationItems) ? visibleNavigationItems : []).forEach((item) => {
    const path = String(item?.path || '').trim();
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || visiblePaths.has(path)) return;
    visiblePaths.add(path);
    commands.push(createNavigationCommand({ ...item, path }));
  });

  if (visiblePaths.has('/tasks') && (hasPermission('tasks.create') || hasPermission('tasks.write'))) {
    commands.push({
      id: 'action:new-task',
      label: 'Новая задача',
      description: 'Создать задачу в HUB',
      keywords: 'создать добавить новая задача',
      route: '/tasks?create=1',
      kind: 'action',
    });
  }
  if (visiblePaths.has('/mail') && hasPermission('mail.access')) {
    commands.push({
      id: 'action:new-mail',
      label: 'Новое письмо',
      description: 'Написать письмо в HUB',
      keywords: 'создать написать новое письмо почта',
      route: '/mail?compose=new',
      kind: 'action',
    });
  }

  if (includeDesktopActions) {
    commands.push(
      {
        id: 'desktop:downloads',
        label: 'Загрузки',
        description: 'Открыть загрузки HUB Desktop',
        keywords: 'файлы скачивания downloads',
        desktopAction: 'downloads',
        kind: 'desktop',
      },
      {
        id: 'desktop:diagnostics',
        label: 'Диагностика Desktop',
        description: 'Проверить состояние клиента',
        keywords: 'диагностика поддержка runtime версия',
        desktopAction: 'diagnostics',
        kind: 'desktop',
      },
      {
        id: 'desktop:updates',
        label: 'Проверить обновления',
        description: 'Проверить новую версию HUB Desktop',
        keywords: 'обновить версия update',
        desktopAction: 'updates',
        kind: 'desktop',
      },
      {
        id: 'desktop:browser',
        label: 'Открыть в браузере',
        description: 'Открыть текущую безопасную страницу',
        keywords: 'браузер web chrome edge',
        desktopAction: 'browser',
        kind: 'desktop',
      },
    );
  }

  return commands.slice(0, MAXIMUM_COMMANDS);
}

export function searchHubCommands(commands, query, maximumResults = MAXIMUM_RESULTS) {
  const normalizedQuery = normalizeSearchText(query);
  const boundedLimit = Math.max(1, Math.min(MAXIMUM_RESULTS, Number(maximumResults) || MAXIMUM_RESULTS));
  const source = Array.isArray(commands) ? commands : [];
  if (!normalizedQuery) return source.slice(0, boundedLimit);

  return source
    .map((command, index) => {
      const label = normalizeSearchText(command?.label);
      const searchable = `${label} ${normalizeSearchText(command?.keywords)} ${normalizeSearchText(command?.description)}`;
      const score = label === normalizedQuery
        ? 0
        : label.startsWith(normalizedQuery)
          ? 1
          : searchable.includes(normalizedQuery)
            ? 2
            : -1;
      return { command, index, score };
    })
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .slice(0, boundedLimit)
    .map((entry) => entry.command);
}
