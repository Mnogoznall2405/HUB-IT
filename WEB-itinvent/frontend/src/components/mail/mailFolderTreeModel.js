export const MAIL_FOLDER_LABELS = {
  inbox: 'Входящие',
  sent: 'Отправленные',
  drafts: 'Черновики',
  trash: 'Удаленные',
  junk: 'Нежелательные',
  archive: 'Архив',
};

export const buildFallbackMailFolderTreeItems = (folderSummary = {}) => (
  Object.entries(MAIL_FOLDER_LABELS).map(([id, label]) => ({
    id,
    label,
    name: label,
    scope: id === 'archive' ? 'archive' : 'mailbox',
    icon_key: id,
    well_known_key: id,
    parent_id: null,
    is_favorite: false,
    can_rename: false,
    can_delete: false,
    total: Number(folderSummary?.[id]?.total || 0),
    unread: Number(folderSummary?.[id]?.unread || 0),
  }))
);

export const mergeMailFolderTreeWithSummary = (folderTree, folderSummary = {}, fallbackItems = []) => {
  const source = Array.isArray(folderTree) && folderTree.length > 0 ? folderTree : fallbackItems;
  return source.map((item) => {
    const key = String(item?.well_known_key || '').trim().toLowerCase();
    if (!folderSummary?.[key]) return item;
    return {
      ...item,
      total: Number(folderSummary[key]?.total || 0),
      unread: Number(folderSummary[key]?.unread || 0),
    };
  });
};

export const buildMailFolderLabelMap = (items = []) => {
  const map = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const key = String(item?.id || '');
    if (key) map.set(key, String(item?.label || item?.name || key));
  });
  return map;
};

export const getMailFolderLabel = (folder, labelMap) => (
  labelMap?.get?.(String(folder || '')) || MAIL_FOLDER_LABELS[folder] || 'Письма'
);

export const resolveMailFolderTreeView = ({
  folderTree,
  folderSummary = {},
  folder = '',
} = {}) => {
  const fallbackFolderTreeItems = buildFallbackMailFolderTreeItems(folderSummary);
  const effectiveFolderTreeItems = mergeMailFolderTreeWithSummary(
    folderTree,
    folderSummary,
    fallbackFolderTreeItems,
  );
  const folderLabelMap = buildMailFolderLabelMap(effectiveFolderTreeItems);
  return {
    fallbackFolderTreeItems,
    effectiveFolderTreeItems,
    folderLabelMap,
    currentFolderLabel: getMailFolderLabel(folder, folderLabelMap),
  };
};
