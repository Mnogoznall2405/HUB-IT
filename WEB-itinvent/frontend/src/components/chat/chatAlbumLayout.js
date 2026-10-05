// Раскладка альбома фото/видео в пузыре, как в Telegram: строки плиток, число плиток в строке
// зависит от общего количества. Больше ALBUM_MAX_TILES плиток не показываем — на последней «+N».
export const ALBUM_MAX_TILES = 10;

const ROWS_BY_COUNT = {
  2: [2],
  3: [1, 2],
  4: [1, 3],
  5: [2, 3],
  6: [3, 3],
  7: [1, 3, 3],
  8: [2, 3, 3],
  9: [3, 3, 3],
  10: [1, 3, 3, 3],
};

const ROW_ASPECT = { 1: '16 / 10', 2: '1 / 1', 3: '1 / 1' };

export function getAlbumTiles(totalAttachments) {
  const total = Math.max(0, Math.floor(Number(totalAttachments) || 0));
  const shown = Math.min(total, ALBUM_MAX_TILES);
  const rows = ROWS_BY_COUNT[shown] || [];
  const tiles = [];
  rows.forEach((perRow) => {
    for (let i = 0; i < perRow; i += 1) {
      tiles.push({ span: 6 / perRow, aspectRatio: ROW_ASPECT[perRow] });
    }
  });
  return { tiles, hiddenCount: total - shown };
}
