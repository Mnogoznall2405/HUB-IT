import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { File } from 'expo-file-system';
import { SafeAreaInsetsContext, initialWindowMetrics } from 'react-native-safe-area-context';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import {
  appendChatImageEditOperation,
  appendChatImageStrokePoint,
  containedImageRect,
  createChatImageEditorHistory,
  cropRectForAspect,
  cropRectFromNormalized,
  nextImageRotation,
  overlayChatImageEditRecipe,
  pointInContainedImage,
  type ChatImageEditRecipe,
  type ChatImageCropAspect,
  type ChatImageEditOperation,
  type ChatImageEditorTool,
  type ChatImagePoint,
} from '../../chat/chatImageEditor';
import {
  readLocalImageDataUrl,
  shouldExportChatImageRecipe,
  writeEditedImageFromDataUrl,
} from '../../chat/chatImageEditorCanvas';
import type { NativePickedFile } from '../../files/nativeFilePicker';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';
import { ChatImageRecipeExporter } from './ChatImageRecipeExporter';
import { ChatKeyboardAvoidingHost } from './ChatKeyboardAvoidingHost';

const BRUSH_COLORS = ['#ffffff', '#ff3b30', '#ffcc00', '#000000'] as const;
type ImageFrame = { uri: string; size: { width: number; height: number }; recipe: ChatImageEditRecipe };
type ExportedImage = ReturnType<typeof writeEditedImageFromDataUrl>;
const TOOL_HELP: Record<ChatImageEditorTool, string> = {
  crop: 'Проведите по фото, чтобы выделить новую область, или выберите кадр.',
  draw: 'Рисуйте по фото пальцем.',
  text: 'Введите текст и нажмите на фото или добавьте его по центру.',
  blur: 'Проведите по участкам, которые нужно скрыть.',
};

async function manipulatePickedImage(
  uri: string,
  actions: Array<
    | { rotate: number }
    | { crop: { originX: number; originY: number; width: number; height: number } }
  >,
): Promise<{ uri: string; width?: number; height?: number }> {
  const ImageManipulator = require('expo-image-manipulator') as typeof import('expo-image-manipulator');
  return ImageManipulator.manipulateAsync(uri, actions, {
    compress: 0.85,
    format: ImageManipulator.SaveFormat.JPEG,
  });
}

export function ChatImageEditorSheet({
  file,
  busy,
  caption,
  onChangeCaption,
  confirmLabel = 'Отправить фото',
  onCancel,
  onConfirm,
}: {
  file: NativePickedFile | null;
  busy?: boolean;
  caption?: string;
  onChangeCaption?: (value: string) => void;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (file: NativePickedFile) => void | Promise<void>;
}) {
  const { chatTokens, styles } = useChatStyles(createStyles);
  const { height: windowHeight } = useWindowDimensions();
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets;
  const reduceMotion = useReducedMotion();
  const [previewUri, setPreviewUri] = useState(file?.uri || '');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [tool, setTool] = useState<ChatImageEditorTool>('crop');
  const [brushColor, setBrushColor] = useState('#ffffff');
  const [brushSize, setBrushSize] = useState(2.2);
  const [textValue, setTextValue] = useState('');
  const [history, setHistory] = useState(() => createChatImageEditorHistory());
  const [draft, setDraft] = useState<ChatImageEditOperation | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [pastFrames, setPastFrames] = useState<ImageFrame[]>([]);
  const [futureFrames, setFutureFrames] = useState<ImageFrame[]>([]);
  const frameRef = useRef<ImageFrame>({ uri: previewUri, size: imageSize, recipe: history.present });
  frameRef.current = { uri: previewUri, size: imageSize, recipe: history.present };
  const pendingExportRef = useRef<{ id: string; resolve: (image: ExportedImage) => void; reject: (error: Error) => void } | null>(null);
  const exportSequenceRef = useRef(0);
  const [exportJob, setExportJob] = useState<{
    requestId: string;
    imageDataUrl: string;
    recipeJson: string;
  } | null>(null);
  const originalUri = file?.uri || '';
  const activeFileRef = useRef(file);
  const operationRef = useRef<symbol | null>(null);
  const disabledRef = useRef(false);
  disabledRef.current = working || Boolean(busy);
  const startPointRef = useRef<ChatImagePoint | null>(null);
  const previewUriRef = useRef(previewUri);
  const toolRef = useRef(tool);
  const draftRef = useRef(draft);
  const imageBox = useMemo(() => containedImageRect(stageSize.width, stageSize.height, imageSize.width, imageSize.height), [stageSize.width, stageSize.height, imageSize.width, imageSize.height]);
  const imageBoxRef = useRef(imageBox);
  const imageSizeRef = useRef(imageSize);
  const textValueRef = useRef(textValue);
  const brushColorRef = useRef(brushColor);
  const brushSizeRef = useRef(brushSize);
  previewUriRef.current = previewUri;
  toolRef.current = tool;
  draftRef.current = draft;
  imageBoxRef.current = imageBox;
  imageSizeRef.current = imageSize;
  textValueRef.current = textValue;
  brushColorRef.current = brushColor;
  brushSizeRef.current = brushSize;
  const overlayRecipe = useMemo(() => overlayChatImageEditRecipe(
    draft && draft.type !== 'crop' ? appendChatImageEditOperation(history.present, draft) : history.present,
  ), [history.present, draft]);

  useLayoutEffect(() => {
    activeFileRef.current = file;
    operationRef.current = null;
    setPreviewUri(file?.uri || '');
    setError('');
    setWorking(false);
    setTool('crop');
    setTextValue('');
    setDraft(null);
    setHistory(createChatImageEditorHistory());
    setPastFrames([]);
    setFutureFrames([]);
    setImageSize({ width: 0, height: 0 });
    setExportJob(null);
    startPointRef.current = null;
    draftRef.current = null;
    return () => {
      activeFileRef.current = null;
      operationRef.current = null;
      pendingExportRef.current?.reject(new Error('Редактор закрыт'));
      pendingExportRef.current = null;
    };
  }, [file]);

  useEffect(() => {
    if (!previewUri) return undefined;
    let cancelled = false;
    void new Promise<{ width: number; height: number }>((resolve, reject) => {
      try {
        Image.getSize(previewUri, (width, height) => resolve({ width, height }), reject);
      } catch (error) {
        reject(error);
      }
    }).then((size) => {
      if (!cancelled) setImageSize(size);
    }).catch(() => {
      if (!cancelled) {
        setImageSize({ width: 0, height: 0 });
        setError('Не удалось определить размер фото. Повторите выбор изображения.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [previewUri]);

  const rememberFrame = (frame = frameRef.current) => {
    setPastFrames((frames) => [...frames, frame].slice(-30));
    setFutureFrames([]);
  };
  const restoreFrame = (frame: ImageFrame) => {
    setPreviewUri(frame.uri);
    setImageSize(frame.size);
    setHistory(createChatImageEditorHistory(frame.recipe));
    setDraft(null);
    draftRef.current = null;
    startPointRef.current = null;
  };
  const exportImage = async (uri: string, recipe: ChatImageEditRecipe, operation: symbol) => {
    const imageDataUrl = await readLocalImageDataUrl(uri);
    if (activeFileRef.current !== file || operationRef.current !== operation) throw new Error('Редактор закрыт');
    const requestId = `export-${++exportSequenceRef.current}`;
    return new Promise<ExportedImage>((resolve, reject) => {
      pendingExportRef.current = { id: requestId, resolve, reject };
      setExportJob({ requestId, imageDataUrl, recipeJson: JSON.stringify(recipe) });
    });
  };
  const applyActions = async (
    actions: Array<
      | { rotate: number }
      | { crop: { originX: number; originY: number; width: number; height: number } }
    >,
  ) => {
    const currentUri = previewUriRef.current;
    if (!file || !currentUri || disabledRef.current || operationRef.current) return;
    const operation = Symbol('image-transform');
    operationRef.current = operation;
    const current = () => activeFileRef.current === file && operationRef.current === operation;
    setWorking(true);
    setError('');
    const previous = frameRef.current;
    try {
      // Bake annotations before changing geometry so marks stay on the same pixels.
      const source = previous.recipe.operations.length
        ? await exportImage(currentUri, previous.recipe, operation) : { uri: currentUri };
      if (!current()) return;
      let scaledActions = actions;
      if (source.uri !== currentUri && actions.some((action) => 'crop' in action)) {
        const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
          Image.getSize(source.uri, (width, height) => resolve({ width, height }), reject);
        });
        if (!current()) return;
        scaledActions = actions.map((action) => {
          if (!('crop' in action)) return action;
          const rect = cropRectFromNormalized(size.width, size.height, {
            x: action.crop.originX / previous.size.width, y: action.crop.originY / previous.size.height,
            width: action.crop.width / previous.size.width, height: action.crop.height / previous.size.height,
          });
          if (!rect) throw new Error('Не удалось определить область кадрирования');
          return { crop: rect };
        });
      }
      const result = await manipulatePickedImage(source.uri, scaledActions);
      if (!current()) return;
      rememberFrame(previous);
      setPreviewUri(result.uri);
      setHistory(createChatImageEditorHistory());
      if (result.width && result.height) setImageSize({ width: result.width, height: result.height });
      setDraft(null);
    } catch {
      if (current()) setError('Не удалось изменить фото');
    } finally {
      if (current()) { operationRef.current = null; setWorking(false); }
    }
  };
  const applyActionsRef = useRef(applyActions);
  applyActionsRef.current = applyActions;

  const commitOverlay = (operation: ChatImageEditOperation | null) => {
    if (!operation) return;
    rememberFrame();
    setHistory((current) => ({ past: [], present: appendChatImageEditOperation(current.present, operation), future: [] }));
    setDraft(null);
    draftRef.current = null;
    startPointRef.current = null;
  };
  const updateDraft = (value: ChatImageEditOperation | null) => {
    draftRef.current = value;
    setDraft(value);
  };

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !disabledRef.current && !operationRef.current,
    onMoveShouldSetPanResponder: () => !disabledRef.current && !operationRef.current,
    onPanResponderGrant: (event) => {
      if (disabledRef.current || operationRef.current) return;
      const point = pointInContainedImage(
        event.nativeEvent.locationX,
        event.nativeEvent.locationY,
        imageBoxRef.current,
      );
      if (!point) return;
      const currentTool = toolRef.current;
      if (currentTool === 'text') {
        const nextText = textValueRef.current.trim();
        if (nextText) {
          commitOverlay({
            type: 'text',
            ...point,
            text: nextText,
            color: brushColorRef.current,
            size: brushSizeRef.current / 40,
          });
          setTextValue('');
          textValueRef.current = '';
        }
        return;
      }
      startPointRef.current = point;
      if (currentTool === 'crop') {
        updateDraft({ type: 'crop', ...point, width: 0, height: 0 });
        return;
      }
      const size = brushSizeRef.current / 100;
      updateDraft(currentTool === 'draw'
        ? { type: 'draw', points: [point], size, color: brushColorRef.current }
        : { type: 'blur', points: [point], size });
    },
    onPanResponderMove: (event) => {
      const point = pointInContainedImage(
        event.nativeEvent.locationX,
        event.nativeEvent.locationY,
        imageBoxRef.current,
      );
      const start = startPointRef.current;
      if (!point || !start) return;
      if (toolRef.current === 'crop') {
        updateDraft({
          type: 'crop',
          x: Math.min(start.x, point.x),
          y: Math.min(start.y, point.y),
          width: Math.abs(point.x - start.x),
          height: Math.abs(point.y - start.y),
        });
        return;
      }
      if (toolRef.current === 'draw' || toolRef.current === 'blur') {
        const current = draftRef.current;
        if (current && (current.type === 'draw' || current.type === 'blur')) {
          const points = appendChatImageStrokePoint(current.points, point);
          if (points !== current.points) updateDraft({ ...current, points });
        }
      }
    },
    onPanResponderRelease: () => {
      const currentDraft = draftRef.current;
      if (toolRef.current === 'crop' && currentDraft?.type === 'crop') {
        const rect = cropRectFromNormalized(
          imageSizeRef.current.width,
          imageSizeRef.current.height,
          currentDraft,
        );
        setDraft(null);
        startPointRef.current = null;
        if (rect) void applyActionsRef.current([{ crop: rect }]);
        return;
      }
      if (currentDraft && currentDraft.type !== 'crop') commitOverlay(currentDraft);
      startPointRef.current = null;
    },
    onPanResponderTerminate: () => {
      setDraft(null);
      draftRef.current = null;
      startPointRef.current = null;
    },
  }), []);

  const finishEditedFile = async (uri: string, name = file?.name, mimeType = file?.mimeType, size?: number) => {
    if (!file) return;
    if (uri === file.uri) { await onConfirm(file); return; }
    let nextSize = Number(size || 0);
    if (!(nextSize > 0)) {
      try {
        nextSize = Number(new File(uri).size || 0);
      } catch {
        nextSize = Number(file.size || 0);
      }
    }
    await onConfirm({
      ...file,
      uri,
      name: String(name || file.name).replace(/\.[^.]+$/, '') + (String(mimeType || '').includes('png') ? '.png' : '.jpg'),
      mimeType: mimeType || 'image/jpeg',
      size: Math.max(1, nextSize || Number(file.size || 0) || 1),
    });
  };

  const sendCurrent = async () => {
    if (!file || !previewUri || disabledRef.current || operationRef.current) return;
    const operation = Symbol('image-send');
    operationRef.current = operation;
    const current = () => activeFileRef.current === file && operationRef.current === operation;
    setWorking(true);
    setError('');
    try {
      let recipe = history.present;
      if (tool === 'text' && textValue.trim()) {
        const textOperation: ChatImageEditOperation = { type: 'text', x: 0.5, y: 0.5,
          text: textValue.trim(), color: brushColor, size: brushSize / 40 };
        recipe = appendChatImageEditOperation(recipe, textOperation);
        commitOverlay(textOperation);
        setTextValue('');
      }
      if (shouldExportChatImageRecipe(recipe)) {
        const exported = await exportImage(previewUri, recipe, operation);
        if (current()) await finishEditedFile(exported.uri, exported.name, exported.mimeType, exported.size);
      } else await finishEditedFile(previewUri, file.name.replace(/\.[^.]+$/, '') + '.jpg', 'image/jpeg');
    } catch {
      if (current()) {
        setError('Не удалось подготовить фото к отправке');
      }
    } finally {
      if (current()) { operationRef.current = null; setWorking(false); }
    }
  };

  const cancel = () => {
    operationRef.current = null;
    activeFileRef.current = null;
    pendingExportRef.current?.reject(new Error('Редактор закрыт'));
    pendingExportRef.current = null;
    setExportJob(null);
    onCancel();
  };

  const overlayNodes = useMemo(() => imageBox ? (overlayRecipe.operations.map((operation, index) => {
    if (operation.type === 'text') {
      return (
        <Text
          key={`text-${index}`}
          style={[
            styles.overlayText,
            {
              left: operation.x * imageBox.width - 80,
              top: operation.y * imageBox.height - 12,
              color: operation.color,
              fontSize: Math.max(16, operation.size * Math.min(imageBox.width, imageBox.height)),
            },
          ]}
        >
          {operation.text}
        </Text>
      );
    }
    if (operation.type !== 'draw' && operation.type !== 'blur') return null;
    const radius = Math.max(4, operation.size * Math.min(imageBox.width, imageBox.height));
    return operation.points.map((point, pointIndex) => (
      <View
        key={`${operation.type}-${index}-${pointIndex}`}
        style={[
          styles.stamp,
          {
            left: point.x * imageBox.width - radius / 2,
            top: point.y * imageBox.height - radius / 2,
            width: radius,
            height: radius,
            borderRadius: radius / 2,
            backgroundColor: operation.type === 'draw' ? operation.color : 'rgba(20,20,20,0.42)',
          },
        ]}
      />
    ));
  })) : null, [imageBox, overlayRecipe, styles]);

  const disabled = working || Boolean(busy);

  return (
    <Modal
      visible={Boolean(file)}
      animationType={reduceMotion ? 'none' : 'slide'}
      transparent
      onRequestClose={cancel}
    >
      <ChatKeyboardAvoidingHost style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: Math.max(16, (insets?.bottom || 0) + 12) }]} accessibilityViewIsModal>
          <View style={styles.handle} />
          <Text style={styles.title}>Редактировать фото</Text>
          <ScrollView testID="chat-image-editor-scroll" style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.hint}>{TOOL_HELP[tool]}</Text>
          <View
            testID="chat-image-editor-stage"
            style={[styles.stage, { height: Math.min(280, Math.max(140, windowHeight * 0.35)) }]}
            onLayout={(event) => setStageSize({
              width: event.nativeEvent.layout.width,
              height: event.nativeEvent.layout.height,
            })}
          >
            {previewUri ? (
              <Image source={{ uri: previewUri }} style={styles.preview} resizeMode="contain" />
            ) : null}
            <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers}>
              {imageBox ? (
                <View
                  pointerEvents="none"
                  style={[
                    styles.overlayBox,
                    {
                      left: imageBox.originX,
                      top: imageBox.originY,
                      width: imageBox.width,
                      height: imageBox.height,
                    },
                  ]}
                >
                  {overlayNodes}
                  {draft?.type === 'crop' ? (
                    <View
                      style={[
                        styles.cropRect,
                        {
                          left: draft.x * imageBox.width,
                          top: draft.y * imageBox.height,
                          width: draft.width * imageBox.width,
                          height: draft.height * imageBox.height,
                        },
                      ]}
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>
          {onChangeCaption ? <View style={styles.captionSection}>
            <Text style={styles.fieldLabel}>Подпись к фото</Text>
            <TextInput value={caption || ''} onChangeText={onChangeCaption}
              editable={!disabled} multiline maxLength={12000}
              placeholder="Добавить подпись" placeholderTextColor={chatTokens.textSecondary}
              accessibilityLabel="Подпись к фото" style={styles.captionInput} />
          </View> : null}
          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
          <View style={styles.toolbar} accessibilityRole="toolbar" accessibilityLabel="Инструменты редактирования">
            <ToolChip label="Кадрировать" active={tool === 'crop'} disabled={disabled} onPress={() => setTool('crop')} />
            <ToolChip
              label="Повернуть на 90 градусов"
              disabled={disabled}
              onPress={() => void applyActions([{ rotate: nextImageRotation(0) }])}
            />
            <ToolChip label="Рисовать" active={tool === 'draw'} disabled={disabled} onPress={() => setTool('draw')} />
            <ToolChip label="Добавить текст" active={tool === 'text'} disabled={disabled} onPress={() => setTool('text')} />
            <ToolChip label="Размыть" active={tool === 'blur'} disabled={disabled} onPress={() => setTool('blur')} />
            <ToolChip
              label="Отменить"
              disabled={disabled || pastFrames.length === 0}
              onPress={() => {
                const frame = pastFrames[pastFrames.length - 1];
                if (!frame) return;
                setFutureFrames((frames) => [frameRef.current, ...frames].slice(0, 30));
                setPastFrames((frames) => frames.slice(0, -1));
                restoreFrame(frame);
              }}
            />
            <ToolChip
              label="Повторить"
              disabled={disabled || futureFrames.length === 0}
              onPress={() => {
                const frame = futureFrames[0];
                if (!frame) return;
                setPastFrames((frames) => [...frames, frameRef.current].slice(-30));
                setFutureFrames((frames) => frames.slice(1));
                restoreFrame(frame);
              }}
            />
            <ToolChip
              label="Сбросить изменения"
              disabled={disabled || (!overlayRecipe.operations.length && previewUri === originalUri)}
              onPress={() => {
                rememberFrame();
                setPreviewUri(originalUri);
                setHistory(createChatImageEditorHistory());
                setDraft(null);
                setError('');
              }}
            />
          </View>
          {tool === 'crop' ? (
            <View style={styles.actions}>
              <ToolChip label="Квадратный кадр" disabled={disabled} onPress={() => {
                const rect = cropRectForAspect(imageSize.width, imageSize.height, '1:1' as ChatImageCropAspect);
                if (rect) void applyActions([{ crop: rect }]);
              }} />
              <ToolChip label="Кадр 4:3" disabled={disabled} onPress={() => {
                const rect = cropRectForAspect(imageSize.width, imageSize.height, '4:3');
                if (rect) void applyActions([{ crop: rect }]);
              }} />
              <ToolChip label="Кадр 16:9" disabled={disabled} onPress={() => {
                const rect = cropRectForAspect(imageSize.width, imageSize.height, '16:9');
                if (rect) void applyActions([{ crop: rect }]);
              }} />
            </View>
          ) : null}
          {tool === 'draw' || tool === 'text' ? (
            <View style={styles.actions}>
              {BRUSH_COLORS.map((color) => (
                <Pressable
                  key={color}
                  disabled={disabled}
                  onPress={() => setBrushColor(color)}
                  style={[styles.color, { backgroundColor: color }, brushColor === color && styles.colorActive]}
                  accessibilityRole="button"
                  accessibilityLabel={`Цвет ${color}`}
                  accessibilityState={{ selected: brushColor === color }}
                />
              ))}
            </View>
          ) : null}
          {tool !== 'crop' ? <View style={styles.actions}>
            <Text style={styles.fieldLabel}>{tool === 'text' ? 'Размер текста' : 'Толщина кисти'}</Text>
            {([{ label: 'Маленький', value: 1.2 }, { label: 'Средний', value: 2.2 }, { label: 'Большой', value: 3.5 }]).map((size) => (
              <ToolChip key={size.value} label={size.label} active={brushSize === size.value}
                disabled={disabled} onPress={() => setBrushSize(size.value)} />
            ))}
          </View> : null}
          {tool === 'text' ? <Text style={styles.fieldLabel}>Надпись на изображении</Text> : null}
          {tool === 'text' ? (
            <View style={styles.textRow}>
              <TextInput
                value={textValue}
                onChangeText={setTextValue}
                placeholder="Текст на фото"
                placeholderTextColor={chatTokens.textSecondary}
                style={styles.textInput}
                accessibilityLabel="Текст на фото"
                editable={!disabled}
                multiline
                maxLength={500}
              />
              <Pressable
                onPress={() => {
                  const nextText = textValue.trim();
                  if (!nextText) return;
                  commitOverlay({
                    type: 'text',
                    x: 0.5,
                    y: 0.5,
                    text: nextText,
                    color: brushColor,
                    size: brushSize / 40,
                  });
                  setTextValue('');
                  textValueRef.current = '';
                }}
                disabled={disabled || !textValue.trim()}
                style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Добавить текст по центру"
              >
                <Text style={styles.chipText}>По центру</Text>
              </Pressable>
            </View>
          ) : null}
          {working || busy ? <ActivityIndicator color={chatTokens.composerActionBg} /> : null}
          </ScrollView>
          <View style={styles.footer}>
            <Pressable
              onPress={cancel}
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Отменить фото"
            >
              <Text style={styles.secondaryText}>Отмена</Text>
            </Pressable>
            <Pressable
              onPress={() => void sendCurrent()}
              disabled={disabled || !previewUri}
              style={({ pressed }) => [styles.primary, disabled && styles.disabled, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
            >
              <Text style={styles.primaryText}>{confirmLabel === 'Отправить фото' ? 'Отправить' : confirmLabel}</Text>
            </Pressable>
          </View>
          {exportJob ? (
            <ChatImageRecipeExporter
              requestId={exportJob.requestId}
              imageDataUrl={exportJob.imageDataUrl}
              recipeJson={exportJob.recipeJson}
              onReady={() => undefined}
              onExported={(requestId, dataUrl) => {
                const pending = pendingExportRef.current;
                if (pending?.id !== requestId || activeFileRef.current !== file) return;
                pendingExportRef.current = null;
                setExportJob(null);
                try {
                  pending.resolve(writeEditedImageFromDataUrl(dataUrl));
                } catch {
                  pending.reject(new Error('Не удалось сохранить изменения'));
                }
              }}
              onError={(requestId) => {
                const pending = pendingExportRef.current;
                if (pending?.id !== requestId) return;
                pendingExportRef.current = null;
                setExportJob(null);
                pending.reject(new Error('Не удалось сохранить изменения'));
              }}
            />
          ) : null}
        </View>
      </ChatKeyboardAvoidingHost>
    </Modal>
  );
}

function ToolChip({
  label,
  active = false,
  disabled = false,
  onPress,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { styles } = useChatStyles(createStyles);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    maxHeight: '94%',
    backgroundColor: chatTokens.panelBg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    gap: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: chatTokens.borderSoft,
  },
  scroll: { flexShrink: 1 },
  scrollContent: { gap: 10 },
  title: { color: chatTokens.textPrimary, fontSize: 18, fontWeight: '700' },
  hint: { color: chatTokens.textSecondary, fontSize: 13, lineHeight: 18 },
  stage: {
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#0b1118',
  },
  preview: { width: '100%', height: '100%' },
  overlayBox: { position: 'absolute', overflow: 'hidden' },
  stamp: { position: 'absolute' },
  overlayText: {
    position: 'absolute',
    width: 160,
    textAlign: 'center',
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.72)',
    textShadowRadius: 3,
  },
  cropRect: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#fff',
    borderStyle: 'dashed',
  },
  error: { color: chatTokens.dangerText, fontSize: 13 },
  toolbar: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  chip: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 12,
    justifyContent: 'center',
    backgroundColor: chatTokens.sidebarSearchBg,
  },
  chipActive: { backgroundColor: chatTokens.composerActionBg },
  chipText: { color: chatTokens.textPrimary, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  color: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: 'transparent' },
  colorActive: { borderColor: chatTokens.composerActionBg },
  textRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  captionSection: { gap: 6 },
  fieldLabel: { color: chatTokens.textSecondary, fontSize: 13 },
  captionInput: { minHeight: 48, maxHeight: 112, padding: 12, borderRadius: 12,
    backgroundColor: chatTokens.sidebarSearchBg, color: chatTokens.textPrimary, fontSize: 15 },
  textInput: {
    flex: 1,
    minWidth: 120,
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: chatTokens.sidebarSearchBg,
    color: chatTokens.textPrimary,
  },
  footer: { flexDirection: 'row', flexShrink: 0, gap: 10, marginTop: 4 },
  secondary: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: chatTokens.sidebarSearchBg,
  },
  secondaryText: { color: chatTokens.textPrimary, fontWeight: '700' },
  primary: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: chatTokens.composerActionBg,
  },
  primaryText: { color: chatTokens.composerActionText, fontWeight: '700' },
  disabled: { opacity: 0.6 },
  pressed: { transform: [{ scale: 0.97 }], opacity: 0.92 },
});
