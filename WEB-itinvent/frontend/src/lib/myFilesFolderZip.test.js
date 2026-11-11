import { describe, expect, it } from 'vitest';
import {
  collectDataTransferFiles,
  getFolderRelativePath,
  isFolderFileSelection,
  resolveFolderArchiveName,
  sanitizeZipEntryPath,
  summarizeFolderSelection,
} from './myFilesFolderZip';

const makeFolderFile = (relativePath, content = 'x', size) => {
  const name = relativePath.split('/').pop() || 'file.bin';
  const body = content;
  const file = new File([body], name, { type: 'text/plain' });
  Object.defineProperty(file, 'webkitRelativePath', {
    configurable: true,
    value: relativePath,
  });
  if (typeof size === 'number') {
    Object.defineProperty(file, 'size', { configurable: true, value: size });
  }
  return file;
};

describe('myFilesFolderZip', () => {
  it('sanitizes zip entry paths and blocks traversal', () => {
    expect(sanitizeZipEntryPath('../secret/../a.txt')).toBe('secret/a.txt');
    expect(sanitizeZipEntryPath('\\folder\\file.txt')).toBe('folder/file.txt');
    expect(sanitizeZipEntryPath('')).toBe('');
  });

  it('detects folder selections by webkitRelativePath', () => {
    const folderFiles = [
      makeFolderFile('Docs/a.txt'),
      makeFolderFile('Docs/sub/b.txt'),
    ];
    expect(isFolderFileSelection(folderFiles)).toBe(true);
    expect(isFolderFileSelection([new File(['x'], 'alone.txt')])).toBe(false);
    expect(resolveFolderArchiveName(folderFiles)).toBe('Docs.zip');
    expect(getFolderRelativePath(folderFiles[1])).toBe('Docs/sub/b.txt');
    expect(summarizeFolderSelection(folderFiles).fileCount).toBe(2);
  });

  it('collects dropped folder entries via webkitGetAsEntry', async () => {
    const nestedFile = new File(['csv'], 'list.csv', { type: 'text/csv' });
    const nestedEntry = {
      isFile: true,
      isDirectory: false,
      name: 'list.csv',
      file: (resolve) => resolve(nestedFile),
    };
    const dirEntry = {
      isFile: false,
      isDirectory: true,
      name: 'Reports',
      createReader: () => {
        let done = false;
        return {
          readEntries: (resolve) => {
            if (done) {
              resolve([]);
              return;
            }
            done = true;
            resolve([nestedEntry]);
          },
        };
      },
    };

    const dataTransfer = {
      items: [{
        kind: 'file',
        webkitGetAsEntry: () => dirEntry,
      }],
      files: [],
    };

    const result = await collectDataTransferFiles(dataTransfer);
    expect(result.asFolder).toBe(true);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].webkitRelativePath).toBe('Reports/list.csv');
  });
});
