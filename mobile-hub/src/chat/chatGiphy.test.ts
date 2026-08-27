import { buildGiphyUrl, mapGiphyResult } from './chatGiphy';

describe('native chat giphy mapper', () => {
  it('maps the same Giphy payload shape as the web emoji panel', () => {
    expect(mapGiphyResult({
      id: 'gif-1',
      title: 'ok',
      images: {
        fixed_width: { url: 'https://media.giphy.com/preview.gif' },
        original: { url: 'https://media.giphy.com/full.gif' },
      },
    })).toEqual({
      id: 'gif-1',
      title: 'ok',
      previewUrl: 'https://media.giphy.com/preview.gif',
      fullUrl: 'https://media.giphy.com/full.gif',
    });
    expect(mapGiphyResult({ id: '', images: {} })).toBeNull();
    expect(buildGiphyUrl('search', 'кот')).toContain('q=%D0%BA%D0%BE%D1%82');
    expect(buildGiphyUrl('trending')).toContain('/trending?');
  });
});

it('keeps the Giphy mapper usable for the native GIF tab', () => {
  expect(mapGiphyResult({
    id: 'x',
    images: { original: { url: 'https://media.giphy.com/x.gif' } },
  })?.fullUrl).toBe('https://media.giphy.com/x.gif');
});
