export type ChatImageCropAspect = 'original' | '1:1' | '4:3' | '16:9';
export type ChatImageEditorTool = 'crop' | 'draw' | 'text' | 'blur';

export type ChatImageCropRect = {
  originX: number;
  originY: number;
  width: number;
  height: number;
};

export type ChatImagePoint = { x: number; y: number };

export type ChatImageEditOperation =
  | { type: 'rotate'; turns: number }
  | { type: 'crop'; x: number; y: number; width: number; height: number }
  | { type: 'draw'; points: ChatImagePoint[]; size: number; color: string }
  | { type: 'blur'; points: ChatImagePoint[]; size: number }
  | { type: 'text'; x: number; y: number; text: string; color: string; size: number };

export type ChatImageEditRecipe = {
  version: 1;
  operations: ChatImageEditOperation[];
};

export type ChatImageEditorHistory = {
  past: ChatImageEditRecipe[];
  present: ChatImageEditRecipe;
  future: ChatImageEditRecipe[];
};

const clamp01 = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, Number(value || 0)));

function normalizePoint(point?: Partial<ChatImagePoint> | null): ChatImagePoint {
  return { x: clamp01(Number(point?.x)), y: clamp01(Number(point?.y)) };
}

function normalizeOperation(operation?: Partial<ChatImageEditOperation> | null): ChatImageEditOperation | null {
  const type = String(operation?.type || '').trim();
  if (type === 'rotate') {
    const turns = ((Math.round(Number((operation as { turns?: number })?.turns || 1)) % 4) + 4) % 4;
    return turns ? { type, turns } : null;
  }
  if (type === 'crop') {
    const crop = operation as { x?: number; y?: number; width?: number; height?: number };
    const x = clamp01(Number(crop?.x));
    const y = clamp01(Number(crop?.y));
    const width = clamp01(Number(crop?.width), 0, 1 - x);
    const height = clamp01(Number(crop?.height), 0, 1 - y);
    if (width < 0.02 || height < 0.02) return null;
    return { type, x, y, width, height };
  }
  if (type === 'draw' || type === 'blur') {
    const stroke = operation as { points?: ChatImagePoint[]; size?: number; color?: string };
    const points = (Array.isArray(stroke?.points) ? stroke.points : [])
      .map(normalizePoint)
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (!points.length) return null;
    const size = clamp01(Number(stroke?.size || 0.018), 0.004, 0.12);
    return type === 'draw'
      ? { type: 'draw', points, size, color: String(stroke?.color || '#ffffff') }
      : { type: 'blur', points, size };
  }
  if (type === 'text') {
    const textOp = operation as { text?: string; x?: number; y?: number; color?: string; size?: number };
    const text = String(textOp?.text || '').trim().slice(0, 500);
    if (!text) return null;
    return {
      type,
      text,
      ...normalizePoint(textOp),
      color: String(textOp?.color || '#ffffff'),
      size: clamp01(Number(textOp?.size || 0.055), 0.025, 0.16),
    };
  }
  return null;
}

export function createEmptyChatImageEditRecipe(): ChatImageEditRecipe {
  return { version: 1, operations: [] };
}

export function normalizeChatImageEditRecipe(recipe?: Partial<ChatImageEditRecipe> | null): ChatImageEditRecipe {
  return {
    version: 1,
    operations: (Array.isArray(recipe?.operations) ? recipe.operations : [])
      .map((operation) => normalizeOperation(operation))
      .filter((operation): operation is ChatImageEditOperation => Boolean(operation)),
  };
}

export function appendChatImageEditOperation(
  recipe: Partial<ChatImageEditRecipe> | null | undefined,
  operation: Partial<ChatImageEditOperation> | null | undefined,
): ChatImageEditRecipe {
  const normalized = normalizeOperation(operation);
  const current = normalizeChatImageEditRecipe(recipe);
  if (!normalized) return current;
  return { ...current, operations: [...current.operations, normalized] };
}

export function hasChatImageEdits(recipe?: Partial<ChatImageEditRecipe> | null): boolean {
  return normalizeChatImageEditRecipe(recipe).operations.length > 0;
}

export function recipesEqual(
  left?: Partial<ChatImageEditRecipe> | null,
  right?: Partial<ChatImageEditRecipe> | null,
): boolean {
  return JSON.stringify(normalizeChatImageEditRecipe(left)) === JSON.stringify(normalizeChatImageEditRecipe(right));
}

export function createChatImageEditorHistory(
  recipe?: Partial<ChatImageEditRecipe> | null,
): ChatImageEditorHistory {
  return { past: [], present: normalizeChatImageEditRecipe(recipe), future: [] };
}

export function commitChatImageEditorOperation(
  history: ChatImageEditorHistory,
  operation: Partial<ChatImageEditOperation> | null | undefined,
): ChatImageEditorHistory {
  const present = appendChatImageEditOperation(history.present, operation);
  if (recipesEqual(present, history.present)) return history;
  return {
    past: [...history.past, history.present].slice(-50),
    present,
    future: [],
  };
}

export function undoChatImageEditorHistory(history: ChatImageEditorHistory): ChatImageEditorHistory {
  if (!history.past.length) return history;
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
    future: [history.present, ...history.future].slice(0, 50),
  };
}

export function redoChatImageEditorHistory(history: ChatImageEditorHistory): ChatImageEditorHistory {
  if (!history.future.length) return history;
  return {
    past: [...history.past, history.present].slice(-50),
    present: history.future[0],
    future: history.future.slice(1),
  };
}

export function resetChatImageEditorHistory(history: ChatImageEditorHistory): ChatImageEditorHistory {
  const empty = createEmptyChatImageEditRecipe();
  if (recipesEqual(history.present, empty)) return history;
  return {
    past: [...history.past, history.present].slice(-50),
    present: empty,
    future: [],
  };
}

export function overlayChatImageEditRecipe(recipe?: Partial<ChatImageEditRecipe> | null): ChatImageEditRecipe {
  return {
    version: 1,
    operations: normalizeChatImageEditRecipe(recipe).operations.filter((operation) => (
      operation.type === 'draw' || operation.type === 'blur' || operation.type === 'text'
    )),
  };
}

export function hasOverlayChatImageEdits(recipe?: Partial<ChatImageEditRecipe> | null): boolean {
  return overlayChatImageEditRecipe(recipe).operations.length > 0;
}

export function containedImageRect(
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number,
): ChatImageCropRect | null {
  const boxWidth = Math.max(0, containerWidth);
  const boxHeight = Math.max(0, containerHeight);
  const sourceWidth = Math.max(0, imageWidth);
  const sourceHeight = Math.max(0, imageHeight);
  if (boxWidth < 2 || boxHeight < 2 || sourceWidth < 1 || sourceHeight < 1) return null;
  const scale = Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight);
  const width = Math.max(1, sourceWidth * scale);
  const height = Math.max(1, sourceHeight * scale);
  return {
    originX: Math.max(0, (boxWidth - width) / 2),
    originY: Math.max(0, (boxHeight - height) / 2),
    width,
    height,
  };
}

export function pointInContainedImage(
  locationX: number,
  locationY: number,
  rect: ChatImageCropRect | null,
): ChatImagePoint | null {
  if (!rect || rect.width < 2 || rect.height < 2) return null;
  const x = (locationX - rect.originX) / rect.width;
  const y = (locationY - rect.originY) / rect.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

export function cropRectFromNormalized(
  width: number,
  height: number,
  crop: { x: number; y: number; width: number; height: number },
): ChatImageCropRect | null {
  const sourceWidth = Math.max(0, Math.round(width));
  const sourceHeight = Math.max(0, Math.round(height));
  if (sourceWidth < 2 || sourceHeight < 2) return null;
  const originX = Math.max(0, Math.floor(crop.x * sourceWidth));
  const originY = Math.max(0, Math.floor(crop.y * sourceHeight));
  const nextWidth = Math.max(2, Math.min(sourceWidth - originX, Math.round(crop.width * sourceWidth)));
  const nextHeight = Math.max(2, Math.min(sourceHeight - originY, Math.round(crop.height * sourceHeight)));
  if (nextWidth < 2 || nextHeight < 2) return null;
  return { originX, originY, width: nextWidth, height: nextHeight };
}

export function centeredCropRect(
  width: number,
  height: number,
  aspectWidth: number,
  aspectHeight: number,
): ChatImageCropRect | null {
  const sourceWidth = Math.max(0, Math.round(width));
  const sourceHeight = Math.max(0, Math.round(height));
  if (sourceWidth < 2 || sourceHeight < 2 || aspectWidth <= 0 || aspectHeight <= 0) return null;
  const target = aspectWidth / aspectHeight;
  const current = sourceWidth / sourceHeight;
  if (Math.abs(current - target) < 0.01) {
    return { originX: 0, originY: 0, width: sourceWidth, height: sourceHeight };
  }
  if (current > target) {
    const nextWidth = Math.max(2, Math.round(sourceHeight * target));
    return {
      originX: Math.max(0, Math.round((sourceWidth - nextWidth) / 2)),
      originY: 0,
      width: Math.min(nextWidth, sourceWidth),
      height: sourceHeight,
    };
  }
  const nextHeight = Math.max(2, Math.round(sourceWidth / target));
  return {
    originX: 0,
    originY: Math.max(0, Math.round((sourceHeight - nextHeight) / 2)),
    width: sourceWidth,
    height: Math.min(nextHeight, sourceHeight),
  };
}

export function cropRectForAspect(
  width: number,
  height: number,
  aspect: ChatImageCropAspect,
): ChatImageCropRect | null {
  if (aspect === 'original') return null;
  if (aspect === '1:1') return centeredCropRect(width, height, 1, 1);
  if (aspect === '16:9') return centeredCropRect(width, height, 16, 9);
  return centeredCropRect(width, height, 4, 3);
}

export function nextImageRotation(currentDegrees: number): number {
  return (Math.round(currentDegrees / 90) * 90 + 90) % 360;
}
