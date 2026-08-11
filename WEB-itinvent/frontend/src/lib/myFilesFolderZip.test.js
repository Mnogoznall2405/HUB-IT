import { describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import {
  collectDataTransferFiles,
  getFolderRelativePath,
  isFolderFileSelection,
  packFolderFilesToZip,
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

  it('packs folder files into a zip preserving relative paths', async () => {
    const onProgress = vi.fn();
    const files = [
      makeFolderFile('Reports/readme.txt', 'hello'),
      makeFolderFile('Reports/data/list.csv', 'a,b\n1,2\n'),
    ];

    const archive = await packFolderFilesToZip(files, { onProgress });
    expect(archive.name).toBe('Reports.zip');
    expect(archive.type).toBe('application/zip');
    expect(onProgress).toHaveBeenCalled();
    expect(onProgress).toHaveBeenLastCalledWith(1);

    const archiveBytes = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result));
      reader.onerror = () => reject(reader.error || new Error('read failed'));
      reader.readAsArrayBuffer(archive);
    });
    const unpacked = unzipSync(archiveBytes);
    expect(Object.keys(unpacked).sort()).toEqual([
      'Reports/data/list.csv',
      'Reports/readme.txt',
    ]);
    expect(strFromU8(unpacked['Reports/readme.txt'])).toBe('hello');
  });

  it('rejects empty folder selections', async () => {
    await expect(packFolderFilesToZip([])).rejects.toThrow(/пуста/i);
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
