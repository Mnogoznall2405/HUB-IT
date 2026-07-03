import * as XLSX from 'xlsx';

export const ACCESS_LEVEL_META = {
  read: { label: 'Чтение', short: 'R', color: 'info' },
  write: { label: 'Запись', short: 'W', color: 'warning' },
  full: { label: 'Полный', short: 'F', color: 'error' },
  member: { label: 'Доступ', short: '+', color: 'default' },
};

export const splitFolderPath = (path) => (
  String(path || '')
    .split(/\s*\/\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean)
);

export const getAccessLevelMeta = (level) => (
  ACCESS_LEVEL_META[String(level || 'member')] || ACCESS_LEVEL_META.member
);

export const buildSparseAccessMap = (cells = []) => {
  const map = new Map();
  cells.forEach((cell) => {
    if (!Array.isArray(cell) || cell.length < 3) return;
    const [login, groupDn, level] = cell;
    const normalizedLogin = String(login || '').trim();
    const normalizedGroupDn = String(groupDn || '').trim();
    if (!normalizedLogin || !normalizedGroupDn) return;
    map.set(`${normalizedLogin}\0${normalizedGroupDn}`, String(level || 'member'));
  });
  return map;
};

export const getSparseAccessLevel = (sparseMap, login, groupDn) => (
  sparseMap.get(`${String(login || '').trim()}\0${String(groupDn || '').trim()}`) || ''
);

export const buildAccessLookup = (users = []) => {
  const lookup = new Map();
  users.forEach((user) => {
    const login = String(user?.login || '').trim();
    if (!login) return;
    const row = new Map();
    (user.access || []).forEach((accessRow) => {
      const groupDn = String(accessRow?.group_dn || '').trim();
      if (!groupDn) return;
      row.set(groupDn, String(accessRow?.access_level || 'member'));
    });
    lookup.set(login, row);
  });
  return lookup;
};

export const buildMatrixRows = ({ users = [], groups = [] }) => {
  const accessLookup = buildAccessLookup(users);
  return users.map((user) => {
    const login = String(user?.login || '').trim();
    const accessByGroup = accessLookup.get(login) || new Map();
    const cells = groups.map((group) => {
      const groupDn = String(group?.dn || '').trim();
      return accessByGroup.get(groupDn) || '';
    });
    return {
      login,
      display_name: String(user?.display_name || login),
      cells,
    };
  });
};

const formatSyncedStamp = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return 'snapshot';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw.replace(/[:.]/g, '-');
  return date.toISOString().slice(0, 16).replace(/[:T]/g, '-');
};

export const exportGroupsAccessWorkbook = ({
  groups = [],
  users = [],
  branch = '',
  syncedAt = '',
} = {}) => {
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
