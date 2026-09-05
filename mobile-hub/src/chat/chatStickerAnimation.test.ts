import { gzipSync, strToU8 } from 'fflate';
import {
  decodeTgsStickerPayload,
  isTgsStickerSource,
  stickerAnimationCacheName,
} from './chatStickerAnimation';

const animation = {
  v: '5.7.4',
  fr: 30,
  ip: 0,
  op: 60,
  w: 512,
  h: 512,
  assets: [],
  layers: [],
};

describe('native animated sticker model', () => {
  it('decodes both raw and Telegram gzip-compressed Lottie JSON', () => {
    const raw = strToU8(JSON.stringify(animation));
    expect(decodeTgsStickerPayload(raw)).toMatchObject(animation);
    expect(decodeTgsStickerPayload(gzipSync(raw))).toMatchObject(animation);
  });

  it('rejects invalid payloads and keeps cache file extensions playable', () => {
    expect(() => decodeTgsStickerPayload(strToU8('{}'))).toThrow('Некорректная анимация TGS');
    expect(isTgsStickerSource('application/x-tgsticker', '/stickers/1/file')).toBe(true);
    expect(isTgsStickerSource('video/webm', '/stickers/2/file')).toBe(false);
    expect(stickerAnimationCacheName('/stickers/1/file', true)).toMatch(/\.tgs$/);
    expect(stickerAnimationCacheName('/stickers/2/file', false)).toMatch(/\.webm$/);
  });
});
