import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { initialWindowMetrics, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import { resolveNativeMailImageViewerGesture } from '../../mail/nativeMailImageViewer';

export type NativeMailImageViewerItem = {
  key: string;
  name: string;
  uri: string;
};

export function NativeMailImageViewer(props: ComponentProps<typeof NativeMailImagePage>) {
  const reduceMotion = useReducedMotion();
  const visible = props.items.some((item) => item.key === props.currentKey);
  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? 'none' : 'fade'}
      statusBarTranslucent navigationBarTranslucent presentationStyle="overFullScreen" onRequestClose={props.onClose}>
      {visible ? <NativeMailImagePage key={props.currentKey} {...props} /> : null}
    </Modal>
  );
}

function NativeMailImagePage({
  items,
  currentKey,
  loading = false,
  onChange,
  onClose,
  onOpen,
  onShare,
}: {
  items: NativeMailImageViewerItem[];
  currentKey: string;
  loading?: boolean;
  onChange: (key: string) => void;
  onClose: () => void;
  onOpen?: () => void;
  onShare?: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const safeInsets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets;
  const transitioning = useRef(false);
  const generation = useRef(0);
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const zoomScale = useRef(new Animated.Value(1)).current;
  const panX = useRef(new Animated.Value(0)).current;
  const panY = useRef(new Animated.Value(0)).current;
  const zoom = useRef({ scale: 1, x: 0, y: 0 });
  const [scaleLabel, setScaleLabel] = useState(1);
  const viewport = useRef({ width, height });
  const imageSize = useRef({ width: 0, height: 0 });
  const gestureState = useRef({ mode: '' as '' | 'horizontal' | 'vertical' | 'pan' | 'pinch', multi: false, distance: 0, scale: 1, x: 0, y: 0, dx: 0, dy: 0, centerX: 0, centerY: 0 });
  const applyZoom = useCallback((scale: number, x = 0, y = 0) => {
    const boundedScale = Math.max(1, Math.min(4, scale));
    const box = viewport.current;
    const source = imageSize.current;
    const fit = source.width && source.height ? Math.min(box.width / source.width, box.height / source.height) : 1;
    const fitWidth = source.width ? source.width * fit : box.width;
    const fitHeight = source.height ? source.height * fit : box.height;
    const limitX = Math.max(0, (fitWidth * boundedScale - box.width) / 2);
    const limitY = Math.max(0, (fitHeight * boundedScale - box.height) / 2);
    zoom.current = { scale: boundedScale, x: Math.max(-limitX, Math.min(limitX, x)), y: Math.max(-limitY, Math.min(limitY, y)) };
    zoomScale.setValue(boundedScale); panX.setValue(zoom.current.x); panY.setValue(zoom.current.y);
    setScaleLabel(boundedScale);
  }, [panX, panY, zoomScale]);
  useLayoutEffect(() => { applyZoom(1); }, [width, height, applyZoom]);
  useLayoutEffect(() => () => {
    generation.current += 1;
    translateX.stopAnimation();
    translateY.stopAnimation();
  }, [translateX, translateY]);
  const currentIndex = currentKey ? items.findIndex((item) => item.key === currentKey) : -1;
  const current = currentIndex >= 0 ? items[currentIndex] : null;
  const canPrevious = currentIndex > 0;
  const canNext = currentIndex >= 0 && currentIndex < items.length - 1;

  const settle = useCallback(() => {
    if (reduceMotion) {
      translateX.setValue(0);
      translateY.setValue(0);
      return;
    }
    Animated.parallel([
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, speed: 28, bounciness: 0 }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, speed: 28, bounciness: 0 }),
    ]).start();
  }, [reduceMotion, translateX, translateY]);

  const changePage = useCallback((direction: 'previous' | 'next') => {
    if (transitioning.current) return;
    const nextIndex = direction === 'previous' ? currentIndex - 1 : currentIndex + 1;
    const next = items[nextIndex];
    if (!next) {
      settle();
      return;
    }
    transitioning.current = true;
    const transitionId = ++generation.current;
    const finish = () => onChange(next.key);
    if (reduceMotion) finish();
    else Animated.timing(translateX, {
      toValue: direction === 'previous' ? width : -width,
      duration: 170,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (transitionId !== generation.current) return;
      if (finished) finish();
      else { transitioning.current = false; settle(); }
    });
  }, [currentIndex, items, onChange, reduceMotion, settle, translateX, translateY, width]);

  const dismiss = useCallback(() => {
    if (transitioning.current) return;
    transitioning.current = true;
    const transitionId = ++generation.current;
    if (reduceMotion) {
      onClose();
      return;
    }
    Animated.timing(translateY, { toValue: height, duration: 170, useNativeDriver: true })
      .start(({ finished }) => {
        if (transitionId !== generation.current) return;
        if (finished) onClose();
        else { transitioning.current = false; settle(); }
      });
  }, [height, onClose, reduceMotion, settle, translateY]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (event, gesture) => !transitioning.current && (event.nativeEvent.touches.length > 1 || Math.abs(gesture.dx) > 8 || Math.abs(gesture.dy) > 8),
    onPanResponderGrant: (event) => {
      translateX.stopAnimation(); translateY.stopAnimation();
      gestureState.current = { mode: zoom.current.scale > 1 ? 'pan' : '', multi: false, distance: 0, ...zoom.current, dx: 0, dy: 0, centerX: 0, centerY: 0 };
      const [a, b] = event.nativeEvent.touches;
      if (a && b) {
        Object.assign(gestureState.current, { mode: 'pinch', multi: true,
          distance: Math.max(1, Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY)),
          centerX: (a.pageX + b.pageX) / 2, centerY: (a.pageY + b.pageY) / 2 });
        translateX.setValue(0); translateY.setValue(0);
      }
    },
    onPanResponderMove: (event, gesture) => {
      if (transitioning.current) return;
      const touches = event.nativeEvent.touches;
      const state = gestureState.current;
      if (touches.length >= 2) {
        const [a, b] = touches;
        const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
        const centerX = (a.pageX + b.pageX) / 2;
        const centerY = (a.pageY + b.pageY) / 2;
        if (state.mode !== 'pinch') {
          Object.assign(state, { mode: 'pinch', multi: true, distance: Math.max(1, distance), ...zoom.current, centerX, centerY });
          translateX.setValue(0); translateY.setValue(0);
        }
        applyZoom(state.scale * distance / state.distance, state.x + centerX - state.centerX, state.y + centerY - state.centerY);
        return;
      }
      if (state.mode === 'pinch') {
        Object.assign(state, { mode: 'pan', ...zoom.current, dx: gesture.dx, dy: gesture.dy });
      }
      if (zoom.current.scale > 1 || state.multi || state.mode === 'pan') {
        applyZoom(zoom.current.scale, state.x + gesture.dx - state.dx, state.y + gesture.dy - state.dy);
        return;
      }
      if (!state.mode) state.mode = Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.35 ? 'horizontal' : 'vertical';
      if (state.mode === 'horizontal') {
        const edgeResistance = (gesture.dx > 0 && !canPrevious) || (gesture.dx < 0 && !canNext) ? 0.28 : 1;
        translateX.setValue(gesture.dx * edgeResistance);
        translateY.setValue(0);
      } else if (gesture.dy > 0) {
        translateY.setValue(gesture.dy);
        translateX.setValue(0);
      }
    },
    onPanResponderRelease: (event, gesture) => {
      if (gestureState.current.multi || zoom.current.scale > 1 || gestureState.current.mode === 'pan'
        || gesture.numberActiveTouches > 1 || event.nativeEvent.touches.length > 1) {
        settle(); return;
      }
      const action = resolveNativeMailImageViewerGesture({
        dx: gestureState.current.mode === 'vertical' ? 0 : gesture.dx,
        dy: gestureState.current.mode === 'horizontal' ? 0 : gesture.dy,
        canPrevious,
        canNext,
      });
      if (action === 'dismiss') dismiss();
      else if (action === 'previous' || action === 'next') changePage(action);
      else settle();
    },
    onPanResponderTerminate: settle,
  }), [applyZoom, canNext, canPrevious, changePage, dismiss, settle, translateX, translateY]);

  if (!current) return null;
  const topInset = Math.max(safeInsets?.top || 0, Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 47);
  const bottomInset = Math.max(safeInsets?.bottom || 0, 12);
  const dismissOpacity = translateY.interpolate({
    inputRange: [0, Math.max(220, height / 2)],
    outputRange: [1, 0.2],
    extrapolate: 'clamp',
  });

  return (
      <View testID="native-mail-image-viewer" style={[styles.root, { paddingTop: topInset, paddingBottom: bottomInset }]}>
        <Animated.View pointerEvents="none" style={[styles.backdrop, { opacity: dismissOpacity }]} />
        <View style={styles.topBar}>
          <IconAction icon="close" label="Закрыть просмотр изображений" onPress={onClose} />
          <View style={styles.titleBlock}>
            <Text numberOfLines={1} style={styles.title}>{current.name || 'Изображение'}</Text>
            <Text style={styles.counter}>{currentIndex + 1} / {items.length}</Text>
          </View>
          <IconAction icon="chevron-left" label="Предыдущее изображение" onPress={() => changePage('previous')} disabled={!canPrevious} />
          <IconAction icon="chevron-right" label="Следующее изображение" onPress={() => changePage('next')} disabled={!canNext} />
        </View>
        <Animated.View
          testID="native-mail-image-viewer-stage"
          accessible
          accessibilityRole="image"
          accessibilityLabel={current.name || 'Изображение из письма'}
          accessibilityHint={scaleLabel > 1 ? 'Перемещайте увеличенное изображение. Для перелистывания сбросьте масштаб.' : 'Разведите два пальца для увеличения. Одним пальцем влево или вправо — переход, вниз — закрытие.'}
          onLayout={(event) => { viewport.current = event.nativeEvent.layout; applyZoom(zoom.current.scale, zoom.current.x, zoom.current.y); }}
          style={[styles.stage, { transform: [{ translateX }, { translateY }], opacity: dismissOpacity }]}
          {...panResponder.panHandlers}
        >
          {current.uri ? <Animated.View testID="native-mail-image-zoom" style={[styles.image, { transform: [{ translateX: panX }, { translateY: panY }, { scale: zoomScale }] }]}>
            <Image key={current.uri} fadeDuration={0} source={{ uri: current.uri }} resizeMode="contain" style={styles.image}
              onLoad={(event) => { imageSize.current = event.nativeEvent.source; applyZoom(zoom.current.scale, zoom.current.x, zoom.current.y); }} />
          </Animated.View> : <ActivityIndicator size="large" color="#ffffff" />}
        </Animated.View>
        <View accessibilityRole="toolbar" style={styles.zoomBar}>
          <IconAction icon="magnify-minus-outline" label="Уменьшить изображение" disabled={loading || scaleLabel <= 1} onPress={() => applyZoom(zoom.current.scale - 0.5, zoom.current.x, zoom.current.y)} />
          <Text style={styles.counter}>{Math.round(scaleLabel * 100)}%</Text>
          <IconAction icon="magnify-plus-outline" label="Увеличить изображение" disabled={loading || !current.uri || scaleLabel >= 4} onPress={() => applyZoom(zoom.current.scale + 0.5, zoom.current.x, zoom.current.y)} />
          <TextAction icon="fit-to-screen-outline" label="Сбросить" disabled={scaleLabel === 1} onPress={() => applyZoom(1)} />
        </View>
        <View accessibilityRole="toolbar" style={styles.bottomBar}>
          <Text style={styles.hint}>{loading ? 'Загружаю изображение…' : scaleLabel > 1 ? 'Перемещайте фото · сбросьте масштаб для свайпов' : 'Два пальца — масштаб · свайп вниз — закрыть'}</Text>
          {onOpen ? <TextAction icon="open-in-new" label="Открыть" onPress={onOpen} disabled={loading || !current.uri} /> : null}
          {onShare ? <TextAction icon="share-variant-outline" label="Поделиться" onPress={onShare} disabled={loading || !current.uri} /> : null}
        </View>
      </View>
  );
}

function IconAction({ icon, label, onPress, disabled = false }: { icon: ComponentProps<typeof MaterialCommunityIcons>['name']; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.iconAction, disabled ? styles.disabled : null, pressed ? styles.pressed : null]}
    >
      <MaterialCommunityIcons name={icon} size={28} color="#ffffff" />
    </Pressable>
  );
}

function TextAction({ icon, label, onPress, disabled }: { icon: ComponentProps<typeof MaterialCommunityIcons>['name']; label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.textAction, disabled ? styles.disabled : null, pressed ? styles.pressed : null]}
    >
      <MaterialCommunityIcons name={icon} size={22} color="#ffffff" />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: '#000000' },
  topBar: { zIndex: 2, minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, backgroundColor: 'rgba(0,0,0,0.34)' },
  titleBlock: { flex: 1, minWidth: 0, paddingHorizontal: 6 },
  title: { color: '#ffffff', fontSize: 15, lineHeight: 20, fontWeight: '700' },
  counter: { color: 'rgba(255,255,255,0.72)', marginTop: 2, fontSize: 12 },
  iconAction: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  zoomBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.34)' },
  bottomBar: { zIndex: 2, minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, backgroundColor: 'rgba(0,0,0,0.34)' },
  hint: { flex: 1, minWidth: 0, color: 'rgba(255,255,255,0.66)', fontSize: 11, lineHeight: 15 },
  textAction: { minWidth: 54, minHeight: 48, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', gap: 2 },
  actionText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.72 },
});
