import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  appendChatImageEditOperation,
  createEmptyChatImageEditRecipe,
  hasChatImageEdits,
  isChatImageEditorSupported,
  normalizeChatImageEditRecipe,
  renderChatImageRecipeToCanvas,
} from './chatImageEditor';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('chatImageEditor recipe model', () => {
  it('keeps supported operations normalized and ignores invalid crop areas', () => {
    const recipe = normalizeChatImageEditRecipe({
      operations: [
        { type: 'rotate', turns: 5 },
        { type: 'crop', x: -1, y: 0.2, width: 0.8, height: 0.6 },
        { type: 'crop', x: 0.5, y: 0.5, width: 0.001, height: 0.001 },
        { type: 'text', x: 2, y: -1, text: ' Текст ' },
      ],
    });

    expect(recipe.operations).toEqual([
      { type: 'rotate', turns: 1 },
      { type: 'crop', x: 0, y: 0.2, width: 0.8, height: 0.6 },
      expect.objectContaining({ type: 'text', x: 1, y: 0, text: 'Текст' }),
    ]);
  });

  it('appends edits immutably and detects the empty recipe', () => {
    const empty = createEmptyChatImageEditRecipe();
    const edited = appendChatImageEditOperation(empty, {
      type: 'draw',
      color: '#ff0000',
      size: 0.02,
      points: [{ x: 0.1, y: 0.2 }],
    });

    expect(hasChatImageEdits(empty)).toBe(false);
    expect(hasChatImageEdits(edited)).toBe(true);
    expect(empty.operations).toEqual([]);
  });

  it('allows static browser raster formats but excludes animated GIF', () => {
    expect(isChatImageEditorSupported(new File(['jpg'], 'photo.jpg', { type: 'image/jpeg' }))).toBe(true);
    expect(isChatImageEditorSupported(new File(['webp'], 'photo.webp', { type: 'image/webp' }))).toBe(true);
    expect(isChatImageEditorSupported(new File(['gif'], 'animation.gif', { type: 'image/gif' }))).toBe(false);
  });

  it('renders rotation and crop in operation order', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext() {
      return {
        canvas: this,
        drawImage: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
      };
    });

    const canvas = renderChatImageRecipeToCanvas(
      { naturalWidth: 400, naturalHeight: 200 },
      {
        operations: [
          { type: 'rotate', turns: 1 },
          { type: 'crop', x: 0, y: 0, width: 0.5, height: 0.5 },
        ],
      },
      { maxDimension: 1000 },
    );

    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(200);
  });
});
