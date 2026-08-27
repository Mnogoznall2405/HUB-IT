const STATIC_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
]);

export const CHAT_IMAGE_EDITOR_MAX_DIMENSION = 1920;
export const CHAT_IMAGE_EDITOR_PREVIEW_MAX_DIMENSION = 960;

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number(value || 0)));

const createCanvas = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
};

const getCanvasContext = (canvas) => {
  const context = canvas?.getContext?.('2d');
  if (!context) throw new Error('Canvas 2D is not supported');
  return context;
};

const copyCanvas = (source) => {
  const copy = createCanvas(source.width, source.height);
  getCanvasContext(copy).drawImage(source, 0, 0);
  return copy;
};

const normalizePoint = (point = {}) => ({
  x: clamp(point.x),
  y: clamp(point.y),
});

const normalizeOperation = (operation = {}) => {
  const type = String(operation?.type || '').trim();
  if (type === 'rotate') {
    const turns = ((Math.round(Number(operation.turns || 1)) % 4) + 4) % 4;
    return turns ? { type, turns } : null;
  }
  if (type === 'crop') {
    const x = clamp(operation.x);
    const y = clamp(operation.y);
    const width = clamp(operation.width, 0, 1 - x);
    const height = clamp(operation.height, 0, 1 - y);
    if (width < 0.02 || height < 0.02) return null;
    return { type, x, y, width, height };
  }
  if (type === 'draw' || type === 'blur') {
    const points = (Array.isArray(operation.points) ? operation.points : [])
      .map(normalizePoint)
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (points.length === 0) return null;
    return {
      type,
      points,
      size: clamp(operation.size || 0.018, 0.004, 0.12),
      ...(type === 'draw' ? { color: String(operation.color || '#ffffff') } : {}),
    };
  }
  if (type === 'text') {
    const text = String(operation.text || '').trim().slice(0, 500);
    if (!text) return null;
    return {
      type,
      text,
      ...normalizePoint(operation),
      color: String(operation.color || '#ffffff'),
      size: clamp(operation.size || 0.055, 0.025, 0.16),
    };
  }
  return null;
};

export const createEmptyChatImageEditRecipe = () => ({ version: 1, operations: [] });

export const normalizeChatImageEditRecipe = (recipe) => ({
  version: 1,
  operations: (Array.isArray(recipe?.operations) ? recipe.operations : [])
    .map(normalizeOperation)
    .filter(Boolean),
});

export const appendChatImageEditOperation = (recipe, operation) => {
  const normalized = normalizeOperation(operation);
  if (!normalized) return normalizeChatImageEditRecipe(recipe);
  const current = normalizeChatImageEditRecipe(recipe);
  return { ...current, operations: [...current.operations, normalized] };
};

export const hasChatImageEdits = (recipe) => normalizeChatImageEditRecipe(recipe).operations.length > 0;

export const isChatImageEditorSupported = (file) => STATIC_IMAGE_TYPES.has(
  String(file?.type || '').trim().toLowerCase(),
);

export const loadChatImageSource = (file) => new Promise((resolve, reject) => {
  if (!isChatImageEditorSupported(file)) {
    reject(new Error('Unsupported image format'));
    return;
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Unable to decode image'));
  };
  image.src = url;
});

const rotateCanvas = (source, turns) => {
  let current = source;
  for (let index = 0; index < turns; index += 1) {
    const rotated = createCanvas(current.height, current.width);
    const context = getCanvasContext(rotated);
    context.translate(rotated.width / 2, rotated.height / 2);
    context.rotate(Math.PI / 2);
    context.drawImage(current, -current.width / 2, -current.height / 2);
    current = rotated;
  }
  return current;
};

const cropCanvas = (source, operation) => {
  const sourceX = Math.max(0, Math.floor(operation.x * source.width));
  const sourceY = Math.max(0, Math.floor(operation.y * source.height));
  const width = Math.max(1, Math.min(source.width - sourceX, Math.round(operation.width * source.width)));
  const height = Math.max(1, Math.min(source.height - sourceY, Math.round(operation.height * source.height)));
  const cropped = createCanvas(width, height);
  getCanvasContext(cropped).drawImage(source, sourceX, sourceY, width, height, 0, 0, width, height);
  return cropped;
};

const traceStroke = (context, points, width, color) => {
  const resolvedPoints = points.map((point) => ({
    x: point.x * context.canvas.width,
    y: point.y * context.canvas.height,
  }));
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = Math.max(2, width * Math.min(context.canvas.width, context.canvas.height));
  context.strokeStyle = color;
  context.fillStyle = color;
  if (resolvedPoints.length === 1) {
    context.beginPath();
    context.arc(resolvedPoints[0].x, resolvedPoints[0].y, context.lineWidth / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.beginPath();
    context.moveTo(resolvedPoints[0].x, resolvedPoints[0].y);
    resolvedPoints.slice(1).forEach((point) => context.lineTo(point.x, point.y));
    context.stroke();
  }
  context.restore();
};

const drawText = (canvas, operation) => {
  const context = getCanvasContext(canvas);
  const fontSize = Math.max(14, operation.size * Math.min(canvas.width, canvas.height));
  const lineHeight = fontSize * 1.18;
  const lines = operation.text.split(/\r?\n/).slice(0, 8);
  context.save();
  context.font = `700 ${fontSize}px "Segoe UI", Arial, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.lineWidth = Math.max(2, fontSize * 0.09);
  context.strokeStyle = 'rgba(0, 0, 0, 0.72)';
  context.fillStyle = operation.color;
  const startY = operation.y * canvas.height - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => {
    const y = startY + index * lineHeight;
    context.strokeText(line, operation.x * canvas.width, y);
    context.fillText(line, operation.x * canvas.width, y);
  });
  context.restore();
};

const applyBlurStroke = (canvas, operation) => {
  const blurred = copyCanvas(canvas);
  const blurredContext = getCanvasContext(blurred);
  const radius = Math.max(5, operation.size * Math.min(canvas.width, canvas.height) * 0.65);
  blurredContext.clearRect(0, 0, blurred.width, blurred.height);
  blurredContext.filter = `blur(${radius}px)`;
  blurredContext.drawImage(canvas, 0, 0);
  blurredContext.filter = 'none';

  const mask = createCanvas(canvas.width, canvas.height);
  traceStroke(getCanvasContext(mask), operation.points, operation.size, '#ffffff');
  blurredContext.globalCompositeOperation = 'destination-in';
  blurredContext.drawImage(mask, 0, 0);
  blurredContext.globalCompositeOperation = 'source-over';
  getCanvasContext(canvas).drawImage(blurred, 0, 0);
};

export const renderChatImageRecipeToCanvas = (sourceImage, recipe, options = {}) => {
  const sourceWidth = Number(sourceImage?.naturalWidth || sourceImage?.width || 0);
  const sourceHeight = Number(sourceImage?.naturalHeight || sourceImage?.height || 0);
  if (!sourceWidth || !sourceHeight) throw new Error('Image has invalid dimensions');

  const maxDimension = Math.max(320, Number(options.maxDimension || CHAT_IMAGE_EDITOR_MAX_DIMENSION));
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  let canvas = createCanvas(sourceWidth * scale, sourceHeight * scale);
  getCanvasContext(canvas).drawImage(sourceImage, 0, 0, canvas.width, canvas.height);

  normalizeChatImageEditRecipe(recipe).operations.forEach((operation) => {
    if (operation.type === 'rotate') {
      canvas = rotateCanvas(canvas, operation.turns);
    } else if (operation.type === 'crop') {
      canvas = cropCanvas(canvas, operation);
    } else if (operation.type === 'draw') {
      traceStroke(getCanvasContext(canvas), operation.points, operation.size, operation.color);
    } else if (operation.type === 'blur') {
      applyBlurStroke(canvas, operation);
    } else if (operation.type === 'text') {
      drawText(canvas, operation);
    }
  });
  return canvas;
};

const canvasToBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error('Unable to export image'));
  }, type, quality);
});

const resolveOutputType = (file) => {
  const sourceType = String(file?.type || '').trim().toLowerCase();
  if (sourceType === 'image/jpeg' || sourceType === 'image/png' || sourceType === 'image/webp') return sourceType;
  return 'image/png';
};

const replaceExtension = (fileName, mimeType) => {
  const base = (String(fileName || 'photo').trim() || 'photo').replace(/\.[^.]+$/, '');
  const extension = mimeType === 'image/jpeg' ? 'jpg' : (mimeType.split('/')[1] || 'png');
  return `${base}-edited.${extension}`;
};

export const exportChatImageEditFile = async (sourceImage, sourceFile, recipe) => {
  const canvas = renderChatImageRecipeToCanvas(sourceImage, recipe, {
    maxDimension: CHAT_IMAGE_EDITOR_MAX_DIMENSION,
  });
  const type = resolveOutputType(sourceFile);
  const blob = await canvasToBlob(canvas, type, type === 'image/png' ? undefined : 0.9);
  return new File([blob], replaceExtension(sourceFile?.name, type), {
    type,
    lastModified: Date.now(),
  });
};
