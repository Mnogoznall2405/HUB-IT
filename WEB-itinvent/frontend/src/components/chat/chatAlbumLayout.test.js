import { describe, expect, it } from 'vitest';

import { ALBUM_MAX_TILES, getAlbumTiles } from './chatAlbumLayout';

// Раскладка — чистая функция с таблицей случаев: ошибка здесь ломает ленту, а E2E этого не ловит.
describe('getAlbumTiles', () => {
  it('fills every grid row (spans in a row sum to 6) for 2..10 attachments', () => {
    for (let count = 2; count <= ALBUM_MAX_TILES; count += 1) {
      const { tiles, hiddenCount } = getAlbumTiles(count);
      expect(tiles).toHaveLength(count);
      expect(hiddenCount).toBe(0);
      expect(tiles.reduce((sum, tile) => sum + tile.span, 0) % 6).toBe(0);
    }
  });

  it('makes a single wide tile on top of three attachments', () => {
    const { tiles } = getAlbumTiles(3);
    expect(tiles.map((tile) => tile.span)).toEqual([6, 3, 3]);
    expect(tiles[0].aspectRatio).toBe('16 / 10');
  });

  it('caps the album at ten tiles and reports the hidden rest', () => {
    const { tiles, hiddenCount } = getAlbumTiles(13);
    expect(tiles).toHaveLength(ALBUM_MAX_TILES);
    expect(hiddenCount).toBe(3);
  });
});
