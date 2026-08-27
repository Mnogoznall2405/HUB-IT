import {
  appendChatImageEditOperation,
  centeredCropRect,
  commitChatImageEditorOperation,
  containedImageRect,
  createChatImageEditorHistory,
  createEmptyChatImageEditRecipe,
  cropRectForAspect,
  cropRectFromNormalized,
  hasChatImageEdits,
  hasOverlayChatImageEdits,
  nextImageRotation,
  normalizeChatImageEditRecipe,
  pointInContainedImage,
  undoChatImageEditorHistory,
} from './chatImageEditor';

describe('native chat image editor helpers', () => {
  it('crops a wide image to a centered square', () => {
    expect(centeredCropRect(1600, 900, 1, 1)).toEqual({
      originX: 350,
      originY: 0,
      width: 900,
      height: 900,
    });
  });

  it('skips crop for the original aspect', () => {
    expect(cropRectForAspect(1200, 800, 'original')).toBeNull();
    expect(cropRectForAspect(1600, 900, '4:3')).toEqual({
      originX: 200,
      originY: 0,
      width: 1200,
      height: 900,
    });
    expect(cropRectForAspect(1600, 900, '16:9')).toEqual({
      originX: 0,
      originY: 0,
      width: 1600,
      height: 900,
    });
  });

  it('rotates clockwise in 90 degree steps', () => {
    expect(nextImageRotation(0)).toBe(90);
    expect(nextImageRotation(270)).toBe(0);
  });

  it('keeps supported operations normalized and ignores invalid crop areas', () => {
    expect(normalizeChatImageEditRecipe({
      operations: [
        { type: 'rotate', turns: 5 },
        { type: 'crop', x: -1, y: 0.2, width: 0.8, height: 0.6 },
        { type: 'crop', x: 0.5, y: 0.5, width: 0.001, height: 0.001 },
        { type: 'text', x: 2, y: -1, text: ' Текст ', color: '#ffffff', size: 0.055 },
      ],
    }).operations).toEqual([
      { type: 'rotate', turns: 1 },
      { type: 'crop', x: 0, y: 0.2, width: 0.8, height: 0.6 },
      expect.objectContaining({ type: 'text', x: 1, y: 0, text: 'Текст' }),
    ]);
  });

  it('appends overlay edits immutably and maps a free crop onto pixels', () => {
    const empty = createEmptyChatImageEditRecipe();
    const edited = appendChatImageEditOperation(empty, {
      type: 'draw',
      color: '#ff0000',
      size: 0.02,
      points: [{ x: 0.1, y: 0.2 }],
    });
    expect(hasChatImageEdits(empty)).toBe(false);
    expect(hasOverlayChatImageEdits(edited)).toBe(true);
    expect(empty.operations).toEqual([]);
    expect(cropRectFromNormalized(1000, 800, { x: 0.1, y: 0.2, width: 0.5, height: 0.4 })).toEqual({
      originX: 100,
      originY: 160,
      width: 500,
      height: 320,
    });
  });

  it('maps a tap on the letterboxed preview back to a normalized point', () => {
    const rect = containedImageRect(200, 200, 400, 200);
    expect(rect).toEqual({ originX: 0, originY: 50, width: 200, height: 100 });
    expect(pointInContainedImage(100, 100, rect)).toEqual({ x: 0.5, y: 0.5 });
    expect(pointInContainedImage(10, 10, rect)).toBeNull();
  });

  it('undoes the last committed overlay operation', () => {
    const drawn = commitChatImageEditorOperation(createChatImageEditorHistory(), {
      type: 'text',
      x: 0.5,
      y: 0.4,
      text: 'Склад',
    });
    expect(drawn.present.operations).toHaveLength(1);
    expect(undoChatImageEditorHistory(drawn).present.operations).toEqual([]);
  });
});
