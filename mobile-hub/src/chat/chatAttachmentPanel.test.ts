import {
  MEDIA_MAX_SELECTION,
  formatMediaDuration,
  guessMediaMimeType,
  mediaAssetToPickedFile,
  mediaSelectionBadge,
  reorderPanelAssets,
  toggleMediaSelection,
  type PanelMediaAsset,
} from './chatAttachmentPanel';

const asset = (id: string, mediaType: 'photo' | 'video' = 'photo'): PanelMediaAsset => ({
  id,
  uri: `content://media/${id}`,
  filename: `${id}.jpg`,
  mediaType,
  duration: 0,
});

describe('attachment panel helpers', () => {
  it('keeps pick order and toggles off', () => {
    let selected: PanelMediaAsset[] = [];
    selected = toggleMediaSelection(selected, asset('a'));
    selected = toggleMediaSelection(selected, asset('b'));
    selected = toggleMediaSelection(selected, asset('c'));
    expect(selected.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(mediaSelectionBadge(selected, 'b')).toBe('2');
    selected = toggleMediaSelection(selected, asset('b'));
    expect(selected.map((item) => item.id)).toEqual(['a', 'c']);
    expect(mediaSelectionBadge(selected, 'c')).toBe('2');
  });

  it('respects the selection limit', () => {
    let selected: PanelMediaAsset[] = [];
    for (let index = 0; index < MEDIA_MAX_SELECTION + 2; index += 1) {
      selected = toggleMediaSelection(selected, asset(`x${index}`));
    }
    expect(selected).toHaveLength(MEDIA_MAX_SELECTION);
  });

  it('maps assets to picked files through upload policy', () => {
    const file = mediaAssetToPickedFile({
      id: 'content://media/42',
      uri: 'content://media/42',
      filename: 'IMG_0042.jpg',
      mediaType: 'photo',
      duration: 0,
    });
    expect(file.name).toBe('IMG_0042.jpg');
    expect(file.mimeType).toBe('image/jpeg');
    expect(file.source).toBe('gallery');
  });

  it('guesses mime types for common extensions', () => {
    expect(guessMediaMimeType(asset('a', 'video'))).toBe('image/jpeg');
    expect(guessMediaMimeType({ ...asset('b', 'video'), filename: 'clip.mov' })).toBe('video/quicktime');
    expect(guessMediaMimeType({ ...asset('c'), filename: 'pic.png' })).toBe('image/png');
  });

  it('formats video duration', () => {
    expect(formatMediaDuration(0)).toBe('0:00');
    expect(formatMediaDuration(75)).toBe('1:15');
    expect(formatMediaDuration(600)).toBe('10:00');
  });

  it('reorders the selection to a drag order and keeps unlisted picks', () => {
    const selected = [asset('a'), asset('b'), asset('c'), asset('d')];
    expect(reorderPanelAssets(selected, ['c', 'a', 'b', 'd']).map((item) => item.id))
      .toEqual(['c', 'a', 'b', 'd']);
    expect(reorderPanelAssets(selected, ['d', 'a']).map((item) => item.id))
      .toEqual(['d', 'a', 'b', 'c']);
    expect(reorderPanelAssets(selected, ['b', 'x', 'b', 'a', 'c', 'd']).map((item) => item.id))
      .toEqual(['b', 'a', 'c', 'd']);
  });
});
