import { buildNativeMailFolderOptions } from './nativeMailFolders';

describe('native mail folder options', () => {
  it('keeps standard folders and exposes custom nested folders with their exact ids', () => {
    const options = buildNativeMailFolderOptions([
      { id: 'inbox', label: 'Входящие', well_known_key: 'inbox', unread: 2 },
      { id: 'custom-projects', label: 'Проекты' },
      { id: 'custom-2026', label: '2026', parent_id: 'custom-projects', unread: 3 },
    ]);

    expect(options.slice(0, 2).map((item) => item.id)).toEqual(['inbox', 'sent']);
    expect(options).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'custom-projects', pathLabel: 'Проекты', standard: false }),
      expect.objectContaining({ id: 'custom-2026', pathLabel: 'Проекты / 2026', unread: 3, depth: 1 }),
    ]));
  });

  it('uses the summary as fallback when the server returns no tree', () => {
    const options = buildNativeMailFolderOptions([], { inbox: { unread: 7 } });
    expect(options.find((item) => item.id === 'inbox')).toMatchObject({ label: 'Входящие', unread: 7 });
  });

  it('orders favorite custom folders first when the saved view preference is enabled', () => {
    const options = buildNativeMailFolderOptions([
      { id: 'custom-z', label: 'Январь' },
      { id: 'custom-a', label: 'Архив проекта', is_favorite: true },
    ], {}, { favoritesFirst: true });
    const custom = options.filter((item) => !item.standard);

    expect(custom.map((item) => item.id)).toEqual(['custom-a', 'custom-z']);
    expect(custom[0]).toMatchObject({ favorite: true });
  });
});
