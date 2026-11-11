import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Slider,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import BlurOnRoundedIcon from '@mui/icons-material/BlurOnRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CropRoundedIcon from '@mui/icons-material/CropRounded';
import DrawRoundedIcon from '@mui/icons-material/DrawRounded';
import RedoRoundedIcon from '@mui/icons-material/RedoRounded';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import Rotate90DegreesCcwRoundedIcon from '@mui/icons-material/Rotate90DegreesCcwRounded';
import TextFieldsRoundedIcon from '@mui/icons-material/TextFieldsRounded';
import UndoRoundedIcon from '@mui/icons-material/UndoRounded';

import {
  CHAT_IMAGE_EDITOR_PREVIEW_MAX_DIMENSION,
  appendChatImageEditOperation,
  createEmptyChatImageEditRecipe,
  exportChatImageEditFile,
  hasChatImageEdits,
  loadChatImageSource,
  normalizeChatImageEditRecipe,
  renderChatImageRecipeToCanvas,
} from './chatImageEditor';

const TOOL_HELP = {
  crop: 'Проведите по фото, чтобы выделить новую область.',
  draw: 'Рисуйте по фото мышью или пальцем.',
  text: 'Введите текст и нажмите на фото или добавьте его по центру.',
  blur: 'Проведите по участкам, которые нужно скрыть.',
};

const recipesEqual = (left, right) => JSON.stringify(
  normalizeChatImageEditRecipe(left),
) === JSON.stringify(normalizeChatImageEditRecipe(right));

const createHistory = (recipe) => ({
  past: [],
  present: normalizeChatImageEditRecipe(recipe),
  future: [],
});

function ToolButton({ active = false, label, onClick, children, disabled = false }) {
  return (
    <Tooltip title={label} arrow>
      <span>
        <IconButton
          aria-label={label}
          aria-pressed={active || undefined}
          disabled={disabled}
          onClick={onClick}
          sx={(theme) => ({
            width: 44,
            height: 44,
            color: active ? theme.palette.primary.contrastText : theme.palette.text.secondary,
            bgcolor: active ? theme.palette.primary.main : 'transparent',
            transition: 'background-color 120ms ease, color 120ms ease, transform 120ms ease',
            '&:hover': { bgcolor: active ? theme.palette.primary.dark : theme.palette.action.hover },
            '&:active': { transform: 'scale(0.96)' },
            '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
          })}
        >
          {children}
        </IconButton>
      </span>
    </Tooltip>
  );
}

export default function ChatImageEditorDialog({
  file,
  initialRecipe,
  onApply,
  onClose,
  open = false,
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const canvasRef = useRef(null);
  const [sourceImage, setSourceImage] = useState(null);
  const [history, setHistory] = useState(() => createHistory(initialRecipe));
  const [tool, setTool] = useState('crop');
  const [draftOperation, setDraftOperation] = useState(null);
  const [pointerStart, setPointerStart] = useState(null);
  const [brushColor, setBrushColor] = useState('#ffffff');
  const [brushSize, setBrushSize] = useState(2.2);
  const [textValue, setTextValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const initialNormalized = useMemo(() => normalizeChatImageEditRecipe(initialRecipe), [initialRecipe]);
  const dirty = useMemo(
    () => !recipesEqual(history.present, initialNormalized),
    [history.present, initialNormalized],
  );

  useEffect(() => {
    if (!open || !file) return undefined;
    let cancelled = false;
    setHistory(createHistory(initialRecipe));
    setDraftOperation(null);
    setPointerStart(null);
    setTool('crop');
    setError('');
    setLoading(true);
    loadChatImageSource(file)
      .then((image) => {
        if (!cancelled) setSourceImage(image);
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось открыть изображение для редактирования.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      setSourceImage(null);
    };
  }, [file, initialRecipe, open]);

  useEffect(() => {
    if (!open || !sourceImage || !canvasRef.current) return;
    try {
      const previewRecipe = draftOperation && draftOperation.type !== 'crop'
        ? appendChatImageEditOperation(history.present, draftOperation)
        : history.present;
      const rendered = renderChatImageRecipeToCanvas(sourceImage, previewRecipe, {
        maxDimension: CHAT_IMAGE_EDITOR_PREVIEW_MAX_DIMENSION,
      });
      const canvas = canvasRef.current;
      canvas.width = rendered.width;
      canvas.height = rendered.height;
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(rendered, 0, 0);
      if (draftOperation?.type === 'crop') {
        const x = draftOperation.x * canvas.width;
        const y = draftOperation.y * canvas.height;
        const width = draftOperation.width * canvas.width;
        const height = draftOperation.height * canvas.height;
        context.save();
        context.fillStyle = 'rgba(0, 0, 0, 0.52)';
        context.fillRect(0, 0, canvas.width, y);
        context.fillRect(0, y, x, height);
        context.fillRect(x + width, y, Math.max(0, canvas.width - x - width), height);
        context.fillRect(0, y + height, canvas.width, Math.max(0, canvas.height - y - height));
        context.strokeStyle = '#ffffff';
        context.lineWidth = Math.max(2, canvas.width / 420);
        context.setLineDash([8, 6]);
        context.strokeRect(x, y, width, height);
        context.restore();
      }
    } catch {
      setError('Не удалось обновить предпросмотр изображения.');
    }
  }, [draftOperation, history.present, open, sourceImage]);

  const commitOperation = useCallback((operation) => {
    setHistory((current) => {
      const nextRecipe = appendChatImageEditOperation(current.present, operation);
      if (recipesEqual(nextRecipe, current.present)) return current;
      return {
        past: [...current.past, current.present].slice(-50),
        present: nextRecipe,
        future: [],
      };
    });
  }, []);

  const undo = useCallback(() => {
    setHistory((current) => {
      if (current.past.length === 0) return current;
      const previous = current.past[current.past.length - 1];
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future].slice(0, 50),
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((current) => {
      if (current.future.length === 0) return current;
      const next = current.future[0];
      return {
        past: [...current.past, current.present].slice(-50),
        present: next,
        future: current.future.slice(1),
      };
    });
  }, []);

  const reset = useCallback(() => {
    setHistory((current) => ({
      past: [...current.past, current.present].slice(-50),
      present: createEmptyChatImageEditRecipe(),
      future: [],
    }));
    setDraftOperation(null);
  }, []);

  const getCanvasPoint = useCallback((event) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }, []);

  const handlePointerDown = useCallback((event) => {
    if (loading || saving || !sourceImage) return;
    const point = getCanvasPoint(event);
    if (!point) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (tool === 'text') {
      const nextText = textValue.trim();
      if (nextText) {
        commitOperation({ type: 'text', ...point, text: nextText, color: brushColor, size: brushSize / 40 });
      }
      return;
    }
    setPointerStart(point);
    if (tool === 'crop') {
      setDraftOperation({ type: 'crop', ...point, width: 0, height: 0 });
    } else if (tool === 'draw' || tool === 'blur') {
      setDraftOperation({
        type: tool,
        points: [point],
        size: brushSize / 100,
        ...(tool === 'draw' ? { color: brushColor } : {}),
      });
    }
  }, [brushColor, brushSize, commitOperation, getCanvasPoint, loading, saving, sourceImage, textValue, tool]);

  const handlePointerMove = useCallback((event) => {
    if (!pointerStart || !draftOperation) return;
    const point = getCanvasPoint(event);
    if (!point) return;
    if (draftOperation.type === 'crop') {
      setDraftOperation({
        type: 'crop',
        x: Math.min(pointerStart.x, point.x),
        y: Math.min(pointerStart.y, point.y),
        width: Math.abs(point.x - pointerStart.x),
        height: Math.abs(point.y - pointerStart.y),
      });
    } else {
      setDraftOperation((current) => ({
        ...current,
        points: [...(current?.points || []), point].slice(-600),
      }));
    }
  }, [draftOperation, getCanvasPoint, pointerStart]);

  const finishPointerOperation = useCallback(() => {
    if (draftOperation) commitOperation(draftOperation);
    setDraftOperation(null);
    setPointerStart(null);
  }, [commitOperation, draftOperation]);

  const addTextCentered = useCallback(() => {
    const nextText = textValue.trim();
    if (!nextText) return;
    commitOperation({ type: 'text', x: 0.5, y: 0.5, text: nextText, color: brushColor, size: brushSize / 40 });
  }, [brushColor, brushSize, commitOperation, textValue]);

  const requestClose = useCallback(() => {
    if (saving) return;
    if (dirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    onClose?.();
  }, [dirty, onClose, saving]);

  const apply = useCallback(async () => {
    if (!sourceImage || saving) return;
    setSaving(true);
    setError('');
    try {
      if (!hasChatImageEdits(history.present)) {
        await onApply?.({ file: null, recipe: createEmptyChatImageEditRecipe(), reset: true });
      } else {
        const editedFile = await exportChatImageEditFile(sourceImage, file, history.present);
        await onApply?.({ file: editedFile, recipe: history.present, reset: false });
      }
    } catch {
      setError('Не удалось сохранить изменения. Исходное фото не изменено.');
    } finally {
      setSaving(false);
    }
  }, [file, history.present, onApply, saving, sourceImage]);

  const handleDialogKeyDown = useCallback((event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = String(event.key || '').toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undo();
    } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault();
      redo();
    }
  }, [redo, undo]);

  const toolButtonDisabled = loading || saving || !sourceImage;
  const controlsBg = theme.palette.mode === 'dark'
    ? alpha(theme.palette.common.white, 0.06)
    : alpha(theme.palette.common.black, 0.045);

  return (
    <>
      <Dialog
        open={open}
        onClose={requestClose}
        fullScreen={fullScreen}
        fullWidth
        maxWidth="md"
        onKeyDown={handleDialogKeyDown}
        PaperProps={{
          sx: {
            height: fullScreen ? '100%' : 'min(88dvh, 780px)',
            borderRadius: fullScreen ? 0 : 3,
            overflow: 'hidden',
            backgroundImage: 'none',
          },
        }}
      >
        <DialogTitle component="div" sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1.2, pr: 1 }}>
          <Typography component="h2" sx={{ flex: 1, fontSize: '1rem', fontWeight: 700 }}>
            Редактировать фото
          </Typography>
          <IconButton aria-label="Закрыть редактор" onClick={requestClose} disabled={saving} sx={{ width: 44, height: 44 }}>
            <CloseRoundedIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent
          dividers
          sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, gap: 1.2, p: { xs: 1, sm: 1.5 }, overflow: 'hidden' }}
        >
          {error ? <Alert severity="warning" onClose={() => setError('')}>{error}</Alert> : null}
          <Box
            sx={{
              position: 'relative',
              flex: 1,
              minHeight: 220,
              minWidth: 0,
              display: 'grid',
              placeItems: 'center',
              overflow: 'hidden',
              borderRadius: 2,
              bgcolor: '#0b1118',
              boxShadow: theme.palette.mode === 'dark'
                ? '0 0 0 1px oklch(1 0 0 / 0.1)'
                : '0 0 0 1px oklch(0 0 0 / 0.1)',
            }}
          >
            {loading ? <CircularProgress aria-label="Загрузка фотографии" /> : null}
            <Box
              component="canvas"
              ref={canvasRef}
              tabIndex={0}
              aria-label="Область редактирования фотографии"
              aria-describedby="chat-image-editor-help"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={finishPointerOperation}
              onPointerCancel={finishPointerOperation}
              sx={{
                display: sourceImage ? 'block' : 'none',
                position: 'absolute',
                inset: 0,
                margin: 'auto',
                maxWidth: '100%',
                maxHeight: '100%',
                width: 'auto',
                height: 'auto',
                cursor: tool === 'text' ? 'text' : 'crosshair',
                touchAction: 'none',
                outline: '1px solid oklch(1 0 0 / 0.1)',
                outlineOffset: '-1px',
                '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
              }}
            />
          </Box>

          <Box
            role="toolbar"
            aria-label="Инструменты редактирования"
            sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, p: 0.5, borderRadius: 2, bgcolor: controlsBg }}
          >
            <Stack direction="row" spacing={0.35} role="group" aria-label="Инструменты фото">
              <ToolButton label="Кадрировать" active={tool === 'crop'} disabled={toolButtonDisabled} onClick={() => setTool('crop')}>
                <CropRoundedIcon />
              </ToolButton>
              <ToolButton label="Повернуть на 90 градусов" disabled={toolButtonDisabled} onClick={() => commitOperation({ type: 'rotate', turns: 1 })}>
                <Rotate90DegreesCcwRoundedIcon />
              </ToolButton>
              <ToolButton label="Рисовать" active={tool === 'draw'} disabled={toolButtonDisabled} onClick={() => setTool('draw')}>
                <DrawRoundedIcon />
              </ToolButton>
              <ToolButton label="Добавить текст" active={tool === 'text'} disabled={toolButtonDisabled} onClick={() => setTool('text')}>
                <TextFieldsRoundedIcon />
              </ToolButton>
              <ToolButton label="Размыть" active={tool === 'blur'} disabled={toolButtonDisabled} onClick={() => setTool('blur')}>
                <BlurOnRoundedIcon />
              </ToolButton>
            </Stack>
            <Stack
              direction="row"
              spacing={0.35}
              role="group"
              aria-label="История изменений"
              sx={{ pl: { sm: 0.75 }, borderInlineStart: { sm: `1px solid ${theme.palette.divider}` } }}
            >
              <ToolButton label="Отменить" disabled={history.past.length === 0 || saving} onClick={undo}>
                <UndoRoundedIcon />
              </ToolButton>
              <ToolButton label="Повторить" disabled={history.future.length === 0 || saving} onClick={redo}>
                <RedoRoundedIcon />
              </ToolButton>
              <ToolButton label="Сбросить изменения" disabled={!hasChatImageEdits(history.present) || saving} onClick={reset}>
                <RestartAltRoundedIcon />
              </ToolButton>
            </Stack>
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
            {(tool === 'draw' || tool === 'text') ? (
              <Box
                component="input"
                type="color"
                aria-label="Цвет инструмента"
                value={brushColor}
                onChange={(event) => setBrushColor(event.target.value)}
                sx={{ width: 44, height: 44, p: 0.4, border: 0, borderRadius: 1.5, bgcolor: controlsBg, cursor: 'pointer' }}
              />
            ) : null}
            {(tool === 'draw' || tool === 'blur' || tool === 'text') ? (
              <Box sx={{ minWidth: 150, flex: tool === 'text' ? '0 0 180px' : 1, px: 1 }}>
                <Slider
                  aria-label={tool === 'text' ? 'Размер текста' : 'Толщина инструмента'}
                  value={brushSize}
                  min={1}
                  max={tool === 'text' ? 5 : 8}
                  step={0.2}
                  onChange={(_event, value) => setBrushSize(Number(value))}
                />
              </Box>
            ) : null}
            {tool === 'text' ? (
              <Stack direction="row" spacing={1} sx={{ flex: 1, minWidth: 0 }}>
                <TextField
                  size="small"
                  label="Текст на фото"
                  value={textValue}
                  onChange={(event) => setTextValue(event.target.value.slice(0, 500))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing) {
                      event.preventDefault();
                      addTextCentered();
                    }
                  }}
                  fullWidth
                />
                <Button variant="outlined" onClick={addTextCentered} disabled={!textValue.trim()} sx={{ minHeight: 44, whiteSpace: 'nowrap' }}>
                  По центру
                </Button>
              </Stack>
            ) : null}
          </Stack>

          <Typography id="chat-image-editor-help" variant="caption" sx={{ color: 'text.secondary', minHeight: '1.25em' }}>
            {TOOL_HELP[tool]}
          </Typography>
        </DialogContent>

        <DialogActions sx={{ px: 2, py: 1.2 }}>
          <Button onClick={requestClose} disabled={saving}>Отмена</Button>
          <Button
            variant="contained"
            startIcon={saving ? <CircularProgress size={17} color="inherit" /> : <CheckRoundedIcon />}
            onClick={apply}
            disabled={loading || saving || !sourceImage}
          >
            {saving ? 'Сохранение…' : 'Готово'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={discardConfirmOpen} onClose={() => setDiscardConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Не сохранять изменения?</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">Несохранённые правки фотографии будут потеряны.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDiscardConfirmOpen(false)} autoFocus>Продолжить редактирование</Button>
          <Button
            color="error"
            onClick={() => {
              setDiscardConfirmOpen(false);
              onClose?.();
            }}
          >
            Не сохранять
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
