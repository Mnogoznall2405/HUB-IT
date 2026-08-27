import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { File } from 'expo-file-system';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import {
  appendChatImageEditOperation,
  commitChatImageEditorOperation,
  containedImageRect,
  createChatImageEditorHistory,
  cropRectForAspect,
  cropRectFromNormalized,
  hasOverlayChatImageEdits,
  nextImageRotation,
  overlayChatImageEditRecipe,
  pointInContainedImage,
  redoChatImageEditorHistory,
  resetChatImageEditorHistory,
  type ChatImageCropAspect,
  type ChatImageEditOperation,
  type ChatImageEditorTool,
  type ChatImagePoint,
  undoChatImageEditorHistory,
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
  const ImageManipulator = await import('expo-image-manipulator');
  return ImageManipulator.manipulateAsync(uri, actions, {
    compress: 0.85,
    format: ImageManipulator.SaveFormat.JPEG,
  });
}

export function ChatImageEditorSheet({
  file,
  busy,
  onCancel,
  onConfirm,
}: {
  file: NativePickedFile | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (file: NativePickedFile) => void;
}) {
  const { chatTokens, styles } = useChatStyles(createStyles);
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
  const [exportJob, setExportJob] = useState<{
    requestId: string;
    imageDataUrl: string;
    recipeJson: string;
  } | null>(null);
  const originalUri = file?.uri || '';
  const startPointRef = useRef<ChatImagePoint | null>(null);
  const previewUriRef = useRef(previewUri);
  const toolRef = useRef(tool);
  const draftRef = useRef(draft);
  const imageBoxRef = useRef(containedImageRect(stageSize.width, stageSize.height, imageSize.width, imageSize.height));
  const imageSizeRef = useRef(imageSize);
  const textValueRef = useRef(textValue);
  const brushColorRef = useRef(brushColor);
  const brushSizeRef = useRef(brushSize);
  const imageBox = containedImageRect(stageSize.width, stageSize.height, imageSize.width, imageSize.height);
  previewUriRef.current = previewUri;
  toolRef.current = tool;
  draftRef.current = draft;
  imageBoxRef.current = imageBox;
  imageSizeRef.current = imageSize;
  textValueRef.current = textValue;
  brushColorRef.current = brushColor;
  brushSizeRef.current = brushSize;
  const overlayRecipe = overlayChatImageEditRecipe(
    draft && draft.type !== 'crop' ? appendChatImageEditOperation(history.present, draft) : history.present,
  );

  useEffect(() => {
    setPreviewUri(file?.uri || '');
    setError('');
    setWorking(false);
    setTool('crop');
    setTextValue('');
    setDraft(null);
    setHistory(createChatImageEditorHistory());
    setExportJob(null);
  }, [file?.uri]);

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
      if (!cancelled) setImageSize({ width: 1200, height: 800 });
    });
    return () => {
      cancelled = true;
    };
  }, [previewUri]);

  const applyActions = async (
    actions: Array<
      | { rotate: number }
      | { crop: { originX: number; originY: number; width: number; height: number } }
    >,
  ) => {
    const currentUri = previewUriRef.current;
    if (!file || !currentUri || working || busy) return;
    setWorking(true);
    setError('');
    try {
      const result = await manipulatePickedImage(currentUri, actions);
      setPreviewUri(result.uri);
      if (result.width && result.height) setImageSize({ width: result.width, height: result.height });
      setDraft(null);
    } catch {
      setError('Не удалось изменить фото');
    } finally {
      setWorking(false);
    }
  };

  const commitOverlay = (operation: ChatImageEditOperation | null) => {
    if (!operation) return;
    setHistory((current) => commitChatImageEditorOperation(current, operation));
    setDraft(null);
    startPointRef.current = null;
  };

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
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
        }
        return;
      }
      startPointRef.current = point;
      if (currentTool === 'crop') {
        setDraft({ type: 'crop', ...point, width: 0, height: 0 });
        return;
      }
      const size = brushSizeRef.current / 100;
      setDraft(currentTool === 'draw'
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
        setDraft({
          type: 'crop',
          x: Math.min(start.x, point.x),
          y: Math.min(start.y, point.y),
          width: Math.abs(point.x - start.x),
          height: Math.abs(point.y - start.y),
        });
        return;
      }
      if (toolRef.current === 'draw' || toolRef.current === 'blur') {
        setDraft((current) => (
          current && (current.type === 'draw' || current.type === 'blur')
            ? { ...current, points: [...current.points, point].slice(-600) }
            : current
        ));
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
        if (rect) void applyActions([{ crop: rect }]);
        return;
      }
      if (currentDraft && currentDraft.type !== 'crop') commitOverlay(currentDraft);
      startPointRef.current = null;
    },
    onPanResponderTerminate: () => {
      setDraft(null);
      startPointRef.current = null;
    },
  }), []);

  const finishEditedFile = (uri: string, name = file?.name, mimeType = file?.mimeType, size?: number) => {
    if (!file) return;
    let nextSize = Number(size || 0);
    if (!(nextSize > 0)) {
      try {
        nextSize = Number(new File(uri).size || 0);
      } catch {
        nextSize = Number(file.size || 0);
      }
    }
    onConfirm({
      ...file,
      uri,
      name: String(name || file.name).replace(/\.[^.]+$/, '') + (String(mimeType || '').includes('png') ? '.png' : '.jpg'),
      mimeType: mimeType || 'image/jpeg',
      size: Math.max(1, nextSize || Number(file.size || 0) || 1),
    });
  };

  const sendCurrent = async () => {
    if (!file || !previewUri || working || busy) return;
    if (!shouldExportChatImageRecipe(history.present)) {
      finishEditedFile(previewUri, file.name.replace(/\.[^.]+$/, '') + '.jpg', 'image/jpeg');
      return;
    }
    setWorking(true);
    setError('');
    try {
      const imageDataUrl = await readLocalImageDataUrl(previewUri);
      setExportJob({
        requestId: `export-${Date.now()}`,
        imageDataUrl,
        recipeJson: JSON.stringify(overlayChatImageEditRecipe(history.present)),
      });
    } catch {
      setWorking(false);
      setError('Не удалось подготовить фото к отправке');
    }
  };

  const disabled = working || Boolean(busy);

  return (
    <Modal
      visible={Boolean(file)}
      animationType={reduceMotion ? 'none' : 'slide'}
      transparent
      onRequestClose={onCancel}
    >
      <ChatKeyboardAvoidingHost style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.handle} />
          <Text style={styles.title}>Редактировать фото</Text>
          <Text style={styles.hint}>{TOOL_HELP[tool]}</Text>
          <View
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
                  {overlayRecipe.operations.map((operation, index) => {
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
                  })}
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
          {error ? <Text style={styles.error}>{error}</Text> : null}
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
              disabled={disabled || history.past.length === 0}
              onPress={() => setHistory((current) => undoChatImageEditorHistory(current))}
            />
            <ToolChip
              label="Повторить"
              disabled={disabled || history.future.length === 0}
              onPress={() => setHistory((current) => redoChatImageEditorHistory(current))}
            />
            <ToolChip
              label="Сбросить изменения"
              disabled={disabled || (!hasOverlayChatImageEdits(history.present) && previewUri === originalUri)}
              onPress={() => {
                setPreviewUri(originalUri);
                setHistory((current) => resetChatImageEditorHistory(current));
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
                  onPress={() => setBrushColor(color)}
                  style={[styles.color, { backgroundColor: color }, brushColor === color && styles.colorActive]}
                  accessibilityRole="button"
                  accessibilityLabel={`Цвет ${color}`}
                  accessibilityState={{ selected: brushColor === color }}
                />
              ))}
            </View>
          ) : null}
          {tool === 'text' ? (
            <View style={styles.textRow}>
              <TextInput
                value={textValue}
                onChangeText={setTextValue}
                placeholder="Текст на фото"
                placeholderTextColor={chatTokens.textSecondary}
                style={styles.textInput}
                accessibilityLabel="Текст на фото"
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
          <View style={styles.footer}>
            <Pressable
              onPress={onCancel}
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
              accessibilityLabel="Отправить фото"
            >
              <Text style={styles.primaryText}>Отправить</Text>
            </Pressable>
          </View>
          {exportJob ? (
            <ChatImageRecipeExporter
              requestId={exportJob.requestId}
              imageDataUrl={exportJob.imageDataUrl}
              recipeJson={exportJob.recipeJson}
              onReady={() => undefined}
              onExported={(requestId, dataUrl) => {
                if (requestId !== exportJob.requestId) return;
                try {
                  const exported = writeEditedImageFromDataUrl(dataUrl);
                  setExportJob(null);
                  setWorking(false);
                  finishEditedFile(exported.uri, exported.name, exported.mimeType, exported.size);
                } catch {
                  setExportJob(null);
                  setWorking(false);
                  setError('Не удалось сохранить изменения. Исходное фото не изменено.');
                }
              }}
              onError={(requestId) => {
                if (requestId !== exportJob.requestId) return;
                setExportJob(null);
                setWorking(false);
                setError('Не удалось сохранить изменения. Исходное фото не изменено.');
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
  title: { color: chatTokens.textPrimary, fontSize: 18, fontWeight: '700' },
  hint: { color: chatTokens.textSecondary, fontSize: 13, lineHeight: 18 },
  stage: {
    width: '100%',
    height: 280,
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
  textRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  textInput: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: chatTokens.sidebarSearchBg,
    color: chatTokens.textPrimary,
  },
  footer: { flexDirection: 'row', gap: 10, marginTop: 4 },
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
