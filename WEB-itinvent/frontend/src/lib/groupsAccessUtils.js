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
