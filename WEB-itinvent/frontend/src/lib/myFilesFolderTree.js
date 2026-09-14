import { getFolderRelativePath } from './myFilesFolderZip';

export const folderDirPathOfFile = (file) => {
  const relative = getFolderRelativePath(file);
  const parts = relative.split('/').filter(Boolean);
  return parts.slice(0, -1).join('/');
};

export const collectFolderUploadDirs = (files) => {
  const dirs = new Set();
  Array.from(files || []).forEach((file) => {
    const dirPath = folderDirPathOfFile(file);
    if (!dirPath) return;
    const parts = dirPath.split('/');
    for (let index = 1; index <= parts.length; index += 1) {
      dirs.add(parts.slice(0, index).join('/'));
    }
  });
  return [...dirs].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
};

export const folderUploadRootName = (files) => {
  const list = Array.from(files || []);
  for (const file of list) {
    const relative = getFolderRelativePath(file);
    const first = relative.split('/').filter(Boolean)[0];
    if (first) return first;
  }
  return '';
};

export const folderSiblingKey = (parentId, name) => `${parentId || ''}::${String(name || '').trim().toLowerCase()}`;

export const indexFoldersBySibling = (folders) => {
  const map = new Map();
  Array.from(folders || []).forEach((folder) => {
    map.set(folderSiblingKey(folder?.parent_id, folder?.name), String(folder.id));
  });
  return map;
};
