import { normalizeNativeOutgoingTextShare } from './nativeOutgoingShare';

const ORIGIN = 'https://hubit.zsgp.ru';

it('allows only bounded HUB-IT links in the Android share sheet', () => {
  expect(normalizeNativeOutgoingTextShare({
    title: 'Новости',
    text: 'Новая публикация',
    url: `${ORIGIN}/feed?post=one`,
  }, ORIGIN)).toEqual({
    title: 'Новости',
    text: 'Новая публикация',
    url: `${ORIGIN}/feed?post=one`,
  });

  expect(() => normalizeNativeOutgoingTextShare({
    title: 'Подмена',
    text: '',
    url: 'https://evil.example/phishing',
  }, ORIGIN)).toThrow('только ссылки HUB-IT');
  expect(() => normalizeNativeOutgoingTextShare({
    title: 'Новости',
    text: 'x'.repeat(4_001),
    url: '',
  }, ORIGIN)).toThrow('слишком большой');
});
