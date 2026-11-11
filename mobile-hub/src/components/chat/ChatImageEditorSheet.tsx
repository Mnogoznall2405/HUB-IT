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
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
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
import { useUiOpenTiming } from '../../diagnostics/uiOpenTiming';
import { ChatImageRecipeExporter } from './ChatImageRecipeExporter';
import { ChatKeyboardAvoidingHost } from './ChatKeyboardAvoidingHost';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

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
  files,
  onSelectFile,
  onRemoveFile,
  onCancel,
  onConfirm,
}: {
  file: NativePickedFile | null;
  busy?: boolean;
  caption?: string;
  onChangeCaption?: (value: string) => void;
  confirmLabel?: string;
  /** Every photo of the album; a thumbnail strip is shown when there are several. */
  files?: NativePickedFile[];
  /** Switch to another photo; `edited` is the current one with its edits applied. */
  onSelectFile?: (edited: NativePickedFile, nextIndex: number) => void;
  onRemoveFile?: (index: number) => void;
  onCancel: () => void;
  onConfirm: (file: NativePickedFile) => void | Promise<void>;
}) {
  const { chatTokens, styles } = useChatStyles(createStyles);
  const { height: windowHeight } = useWindowDimensions();
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets;
  const reduceMotion = useReducedMotion();
  useUiOpenTiming('photo-editor', Boolean(file));
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

  const buildEditedFile = async (uri: string, name = file?.name, mimeType = file?.mimeType, size?: number): Promise<NativePickedFile | null> => {
    if (!file) return null;
    if (uri === file.uri) return file;
    let nextSize = Number(size || 0);
    if (!(nextSize > 0)) {
      try {
        nextSize = Number(new File(uri).size || 0);
      } catch {
        nextSize = Number(file.size || 0);
      }
    }
    return {
      ...file,
      uri,
      name: String(name || file.name).replace(/\.[^.]+$/, '') + (String(mimeType || '').includes('png') ? '.png' : '.jpg'),
      mimeType: mimeType || 'image/jpeg',
      size: Math.max(1, nextSize || Number(file.size || 0) || 1),
    };
  };

  /** Bakes the pending edits into a file and hands it to `deliver` (send or switch photo). */
  const deliverCurrent = async (deliver: (edited: NativePickedFile) => void | Promise<void>) => {
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
      let edited: NativePickedFile | null;
      if (shouldExportChatImageRecipe(recipe)) {
        const exported = await exportImage(previewUri, recipe, operation);
        edited = current() ? await buildEditedFile(exported.uri, exported.name, exported.mimeType, exported.size) : null;
      } else {
        edited = await buildEditedFile(previewUri, file.name.replace(/\.[^.]+$/, '') + '.jpg', 'image/jpeg');
      }
      if (edited && current()) await deliver(edited);
    } catch {
      if (current()) {
        setError('Не удалось подготовить фото к отправке');
      }
    } finally {
      if (current()) { operationRef.current = null; setWorking(false); }
    }
  };

  const sendCurrent = () => deliverCurrent((edited) => onConfirm(edited));
  const activeIndex = files ? files.indexOf(file as NativePickedFile) : -1;
  const albumFiles = files && files.length > 1 && activeIndex >= 0 ? files : null;
  const switchTo = (index: number) => {
    if (index === activeIndex) return;
    void deliverCurrent((edited) => onSelectFile?.(edited, index));
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
  const topInset = Math.max(0, insets?.top || 0);
  const bottomInset = Math.max(0, insets?.bottom || 0);

  return (
    // Full-screen, Telegram-style: big photo, tool icons, caption + round send.
    <Modal
      visible={Boolean(file)}
      animationType={reduceMotion ? 'none' : 'fade'}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={cancel}
    >
      <ChatKeyboardAvoidingHost style={styles.screen}>
        <View style={styles.fill} accessibilityViewIsModal>
        <View style={[styles.topBar, { paddingTop: topInset + 6 }]}>
          <IconButton icon="close" label="Отменить фото" onPress={cancel} />
          <View style={styles.topSpacer} />
          <IconButton
            icon="undo"
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
          <IconButton
            icon="redo"
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
          <IconButton
            icon="restore"
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
        <View
          testID="chat-image-editor-stage"
          style={styles.stage}
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
          {working || busy ? (
            <View style={styles.workingVeil} pointerEvents="none">
              <ActivityIndicator color="#fff" />
            </View>
          ) : null}
        </View>
        <View style={styles.bottom}>
          <ScrollView
            testID="chat-image-editor-scroll"
            style={styles.optionsScroll}
            contentContainerStyle={styles.optionsContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.hint}>{TOOL_HELP[tool]}</Text>
            {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
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
                  placeholderTextColor="rgba(255,255,255,0.5)"
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
          </ScrollView>
          <View style={styles.toolRow} accessibilityRole="toolbar" accessibilityLabel="Инструменты редактирования">
            <ToolIcon icon="crop" label="Кадрировать" active={tool === 'crop'} disabled={disabled} onPress={() => setTool('crop')} />
            <ToolIcon
              icon="rotate-right"
              label="Повернуть на 90 градусов"
              disabled={disabled}
              onPress={() => void applyActions([{ rotate: nextImageRotation(0) }])}
            />
            <ToolIcon icon="brush" label="Рисовать" active={tool === 'draw'} disabled={disabled} onPress={() => setTool('draw')} />
            <ToolIcon icon="format-text" label="Добавить текст" active={tool === 'text'} disabled={disabled} onPress={() => setTool('text')} />
            <ToolIcon icon="blur" label="Размыть" active={tool === 'blur'} disabled={disabled} onPress={() => setTool('blur')} />
          </View>
          {albumFiles ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              style={styles.strip}
              contentContainerStyle={styles.stripContent}
            >
              {albumFiles.map((item, index) => (
                <View key={`${item.uri}:${index}`} style={styles.thumbWrap}>
                  <Pressable
                    onPress={() => switchTo(index)}
                    disabled={disabled}
                    style={[styles.thumb, index === activeIndex && styles.thumbActive]}
                    accessibilityRole="button"
                    accessibilityLabel={`Фото ${index + 1} из ${albumFiles.length}`}
                    accessibilityState={{ selected: index === activeIndex }}
                  >
                    <Image source={{ uri: item.uri }} style={styles.thumbImage} />
                  </Pressable>
                  {onRemoveFile ? (
                    <Pressable
                      onPress={() => onRemoveFile(index)}
                      disabled={disabled}
                      hitSlop={6}
                      style={styles.thumbRemove}
                      accessibilityRole="button"
                      accessibilityLabel={`Убрать ${item.name}`}
                    >
                      <MaterialCommunityIcons name="close" size={12} color="#fff" />
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </ScrollView>
          ) : null}
          <View style={[styles.captionBar, { paddingBottom: Math.max(8, bottomInset) }]}>
            {onChangeCaption ? (
              <TextInput
                value={caption || ''}
                onChangeText={onChangeCaption}
                editable={!disabled}
                multiline
                maxLength={12000}
                placeholder="Добавить подпись…"
                placeholderTextColor="rgba(255,255,255,0.5)"
                accessibilityLabel="Подпись к фото"
                style={styles.captionInput}
              />
            ) : <View style={styles.captionInput} />}
            <Pressable
              onPress={() => void sendCurrent()}
              disabled={disabled || !previewUri}
              style={({ pressed }) => [styles.sendButton, disabled && styles.disabled, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
            >
              <MaterialCommunityIcons name={confirmLabel === 'Отправить фото' ? 'send' : 'check'} size={22} color="#fff" />
              {albumFiles && confirmLabel === 'Отправить фото' ? (
                <View style={styles.sendCount}><Text style={styles.sendCountText}>{albumFiles.length}</Text></View>
              ) : null}
            </Pressable>
          </View>
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

function IconButton({
  icon,
  label,
  disabled = false,
  onPress,
}: {
  icon: IconName;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { styles } = useChatStyles(createStyles);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [styles.iconButton, disabled && styles.disabled, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <MaterialCommunityIcons name={icon} size={24} color="#fff" />
    </Pressable>
  );
}

function ToolIcon({
  icon,
  label,
  active = false,
  disabled = false,
  onPress,
}: {
  icon: IconName;
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
      style={({ pressed }) => [styles.toolIcon, active && styles.toolIconActive, disabled && styles.disabled, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
    >
      <MaterialCommunityIcons name={icon} size={26} color={active ? '#fff' : 'rgba(255,255,255,0.78)'} />
    </Pressable>
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
  screen: { flex: 1, backgroundColor: '#000' },
  fill: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingBottom: 4 },
  topSpacer: { flex: 1 },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  stage: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  preview: { width: '100%', height: '100%' },
  workingVeil: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
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
  bottom: { backgroundColor: '#0e1621' },
  optionsScroll: { flexGrow: 0, maxHeight: 150 },
  optionsContent: { gap: 8, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4 },
  hint: { color: 'rgba(255,255,255,0.6)', fontSize: 12, lineHeight: 16 },
  error: { color: chatTokens.dangerText, fontSize: 13 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  chip: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  chipActive: { backgroundColor: chatTokens.composerActionBg },
  chipText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  chipTextActive: { color: '#fff' },
  color: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)' },
  colorActive: { borderColor: chatTokens.composerActionBg, borderWidth: 3 },
  textRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  fieldLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  textInput: {
    flex: 1,
    minWidth: 120,
    minHeight: 40,
    borderRadius: 18,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
    color: '#fff',
  },
  toolRow: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 8, paddingVertical: 6 },
  toolIcon: { width: 52, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  toolIconActive: { backgroundColor: chatTokens.composerActionBg },
  strip: { flexGrow: 0 },
  stripContent: { gap: 8, paddingHorizontal: 12, paddingVertical: 6 },
  thumbWrap: { width: 54, height: 54 },
  thumb: { width: 54, height: 54, borderRadius: 8, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', opacity: 0.7 },
  thumbActive: { borderColor: chatTokens.composerActionBg, opacity: 1 },
  thumbImage: { width: '100%', height: '100%' },
  thumbRemove: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  captionBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingTop: 6 },
  captionInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 112,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.1)',
    color: '#fff',
    fontSize: 16,
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: chatTokens.composerActionBg,
  },
  sendCount: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  sendCountText: { color: '#000', fontSize: 11, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  pressed: { transform: [{ scale: 0.95 }], opacity: 0.9 },
});
