import { buildMatrixRows, getAccessLevelMeta } from './groupsAccessUtils';

const formatSyncedStamp = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return 'snapshot';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw.replace(/[:.]/g, '-');
  return date.toISOString().slice(0, 16).replace(/[:T]/g, '-');
};

const formatFileToken = (value, fallback = 'folder') => {
  const normalized = String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized.slice(0, 80) || fallback;
};

export const exportGroupsAccessWorkbook = async ({
  groups = [],
  users = [],
  branch = '',
  syncedAt = '',
} = {}) => {
  const XLSX = await import('xlsx');
  const folderRows = [
    ['Ветка', 'Путь к папке', 'Папка', 'Группа AD', 'Уровень доступа', 'Пользователей', 'Описание'],
    ...groups.map((group) => [
      group.branch || '',
      group.folder_path || group.folder_label || group.cn || '',
      group.folder_label || group.cn || '',
      group.cn || '',
      getAccessLevelMeta(group.access_level).label,
      group.member_count ?? '',
      group.description || '',
    ]),
  ];

  const accessRows = [
    ['Учётка', 'ФИО', 'Ветка', 'Путь к папке', 'Папка', 'Уровень доступа', 'Группа AD'],
  ];
  users.forEach((user) => {
    (user.access || []).forEach((accessRow) => {
      accessRows.push([
        user.login || '',
        user.display_name || user.login || '',
        accessRow.branch || '',
        accessRow.folder_path || accessRow.folder_label || '',
        accessRow.folder_label || '',
        getAccessLevelMeta(accessRow.access_level).label,
        accessRow.group_dn || '',
      ]);
    });
  });

  const matrixHeader = [
    'Учётка',
    'ФИО',
    ...groups.map((group) => group.folder_path || group.folder_label || group.cn || ''),
  ];
  const matrixBody = buildMatrixRows({ users, groups }).map((row) => [
    row.login,
    row.display_name,
    ...row.cells.map((level) => (level ? getAccessLevelMeta(level).short : '')),
  ]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(folderRows), 'Папки');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(accessRows), 'Доступы');
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([matrixHeader, ...matrixBody]),
    'Матрица',
  );

  const branchSuffix = branch ? `-${branch}` : '';
  const stamp = formatSyncedStamp(syncedAt);
  XLSX.writeFile(workbook, `groups-access${branchSuffix}-${stamp}.xlsx`);
};

export const exportGroupMembersWorkbook = async ({
  group = {},
  members = [],
  syncedAt = '',
} = {}) => {
  const XLSX = await import('xlsx');
  const meta = getAccessLevelMeta(group?.access_level);
  const folderRows = [
    ['Поле', 'Значение'],
    ['Филиал', group?.branch || ''],
    ['Путь к папке', group?.folder_path || group?.folder_label || group?.cn || ''],
    ['Папка', group?.folder_label || group?.cn || ''],
    ['AD-группа', group?.cn || ''],
    ['Distinguished Name', group?.dn || ''],
    ['Уровень доступа', meta.label],
    ['Описание', group?.description || ''],
    ['Пользователей', members.length],
    ['Снимок обновлён', syncedAt || ''],
  ];
  const memberRows = [
    ['Учётка', 'ФИО', 'Источник'],
    ...members.map((member) => [
      member?.login || '',
      member?.display_name || member?.login || '',
      member?.via || '',
    ]),
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(folderRows), 'Папка');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(memberRows), 'Участники');

  const branchSuffix = group?.branch ? `-${formatFileToken(group.branch, 'branch')}` : '';
  const folderToken = formatFileToken(group?.folder_label || group?.cn, 'folder');
  const stamp = formatSyncedStamp(syncedAt);
  XLSX.writeFile(workbook, `folder-access${branchSuffix}-${folderToken}-${stamp}.xlsx`);
};
