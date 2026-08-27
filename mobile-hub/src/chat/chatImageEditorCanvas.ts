import { Directory, File, Paths } from 'expo-file-system';
import type { ChatImageEditRecipe } from './chatImageEditor';
import { overlayChatImageEditRecipe } from './chatImageEditor';

export const CHAT_IMAGE_EDITOR_EXPORT_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1" />
<style>html,body{margin:0;background:#000}canvas{display:none}</style>
</head>
<body>
<script>
function post(payload) {
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload));
}
function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value || 0))); }
function createCanvas(width, height) {
  var canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}
function copyCanvas(source) {
  var copy = createCanvas(source.width, source.height);
  copy.getContext('2d').drawImage(source, 0, 0);
  return copy;
}
function rotateCanvas(source, turns) {
  var current = source;
  for (var i = 0; i < turns; i += 1) {
    var rotated = createCanvas(current.height, current.width);
    var context = rotated.getContext('2d');
    context.translate(rotated.width / 2, rotated.height / 2);
    context.rotate(Math.PI / 2);
    context.drawImage(current, -current.width / 2, -current.height / 2);
    current = rotated;
  }
  return current;
}
function cropCanvas(source, operation) {
  var sourceX = Math.max(0, Math.floor(operation.x * source.width));
  var sourceY = Math.max(0, Math.floor(operation.y * source.height));
  var width = Math.max(1, Math.min(source.width - sourceX, Math.round(operation.width * source.width)));
  var height = Math.max(1, Math.min(source.height - sourceY, Math.round(operation.height * source.height)));
  var cropped = createCanvas(width, height);
  cropped.getContext('2d').drawImage(source, sourceX, sourceY, width, height, 0, 0, width, height);
  return cropped;
}
function traceStroke(context, points, width, color) {
  var resolved = points.map(function (point) {
    return { x: point.x * context.canvas.width, y: point.y * context.canvas.height };
  });
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = Math.max(2, width * Math.min(context.canvas.width, context.canvas.height));
  context.strokeStyle = color;
  context.fillStyle = color;
  if (resolved.length === 1) {
    context.beginPath();
    context.arc(resolved[0].x, resolved[0].y, context.lineWidth / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.beginPath();
    context.moveTo(resolved[0].x, resolved[0].y);
    resolved.slice(1).forEach(function (point) { context.lineTo(point.x, point.y); });
    context.stroke();
  }
  context.restore();
}
function drawText(canvas, operation) {
  var context = canvas.getContext('2d');
  var fontSize = Math.max(14, operation.size * Math.min(canvas.width, canvas.height));
  var lineHeight = fontSize * 1.18;
  var lines = String(operation.text || '').split(/\\r?\\n/).slice(0, 8);
  context.save();
  context.font = '700 ' + fontSize + 'px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.lineWidth = Math.max(2, fontSize * 0.09);
  context.strokeStyle = 'rgba(0,0,0,0.72)';
  context.fillStyle = operation.color;
  var startY = operation.y * canvas.height - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach(function (line, index) {
    var y = startY + index * lineHeight;
    context.strokeText(line, operation.x * canvas.width, y);
    context.fillText(line, operation.x * canvas.width, y);
  });
  context.restore();
}
function applyBlurStroke(canvas, operation) {
  var blurred = copyCanvas(canvas);
  var blurredContext = blurred.getContext('2d');
  var radius = Math.max(5, operation.size * Math.min(canvas.width, canvas.height) * 0.65);
  blurredContext.clearRect(0, 0, blurred.width, blurred.height);
  blurredContext.filter = 'blur(' + radius + 'px)';
  blurredContext.drawImage(canvas, 0, 0);
  blurredContext.filter = 'none';
  var mask = createCanvas(canvas.width, canvas.height);
  traceStroke(mask.getContext('2d'), operation.points, operation.size, '#ffffff');
  blurredContext.globalCompositeOperation = 'destination-in';
  blurredContext.drawImage(mask, 0, 0);
  blurredContext.globalCompositeOperation = 'source-over';
  canvas.getContext('2d').drawImage(blurred, 0, 0);
}
function renderRecipe(image, recipe) {
  var maxDimension = 1920;
  var scale = Math.min(1, maxDimension / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
  var canvas = createCanvas((image.naturalWidth || image.width) * scale, (image.naturalHeight || image.height) * scale);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  (recipe.operations || []).forEach(function (operation) {
    if (operation.type === 'rotate') canvas = rotateCanvas(canvas, operation.turns);
    else if (operation.type === 'crop') canvas = cropCanvas(canvas, operation);
    else if (operation.type === 'draw') traceStroke(canvas.getContext('2d'), operation.points, operation.size, operation.color);
    else if (operation.type === 'blur') applyBlurStroke(canvas, operation);
    else if (operation.type === 'text') drawText(canvas, operation);
  });
  return canvas;
}
window.__hubitExport = function (payload) {
  var image = new Image();
  image.onload = function () {
    try {
      var canvas = renderRecipe(image, payload.recipe || { operations: [] });
      post({ type: 'exported', requestId: payload.requestId, dataUrl: canvas.toDataURL('image/jpeg', 0.9) });
    } catch (error) {
      post({ type: 'error', requestId: payload.requestId, message: String(error && error.message || error) });
    }
  };
  image.onerror = function () {
    post({ type: 'error', requestId: payload.requestId, message: 'decode' });
  };
  image.src = payload.imageDataUrl;
};
post({ type: 'ready' });
</script>
</body>
</html>`;

export function parseChatImageEditorExportMessage(raw: string): {
  type: string;
  requestId?: string;
  dataUrl?: string;
  message?: string;
} | null {
  try {
    const payload = JSON.parse(raw) as {
      type?: string;
      requestId?: string;
      dataUrl?: string;
      message?: string;
    };
    return payload && typeof payload === 'object' && typeof payload.type === 'string'
      ? { ...payload, type: payload.type }
      : null;
  } catch {
    return null;
  }
}

export async function readLocalImageDataUrl(uri: string): Promise<string> {
  const file = new File(uri);
  const base64 = await file.base64();
  const mime = String(file.type || 'image/jpeg').trim() || 'image/jpeg';
  return `data:${mime};base64,${base64}`;
}

export function writeEditedImageFromDataUrl(dataUrl: string): { uri: string; name: string; mimeType: string; size: number } {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(String(dataUrl || '').trim());
  if (!match) throw new Error('Некорректный результат редактора');
  const mimeType = match[1] === 'image/png' ? 'image/png' : 'image/jpeg';
  const directory = new Directory(Paths.cache, 'hubit-edits');
  directory.create({ intermediates: true, idempotent: true });
  const name = `chat-edit-${Date.now()}.${mimeType === 'image/png' ? 'png' : 'jpg'}`;
  const file = new File(directory, name);
  if (file.exists) file.delete();
  file.write(match[2], { encoding: 'base64' });
  return {
    uri: file.uri,
    name,
    mimeType,
    size: Math.max(1, Number(file.size || 0) || Math.floor((match[2].length * 3) / 4)),
  };
}

export function shouldExportChatImageRecipe(recipe?: ChatImageEditRecipe | null): boolean {
  return overlayChatImageEditRecipe(recipe).operations.length > 0;
}
