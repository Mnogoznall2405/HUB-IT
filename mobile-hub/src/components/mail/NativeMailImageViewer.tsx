import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useCallback, useMemo, useRef, type ComponentProps } from 'react';
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
import { initialWindowMetrics } from 'react-native-safe-area-context';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import { resolveNativeMailImageViewerGesture } from '../../mail/nativeMailImageViewer';

export type NativeMailImageViewerItem = {
  key: string;
  name: string;
  uri: string;
};

export function NativeMailImageViewer({
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
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
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
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, speed: 28, bounciness: 3 }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, speed: 28, bounciness: 3 }),
    ]).start();
  }, [reduceMotion, translateX, translateY]);

  const changePage = useCallback((direction: 'previous' | 'next', animate = true) => {
    const nextIndex = direction === 'previous' ? currentIndex - 1 : currentIndex + 1;
    const next = items[nextIndex];
    if (!next) {
      settle();
      return;
    }
    const finish = () => {
      translateX.setValue(0);
      translateY.setValue(0);
      onChange(next.key);
    };
    if (reduceMotion || !animate) finish();
    else Animated.timing(translateX, {
      toValue: direction === 'previous' ? width : -width,
      duration: 170,
      useNativeDriver: true,
    }).start(({ finished }) => { if (finished) finish(); else settle(); });
  }, [currentIndex, items, onChange, reduceMotion, settle, translateX, translateY, width]);

  const dismiss = useCallback(() => {
    if (reduceMotion) {
      translateY.setValue(0);
      onClose();
      return;
    }
    Animated.timing(translateY, { toValue: height, duration: 170, useNativeDriver: true })
      .start(({ finished }) => {
        translateY.setValue(0);
        if (finished) onClose();
      });
  }, [height, onClose, reduceMotion, translateY]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 8 || Math.abs(gesture.dy) > 8,
    onPanResponderMove: (_event, gesture) => {
      if (Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.15) {
        const edgeResistance = (gesture.dx > 0 && !canPrevious) || (gesture.dx < 0 && !canNext) ? 0.28 : 1;
        translateX.setValue(gesture.dx * edgeResistance);
        translateY.setValue(0);
      } else if (gesture.dy > 0) {
        translateY.setValue(gesture.dy);
        translateX.setValue(0);
      }
    },
    onPanResponderRelease: (_event, gesture) => {
      const action = resolveNativeMailImageViewerGesture({
        dx: gesture.dx,
        dy: gesture.dy,
        canPrevious,
        canNext,
      });
      if (action === 'dismiss') dismiss();
      else if (action === 'previous' || action === 'next') changePage(action);
      else settle();
    },
    onPanResponderTerminate: settle,
  }), [canNext, canPrevious, changePage, dismiss, settle, translateX, translateY]);

  if (!current) return null;
  const topInset = Math.max(initialWindowMetrics?.insets.top || 0, Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 47);
  const bottomInset = Math.max(initialWindowMetrics?.insets.bottom || 0, 12);
  const dismissOpacity = translateY.interpolate({
    inputRange: [0, Math.max(220, height / 2)],
    outputRange: [1, 0.2],
    extrapolate: 'clamp',
  });

  return (
    <Modal
      visible
      transparent
      animationType={reduceMotion ? 'none' : 'fade'}
      statusBarTranslucent
      navigationBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View testID="native-mail-image-viewer" style={[styles.root, { paddingTop: topInset, paddingBottom: bottomInset }]}>
        <Animated.View pointerEvents="none" style={[styles.backdrop, { opacity: dismissOpacity }]} />
        <View style={styles.topBar}>
          <IconAction icon="close" label="Закрыть просмотр изображений" onPress={onClose} />
          <View style={styles.titleBlock}>
            <Text numberOfLines={1} style={styles.title}>{current.name || 'Изображение'}</Text>
            <Text style={styles.counter}>{currentIndex + 1} / {items.length}</Text>
          </View>
          <IconAction icon="chevron-left" label="Предыдущее изображение" onPress={() => changePage('previous', false)} disabled={!canPrevious} />
          <IconAction icon="chevron-right" label="Следующее изображение" onPress={() => changePage('next', false)} disabled={!canNext} />
        </View>
        <Animated.View
          testID="native-mail-image-viewer-stage"
          accessible
          accessibilityRole="image"
          accessibilityLabel={current.name || 'Изображение из письма'}
          accessibilityHint="Проведите влево или вправо для перехода, вниз для закрытия"
          style={[styles.stage, { transform: [{ translateX }, { translateY }], opacity: dismissOpacity }]}
          {...panResponder.panHandlers}
        >
          {current.uri ? <Image source={{ uri: current.uri }} resizeMode="contain" style={styles.image} /> : <ActivityIndicator size="large" color="#ffffff" />}
        </Animated.View>
        <View accessibilityRole="toolbar" style={styles.bottomBar}>
          <Text style={styles.hint}>{loading ? 'Загружаю изображение…' : 'Свайп влево или вправо · вниз — закрыть'}</Text>
          {onOpen ? <TextAction icon="open-in-new" label="Открыть" onPress={onOpen} disabled={loading || !current.uri} /> : null}
          {onShare ? <TextAction icon="share-variant-outline" label="Поделиться" onPress={onShare} disabled={loading || !current.uri} /> : null}
        </View>
      </View>
    </Modal>
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
  bottomBar: { zIndex: 2, minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, backgroundColor: 'rgba(0,0,0,0.34)' },
  hint: { flex: 1, minWidth: 0, color: 'rgba(255,255,255,0.66)', fontSize: 11, lineHeight: 15 },
  textAction: { minWidth: 54, minHeight: 48, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', gap: 2 },
  actionText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.72 },
});
