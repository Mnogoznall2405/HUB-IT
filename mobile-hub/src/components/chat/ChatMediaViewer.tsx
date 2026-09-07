import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type RefObject } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type ImageLoadEventData,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { initialWindowMetrics, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import {
  clampMediaTranslation,
  clampMediaZoom,
  findThreadMediaIndex,
  getMediaViewerPanBounds,
  isVideoChatAttachment,
  mediaViewerDragAxis,
  pickChatAttachmentOriginalUrl,
  pickChatAttachmentPreviewUrl,
  resolveMediaViewerRelease,
  stepThreadMediaIndex,
  type ChatMediaItem,
} from '../../chat/chatMedia';
import { resolveAttachmentUrl } from '../../utils/attachmentUrl';
import { ChatAuthenticatedImage } from './ChatAuthenticatedImage';
import { ChatVideoPlayer } from './ChatVideoPlayer';

type Point = { x: number; y: number };

function pinchMetrics(event: GestureResponderEvent): { distance: number; center: Point } | null {
  const touches = event.nativeEvent.touches;
  if (!touches || touches.length < 2) return null;
  const first = touches[0];
  const second = touches[1];
  return {
    distance: Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY),
    center: {
      x: (first.locationX + second.locationX) / 2,
      y: (first.locationY + second.locationY) / 2,
    },
  };
}

function mediaKey(item?: ChatMediaItem | null): string {
  return item ? `${item.message.id}:${item.attachment.id}` : '';
}

export function ChatMediaViewer(props: Omit<ComponentProps<typeof ChatMediaViewerPage>, 'closeRequestRef'>) {
  const reduceMotion = useReducedMotion();
  const closeRequestRef = useRef<(() => void) | null>(null);
  return (
    <Modal testID="chat-media-modal" visible={Boolean(props.item)} animationType={reduceMotion ? 'none' : 'fade'} transparent
      statusBarTranslucent navigationBarTranslucent presentationStyle="overFullScreen" onRequestClose={() => (closeRequestRef.current || props.onClose)()}>
      {props.item ? <ChatMediaViewerPage key={mediaKey(props.item)} {...props} closeRequestRef={closeRequestRef} /> : null}
    </Modal>
  );
}

function ChatMediaViewerPage({
  item,
  items = [],
  onChange,
  onClose,
  onOpen,
  onShare,
  onSave,
  onForward,
  onRequestMore,
  closeRequestRef,
}: {
  item: ChatMediaItem | null;
  items?: ChatMediaItem[];
  onChange?: (next: ChatMediaItem) => void;
  onClose: () => void;
  onOpen: () => void;
  onShare: () => void;
  onSave: () => void;
  onForward: () => void;
  onRequestMore?: () => void;
  closeRequestRef: RefObject<(() => void) | null>;
}) {
  const reduceMotion = useReducedMotion();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const message = item?.message || null;
  const attachment = item?.attachment || null;
  const visible = Boolean(item);
  const transitionGeneration = useRef(0);
  const transitioning = useRef(false);
  const offsetY = useRef(new Animated.Value(0)).current;
  const originalOpacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const scaleValue = useRef(1);
  const translateValue = useRef<Point>({ x: 0, y: 0 });
  const panStart = useRef<Point>({ x: 0, y: 0 });
  const pinchStart = useRef({
    distance: 0,
    scale: 1,
    center: { x: 0, y: 0 },
    translation: { x: 0, y: 0 },
  });
  const pinching = useRef(false);
  const dragAxis = useRef<'page' | 'dismiss' | 'zoom' | null>(null);
  const gestureStartedAt = useRef(0);
  const lastTapAt = useRef(0);
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [zoomed, setZoomed] = useState(false);
  const [stageSize, setStageSize] = useState({ width: windowWidth, height: windowHeight });
  const [mediaSize, setMediaSize] = useState({ width: 0, height: 0 });
  const previewUrl = resolveAttachmentUrl(pickChatAttachmentPreviewUrl(attachment));
  const originalUrl = resolveAttachmentUrl(pickChatAttachmentOriginalUrl(attachment));
  const hasProgressiveOriginal = Boolean(originalUrl && originalUrl !== previewUrl);
  const isVideo = isVideoChatAttachment(attachment);
  const senderName = message?.sender?.full_name || message?.sender?.username || 'Участник';
  const createdAt = message?.created_at ? new Date(message.created_at) : null;
  const timeLabel = createdAt && Number.isFinite(createdAt.getTime())
    ? createdAt.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '';
  const resolvedItems = items.length ? items : (item ? [item] : []);
  const latestItems = useRef(resolvedItems);
  useLayoutEffect(() => { latestItems.current = resolvedItems; }, [resolvedItems]);
  const currentIndex = item
    ? findThreadMediaIndex(resolvedItems, item.message.id, item.attachment.id)
    : -1;
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const previousIndex = stepThreadMediaIndex(safeIndex, 'prev', resolvedItems.length);
  const nextIndex = stepThreadMediaIndex(safeIndex, 'next', resolvedItems.length);
  const previousItem = previousIndex == null ? null : resolvedItems[previousIndex];
  const nextItem = nextIndex == null ? null : resolvedItems[nextIndex];
  const canPrev = Boolean(previousItem && onChange);
  const canNext = Boolean(nextItem && onChange);
  const safeInsets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets;
  const topInset = safeInsets?.top ?? (Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 47);
  const bottomInset = Math.max(safeInsets?.bottom || 0, 12);

  const setTranslation = useCallback((x: number, y: number) => {
    translateValue.current = { x, y };
    translateX.setValue(x);
    translateY.setValue(y);
  }, [translateX, translateY]);

  const resetTransforms = useCallback(() => {
    [scale, translateX, translateY, offsetY].forEach((value) => value.stopAnimation());
    scaleValue.current = 1;
    setZoomed(false);
    scale.setValue(1);
    setTranslation(0, 0);
    offsetY.setValue(0);
    dragAxis.current = null;
    pinching.current = false;
  }, [offsetY, scale, setTranslation, translateX, translateY]);

  useLayoutEffect(() => {
    resetTransforms();
    setChromeVisible(true);
    setMediaSize({ width: 0, height: 0 });
    originalOpacity.stopAnimation();
    originalOpacity.setValue(0);
  }, [item?.message.id, item?.attachment.id, originalOpacity, resetTransforms]);

  useEffect(() => {
    if (visible && safeIndex >= Math.max(0, resolvedItems.length - 3)) onRequestMore?.();
  }, [onRequestMore, resolvedItems.length, safeIndex, visible]);

  useLayoutEffect(() => () => {
    transitionGeneration.current += 1;
    if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
    [offsetY, originalOpacity, scale, translateX, translateY].forEach((value) => value.stopAnimation());
  }, [offsetY, originalOpacity, scale, translateX, translateY]);

  const animateTransform = useCallback((nextScale: number, x: number, y: number) => {
    scaleValue.current = nextScale;
    setZoomed(nextScale > 1.05);
    translateValue.current = { x, y };
    if (reduceMotion) {
      scale.setValue(nextScale);
      translateX.setValue(x);
      translateY.setValue(y);
      return;
    }
    Animated.parallel([
      Animated.spring(scale, { toValue: nextScale, useNativeDriver: true, speed: 28, bounciness: 3 }),
      Animated.spring(translateX, { toValue: x, useNativeDriver: true, speed: 28, bounciness: 3 }),
      Animated.spring(translateY, { toValue: y, useNativeDriver: true, speed: 28, bounciness: 3 }),
    ]).start();
  }, [reduceMotion, scale, translateX, translateY]);

  const settleZoom = useCallback(() => {
    const nextScale = scaleValue.current < 1.05 ? 1 : clampMediaZoom(scaleValue.current);
    const bounds = getMediaViewerPanBounds({
      viewportWidth: stageSize.width,
      viewportHeight: stageSize.height,
      mediaWidth: mediaSize.width,
      mediaHeight: mediaSize.height,
      scale: nextScale,
    });
    animateTransform(
      nextScale,
      clampMediaTranslation(translateValue.current.x, bounds.x),
      clampMediaTranslation(translateValue.current.y, bounds.y),
    );
  }, [animateTransform, mediaSize.height, mediaSize.width, stageSize.height, stageSize.width]);

  const zoomAt = useCallback((nextScale: number, focal?: Point) => {
    const clampedScale = clampMediaZoom(nextScale);
    if (clampedScale <= 1.05) {
      animateTransform(1, 0, 0);
      return;
    }
    const point = focal || { x: stageSize.width / 2, y: stageSize.height / 2 };
    const ratio = clampedScale / Math.max(1, scaleValue.current);
    const focalX = point.x - stageSize.width / 2;
    const focalY = point.y - stageSize.height / 2;
    const nextX = (translateValue.current.x - focalX) * ratio + focalX;
    const nextY = (translateValue.current.y - focalY) * ratio + focalY;
    const bounds = getMediaViewerPanBounds({
      viewportWidth: stageSize.width,
      viewportHeight: stageSize.height,
      mediaWidth: mediaSize.width,
      mediaHeight: mediaSize.height,
      scale: clampedScale,
    });
    animateTransform(
      clampedScale,
      clampMediaTranslation(nextX, bounds.x),
      clampMediaTranslation(nextY, bounds.y),
    );
  }, [animateTransform, mediaSize.height, mediaSize.width, stageSize.height, stageSize.width]);

  const goPage = useCallback((direction: 'next' | 'prev') => {
    const nextPageIndex = stepThreadMediaIndex(safeIndex, direction, resolvedItems.length);
    if (nextPageIndex == null) {
      transitioning.current = false;
      resetTransforms();
      return;
    }
    const next = latestItems.current.find((candidate) => mediaKey(candidate) === mediaKey(resolvedItems[nextPageIndex]));
    if (!next) {
      transitioning.current = false;
      resetTransforms();
      return;
    }
    // Keep the outgoing frame offscreen until React commits the next keyed page.
    onChange?.(next);
  }, [onChange, resetTransforms, resolvedItems, safeIndex]);

  const settlePage = useCallback(() => {
    if (reduceMotion) {
      translateX.setValue(0);
      offsetY.setValue(0);
      return;
    }
    Animated.parallel([
      Animated.spring(offsetY, { toValue: 0, useNativeDriver: true, speed: 28, bounciness: 3 }),
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, speed: 28, bounciness: 3 }),
    ]).start();
  }, [offsetY, reduceMotion, translateX]);

  const completePage = useCallback((direction: 'next' | 'prev') => {
    if (transitioning.current || !onChange) return;
    transitioning.current = true;
    const generation = ++transitionGeneration.current;
    if (reduceMotion) {
      goPage(direction);
      return;
    }
    const target = direction === 'next' ? -stageSize.width : stageSize.width;
    Animated.timing(translateX, { toValue: target, duration: 180, useNativeDriver: true })
      .start(({ finished }) => {
        if (generation !== transitionGeneration.current) return;
        if (finished) goPage(direction);
        else { transitioning.current = false; settlePage(); }
      });
  }, [goPage, onChange, reduceMotion, settlePage, stageSize.width, translateX]);

  const requestClose = useCallback(() => {
    transitionGeneration.current += 1;
    transitioning.current = true;
    [translateX, offsetY, scale, translateY].forEach((value) => value.stopAnimation());
    if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
    onClose();
  }, [offsetY, onClose, scale, translateX, translateY]);

  useLayoutEffect(() => {
    closeRequestRef.current = requestClose;
    return () => { if (closeRequestRef.current === requestClose) closeRequestRef.current = null; };
  }, [closeRequestRef, requestClose]);

  const completeDismiss = useCallback(() => {
    if (transitioning.current) return;
    transitioning.current = true;
    const generation = ++transitionGeneration.current;
    if (reduceMotion) {
      onClose();
      resetTransforms();
      return;
    }
    Animated.timing(offsetY, {
      toValue: Math.max(stageSize.height, windowHeight),
      duration: 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (generation !== transitionGeneration.current) return;
      if (finished) onClose();
      transitioning.current = false;
      resetTransforms();
    });
  }, [offsetY, onClose, reduceMotion, resetTransforms, stageSize.height, windowHeight]);

  const handleTap = useCallback((point: Point) => {
    const now = Date.now();
    if (now - lastTapAt.current <= 280) {
      lastTapAt.current = 0;
      if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
      singleTapTimer.current = null;
      zoomAt(scaleValue.current > 1.05 ? 1 : 3, point);
      return;
    }
    lastTapAt.current = now;
    singleTapTimer.current = setTimeout(() => {
      setChromeVisible((current) => !current);
      singleTapTimer.current = null;
    }, 285);
  }, [zoomAt]);

  const beginPinch = useCallback((event: GestureResponderEvent) => {
    const metrics = pinchMetrics(event);
    if (!metrics || metrics.distance <= 8) return false;
    pinching.current = true;
    dragAxis.current = 'zoom';
    pinchStart.current = {
      distance: metrics.distance,
      scale: scaleValue.current,
      center: metrics.center,
      translation: { ...translateValue.current },
    };
    return true;
  }, []);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !isVideo && !transitioning.current,
    onMoveShouldSetPanResponder: (event, gesture) => {
      if (isVideo || transitioning.current) return false;
      if ((event.nativeEvent.touches?.length || 0) >= 2) return true;
      if (scaleValue.current > 1.01) return Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4;
      return Math.abs(gesture.dy) > 8 || Math.abs(gesture.dx) > 8;
    },
    onMoveShouldSetPanResponderCapture: (event, gesture) => {
      // Video owns scrubbing/volume gestures; navigation remains in the toolbar.
      if (isVideo || transitioning.current) return false;
      if ((event.nativeEvent.touches?.length || 0) >= 2) return true;
      return Math.abs(gesture.dy) > 8 || Math.abs(gesture.dx) > 8;
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (event) => {
      if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
      singleTapTimer.current = null;
      gestureStartedAt.current = Date.now();
      dragAxis.current = null;
      panStart.current = { ...translateValue.current };
      if ((event.nativeEvent.touches?.length || 0) >= 2) beginPinch(event);
    },
    onPanResponderMove: (event, gesture) => {
      if ((event.nativeEvent.touches?.length || 0) >= 2) {
        if (!pinching.current && !beginPinch(event)) return;
        const metrics = pinchMetrics(event);
        if (!metrics || pinchStart.current.distance <= 8) return;
        const nextScale = clampMediaZoom(
          pinchStart.current.scale * (metrics.distance / pinchStart.current.distance),
        );
        const ratio = nextScale / Math.max(1, pinchStart.current.scale);
        const centerDeltaX = metrics.center.x - pinchStart.current.center.x;
        const centerDeltaY = metrics.center.y - pinchStart.current.center.y;
        const focalX = pinchStart.current.center.x - stageSize.width / 2;
        const focalY = pinchStart.current.center.y - stageSize.height / 2;
        const bounds = getMediaViewerPanBounds({
          viewportWidth: stageSize.width,
          viewportHeight: stageSize.height,
          mediaWidth: mediaSize.width,
          mediaHeight: mediaSize.height,
          scale: nextScale,
        });
        const nextX = clampMediaTranslation(
          (pinchStart.current.translation.x - focalX) * ratio + focalX + centerDeltaX,
          bounds.x,
        );
        const nextY = clampMediaTranslation(
          (pinchStart.current.translation.y - focalY) * ratio + focalY + centerDeltaY,
          bounds.y,
        );
        scaleValue.current = nextScale;
        setZoomed(nextScale > 1.05);
        scale.setValue(nextScale);
        setTranslation(nextX, nextY);
        return;
      }
      if (pinching.current) return;
      if (scaleValue.current > 1.01) {
        dragAxis.current = 'zoom';
        const bounds = getMediaViewerPanBounds({
          viewportWidth: stageSize.width,
          viewportHeight: stageSize.height,
          mediaWidth: mediaSize.width,
          mediaHeight: mediaSize.height,
          scale: scaleValue.current,
        });
        setTranslation(
          clampMediaTranslation(panStart.current.x + gesture.dx, bounds.x),
          clampMediaTranslation(panStart.current.y + gesture.dy, bounds.y),
        );
        return;
      }
      if (!dragAxis.current) {
        dragAxis.current = mediaViewerDragAxis(gesture.dx, gesture.dy, scaleValue.current);
      }
      if (dragAxis.current === 'page') {
        const rubber = gesture.dx < 0 && !canNext
          ? gesture.dx / 3
          : gesture.dx > 0 && !canPrev
            ? gesture.dx / 3
            : gesture.dx;
        translateX.setValue(rubber);
        offsetY.setValue(0);
      } else if (dragAxis.current === 'dismiss' && gesture.dy > 0) {
        offsetY.setValue(reduceMotion ? 0 : gesture.dy);
      }
    },
    onPanResponderRelease: (event, gesture) => {
      if (pinching.current) {
        pinching.current = false;
        settleZoom();
        return;
      }
      const isTap = Math.abs(gesture.dx) < 8
        && Math.abs(gesture.dy) < 8
        && Date.now() - gestureStartedAt.current < 260;
      if (isTap && !isVideo) {
        handleTap({ x: event.nativeEvent.locationX, y: event.nativeEvent.locationY });
        return;
      }
      if (scaleValue.current > 1.01) {
        settleZoom();
        return;
      }
      const action = resolveMediaViewerRelease({
        dx: gesture.dx,
        dy: gesture.dy,
        velocityX: gesture.vx * 1000,
        velocityY: gesture.vy * 1000,
        scale: scaleValue.current,
        width: stageSize.width,
        height: stageSize.height,
        canPrev,
        canNext,
      });
      if (action === 'dismiss') completeDismiss();
      else if (action === 'next' || action === 'prev') completePage(action);
      else settlePage();
    },
    onPanResponderTerminate: () => {
      pinching.current = false;
      if (scaleValue.current > 1.01) settleZoom();
      else settlePage();
    },
  }), [
    beginPinch,
    canNext,
    canPrev,
    completeDismiss,
    completePage,
    handleTap,
    isVideo,
    mediaSize.height,
    mediaSize.width,
    offsetY,
    reduceMotion,
    scale,
    setTranslation,
    settlePage,
    settleZoom,
    stageSize.height,
    stageSize.width,
    translateX,
  ]);

  const handleImageLoad = (event: NativeSyntheticEvent<ImageLoadEventData>) => {
    const source = event.nativeEvent.source;
    if (source?.width && source?.height) setMediaSize({ width: source.width, height: source.height });
  };

  const handleOriginalLoad = (event: NativeSyntheticEvent<ImageLoadEventData>) => {
    handleImageLoad(event);
    if (reduceMotion) {
      originalOpacity.setValue(1);
      return;
    }
    Animated.timing(originalOpacity, {
      toValue: 1,
      duration: 160,
      useNativeDriver: true,
    }).start();
  };

  const handleStageLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0 && (width !== stageSize.width || height !== stageSize.height)) {
      // Rotation/resizing invalidates pixel-based swipe targets and zoom bounds.
      transitionGeneration.current += 1;
      transitioning.current = false;
      resetTransforms();
      setStageSize({ width, height });
    }
  };

  const dismissProgress = offsetY.interpolate({
    inputRange: [0, Math.max(220, stageSize.height / 2)],
    outputRange: [1, 0.18],
    extrapolate: 'clamp',
  });

  return (
      <View testID="chat-media-safe-area" style={[styles.root, { paddingTop: topInset, paddingBottom: bottomInset, paddingLeft: safeInsets?.left || 0, paddingRight: safeInsets?.right || 0 }]}>
        <Animated.View pointerEvents="none" style={[styles.backdrop, { opacity: dismissProgress }]} />
          <View testID="chat-media-top-bar" style={[styles.topBar, !chromeVisible && styles.hiddenChrome]}
            pointerEvents={chromeVisible ? 'auto' : 'none'} accessibilityElementsHidden={!chromeVisible}
            importantForAccessibility={chromeVisible ? 'auto' : 'no-hide-descendants'}>
            <Pressable onPress={requestClose} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Закрыть просмотр">
              <Text style={styles.icon}>←</Text>
            </Pressable>
            <View style={styles.meta}>
              <Text style={styles.sender} numberOfLines={1}>{senderName}</Text>
              <Text style={styles.time} numberOfLines={1}>
                {resolvedItems.length > 1
                  ? `${safeIndex + 1} / ${resolvedItems.length}`
                  : timeLabel || attachment?.file_name || 'Вложение'}
              </Text>
            </View>
            {canPrev ? (
              <Pressable
                onPress={() => completePage('prev')}
                style={styles.iconButton}
                accessibilityRole="button"
                accessibilityLabel="Предыдущее фото"
              >
                <Text style={styles.icon}>‹</Text>
              </Pressable>
            ) : null}
            {canNext ? (
              <Pressable
                onPress={() => completePage('next')}
                style={styles.iconButton}
                accessibilityRole="button"
                accessibilityLabel="Следующее фото"
              >
                <Text style={styles.icon}>›</Text>
              </Pressable>
            ) : null}
            {!isVideo ? (
              <Pressable
                onPress={() => zoomAt(scaleValue.current > 1.05 ? 1 : 3)}
                style={styles.iconButton}
                accessibilityRole="button"
                accessibilityLabel={zoomed ? 'Уменьшить фото' : 'Увеличить фото'}
              >
                <Text style={styles.zoomIcon}>⌕</Text>
              </Pressable>
            ) : null}
          </View>
        <View style={styles.stage} onLayout={handleStageLayout} testID="chat-media-viewer-stage">
          <MediaPreviewSlot item={previousItem} translateX={Animated.add(translateX, -stageSize.width)} />
          <Animated.View
            testID="chat-media-current-slot"
            style={[
              styles.currentSlot,
              {
                transform: [
                  { translateX },
                  { translateY: Animated.add(offsetY, translateY) },
                  { scale },
                ],
                opacity: dismissProgress,
              },
            ]}
            accessible={!isVideo}
            accessibilityLabel={attachment?.file_name || (isVideo ? 'Видео' : 'Изображение')}
            accessibilityHint={!isVideo ? 'Двойное нажатие увеличивает фото' : undefined}
            accessibilityActions={!isVideo ? [
              { name: 'increment', label: 'Увеличить' },
              { name: 'decrement', label: 'Уменьшить' },
              { name: 'activate', label: 'Сбросить масштаб' },
            ] : undefined}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'increment') zoomAt(Math.min(4, scaleValue.current + 1));
              else if (event.nativeEvent.actionName === 'decrement') zoomAt(Math.max(1, scaleValue.current - 1));
              else if (event.nativeEvent.actionName === 'activate') zoomAt(1);
            }}
            {...panResponder.panHandlers}
          >
            {isVideo ? (
              <View style={styles.videoHitbox}>
                <ChatVideoPlayer attachment={attachment} />
              </View>
            ) : previewUrl ? (
              <View style={styles.imageHitbox} pointerEvents="box-none">
                <ChatAuthenticatedImage
                  uri={previewUrl}
                  style={styles.image}
                  resizeMode="contain"
                  accessible={false}
                  onLoad={handleImageLoad}
                />
                {hasProgressiveOriginal && originalUrl ? (
                  <Animated.View style={[styles.progressiveOriginal, { opacity: originalOpacity }]}>
                    <ChatAuthenticatedImage
                      uri={originalUrl}
                      style={styles.image}
                      resizeMode="contain"
                      accessible={false}
                      loadingFallback={null}
                      errorFallback={null}
                      onLoad={handleOriginalLoad}
                    />
                  </Animated.View>
                ) : null}
              </View>
            ) : (
              <Text style={styles.placeholder}>{attachment?.file_name || 'Вложение'}</Text>
            )}
          </Animated.View>
          <MediaPreviewSlot item={nextItem} translateX={Animated.add(translateX, stageSize.width)} />
        </View>
          <View testID="chat-media-actions" style={[styles.actions, !chromeVisible && styles.hiddenChrome]} accessibilityRole="toolbar"
            pointerEvents={chromeVisible ? 'auto' : 'none'} accessibilityElementsHidden={!chromeVisible}
            importantForAccessibility={chromeVisible ? 'auto' : 'no-hide-descendants'}>
            <Action label="Открыть" onPress={onOpen} />
            <Action label="Поделиться" onPress={onShare} />
            <Action label="Переслать" onPress={onForward} />
            <Action label="В «Мои файлы»" onPress={onSave} />
          </View>
      </View>
  );
}

function MediaPreviewSlot({
  item,
  translateX,
}: {
  item: ChatMediaItem | null;
  translateX: Animated.AnimatedAddition<number>;
}) {
  const previewUrl = resolveAttachmentUrl(pickChatAttachmentPreviewUrl(item?.attachment));
  if (!item || !previewUrl) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.previewSlot, { transform: [{ translateX }] }]}>
      <ChatAuthenticatedImage
        key={mediaKey(item)}
        uri={previewUrl}
        style={styles.image}
        resizeMode="contain"
        accessible={false}
      />
    </Animated.View>
  );
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: '#000' },
  topBar: {
    zIndex: 4,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 4,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  icon: { color: '#fff', fontSize: 24 },
  zoomIcon: { color: '#fff', fontSize: 28, lineHeight: 30 },
  meta: { flex: 1, minWidth: 0 },
  sender: { color: '#fff', fontSize: 16, fontWeight: '700' },
  time: { color: 'rgba(255,255,255,0.72)', fontSize: 12, marginTop: 2 },
  stage: { flex: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  currentSlot: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewSlot: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageHitbox: { width: '100%', height: '100%' },
  videoHitbox: { width: '100%', height: '100%' },
  image: { width: '100%', height: '100%' },
  progressiveOriginal: { ...StyleSheet.absoluteFill },
  placeholder: { color: '#fff', fontSize: 18, fontWeight: '700' },
  actions: {
    zIndex: 4,
    minHeight: 56,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  hiddenChrome: { opacity: 0 },
  action: { minHeight: 48, flexBasis: '50%', flexGrow: 1, flexShrink: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 10 },
  actionText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
