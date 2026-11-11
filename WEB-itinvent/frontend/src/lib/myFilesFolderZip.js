/**
 * Folder drag-and-drop collection for «Мой диск»: webkitGetAsEntry traversal
 * and relative-path helpers used by the folder upload flow.
 */

export const sanitizeZipEntryPath = (value) => {
  const normalized = String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim();
  if (!normalized) return '';
  const parts = normalized
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..');
  return parts.join('/');
};

export const attachRelativePath = (file, relativePath) => {
  const safePath = sanitizeZipEntryPath(relativePath || file?.name || '');
  if (!file) return null;
  try {
    Object.defineProperty(file, 'webkitRelativePath', {
      configurable: true,
      value: safePath,
    });
    return file;
  } catch {
    const wrapped = new File([file], file.name, {
      type: file.type || 'application/octet-stream',
      lastModified: file.lastModified || Date.now(),
    });
    Object.defineProperty(wrapped, 'webkitRelativePath', {
      configurable: true,
      value: safePath,
    });
    return wrapped;
  }
};

export const getFolderRelativePath = (file) => {
  const relative = sanitizeZipEntryPath(file?.webkitRelativePath || '');
  if (relative) return relative;
  return sanitizeZipEntryPath(file?.name || '');
};

export const isFolderFileSelection = (files) => {
  const list = Array.from(files || []).filter(Boolean);
  if (list.length === 0) return false;
  return list.every((file) => String(file?.webkitRelativePath || '').replace(/\\/g, '/').includes('/'));
};

const readAllDirectoryEntries = async (directoryEntry) => {
  const reader = directoryEntry.createReader();
  const entries = [];
  // readEntries() may return partial batches until an empty result.
  for (;;) {
    const batch = await new Promise((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (!batch.length) break;
    entries.push(...batch);
  }
  return entries;
};

const collectEntryFiles = async (entry, pathPrefix = '') => {
  if (!entry) return { files: [], sawDirectory: false };

  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => {
      entry.file(resolve, reject);
    });
    const relativePath = sanitizeZipEntryPath(`${pathPrefix}${file.name}`);
    return {
      files: [attachRelativePath(file, relativePath)].filter(Boolean),
      sawDirectory: false,
    };
  }

  if (!entry.isDirectory) {
    return { files: [], sawDirectory: false };
  }

  const childPrefix = sanitizeZipEntryPath(`${pathPrefix}${entry.name}`);
  const nextPrefix = childPrefix ? `${childPrefix}/` : '';
  const children = await readAllDirectoryEntries(entry);
  const files = [];
  for (const child of children) {
    const nested = await collectEntryFiles(child, nextPrefix);
    files.push(...nested.files);
  }
  return { files, sawDirectory: true };
};

/**
 * Read drag-and-drop payload, including whole folders via webkitGetAsEntry.
 * @param {DataTransfer|null|undefined} dataTransfer
 * @returns {Promise<{ files: File[], asFolder: boolean }>}
 */
export const collectDataTransferFiles = async (dataTransfer) => {
  const items = Array.from(dataTransfer?.items || []).filter((item) => item && item.kind === 'file');
  if (items.length === 0) {
    const fallback = Array.from(dataTransfer?.files || []).filter(Boolean);
    return {
      files: fallback,
      asFolder: isFolderFileSelection(fallback),
    };
  }

  const files = [];
  let sawDirectory = false;

  for (const item of items) {
    const entry = typeof item.webkitGetAsEntry === 'function'
      ? item.webkitGetAsEntry()
      : (typeof item.getAsEntry === 'function' ? item.getAsEntry() : null);

    if (entry) {
      const collected = await collectEntryFiles(entry);
      files.push(...collected.files);
      sawDirectory = sawDirectory || collected.sawDirectory;
      continue;
    }

    const file = typeof item.getAsFile === 'function' ? item.getAsFile() : null;
    if (file) files.push(file);
  }

  if (files.length === 0) {
    const fallback = Array.from(dataTransfer?.files || []).filter(Boolean);
    return {
      files: fallback,
      asFolder: isFolderFileSelection(fallback),
    };
  }

  return {
    files,
    asFolder: sawDirectory || isFolderFileSelection(files),
  };
};

export const resolveFolderArchiveName = (files) => {
  const roots = new Set();
  for (const file of Array.from(files || []).filter(Boolean)) {
    const relative = getFolderRelativePath(file);
    const root = relative.split('/')[0];
    if (root) roots.add(root);
  }
  if (roots.size === 1) return `${[...roots][0]}.zip`;
  return 'folder.zip';
};

export const summarizeFolderSelection = (files) => {
  const list = Array.from(files || []).filter(Boolean);
  const totalBytes = list.reduce((sum, file) => sum + Number(file?.size || 0), 0);
  return {
    fileCount: list.length,
    totalBytes,
    archiveName: resolveFolderArchiveName(list),
    folderName: resolveFolderArchiveName(list).replace(/\.zip$/i, '') || 'folder',
  };
};

