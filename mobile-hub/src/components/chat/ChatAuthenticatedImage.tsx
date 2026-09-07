import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageLoadEventData,
  type ImageResizeMode,
  type ImageStyle,
  type NativeSyntheticEvent,
  type StyleProp,
} from 'react-native';
import { downloadTrustedChatMedia } from '../../files/nativeAttachmentDownloads';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';

type ImageLoadState = 'loading' | 'ready' | 'failed';

function isLocalUri(uri: string): boolean {
  return /^(file|content):/i.test(String(uri || '').trim());
}

function chatMediaCacheName(uri: string): string {
  let hash = 2166136261;
  for (let index = 0; index < uri.length; index += 1) {
    hash ^= uri.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `chat-media-${(hash >>> 0).toString(16)}.img`;
}

// A new URI owns a new decode/request state, including the first render.
export function ChatAuthenticatedImage(props: ComponentProps<typeof ChatImageSource>) {
  return <ChatImageSource key={props.uri} {...props} />;
}

function ChatImageSource({
  uri,
  style,
  resizeMode = 'cover',
  accessibilityLabel,
  accessible = true,
  onLoad,
  loadingFallback,
  errorFallback,
}: {
  uri: string;
  style?: StyleProp<ImageStyle>;
  resizeMode?: ImageResizeMode;
  accessibilityLabel?: string;
  accessible?: boolean;
  onLoad?: (event: NativeSyntheticEvent<ImageLoadEventData>) => void;
  loadingFallback?: ReactNode;
  errorFallback?: ReactNode;
}) {
  const { chatTokens, styles } = useChatStyles(createStyles);
  const [sourceUri, setSourceUri] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<ImageLoadState>('loading');
  const [requestVersion, setRequestVersion] = useState(0);
  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);
  const refreshAttemptedRef = useRef(false);
  const localUri = isLocalUri(uri);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  const loadImage = useCallback(async ({ forceDownload = false, showLoading = false } = {}) => {
    const requestId = ++requestIdRef.current;
    if (showLoading) setLoadState('loading');
    try {
      const nextUri = localUri
        ? uri
        : (await downloadTrustedChatMedia(uri, chatMediaCacheName(uri), { forceDownload })).uri;
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setSourceUri(nextUri);
      setLoadState('ready');
      if (forceDownload) setRequestVersion((value) => value + 1);
    } catch {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setLoadState('failed');
    }
  }, [localUri, uri]);

  useEffect(() => {
    refreshAttemptedRef.current = false;
    setSourceUri(null);
    setLoadState('loading');
    setRequestVersion(0);
    void loadImage();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadImage, uri]);

  const handleImageError = () => {
    if (refreshAttemptedRef.current) {
      setLoadState('failed');
      return;
    }
    refreshAttemptedRef.current = true;
    if (localUri) {
      setLoadState('failed');
      return;
    }
    void loadImage({ forceDownload: true, showLoading: true });
  };

  if (loadState === 'loading' || (!sourceUri && loadState !== 'failed')) {
    if (loadingFallback !== undefined) return <>{loadingFallback}</>;
    return (
      <View
        style={[style, styles.stateSurface]}
        accessibilityLiveRegion="polite"
        accessibilityLabel="Загрузка фото"
      >
        <ActivityIndicator color={chatTokens.accentText} />
      </View>
    );
  }

  if (loadState === 'failed') {
    if (errorFallback !== undefined) return <>{errorFallback}</>;
    return (
      <View style={[style, styles.stateSurface]} accessibilityLiveRegion="polite">
        <Text style={styles.errorText}>Не удалось загрузить фото</Text>
        <Pressable
          onPress={(event) => {
            event.stopPropagation();
            refreshAttemptedRef.current = true;
            void loadImage({ forceDownload: !localUri, showLoading: true });
          }}
          style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
          accessibilityRole="button"
          accessibilityLabel="Повторить загрузку фото"
        >
          <Text style={styles.retryText}>Повторить</Text>
        </Pressable>
      </View>
    );
  }

  if (!sourceUri) return null;
  const imageRequestId = requestIdRef.current;
  return (
    <Image
      key={`${sourceUri}:${requestVersion}`}
      source={{ uri: sourceUri }}
      style={style}
      resizeMode={resizeMode}
      accessibilityLabel={accessibilityLabel}
      accessible={accessible}
      onLoad={(event) => {
        if (mountedRef.current && imageRequestId === requestIdRef.current) onLoad?.(event);
      }}
      onError={() => {
        if (mountedRef.current && imageRequestId === requestIdRef.current) handleImageError();
      }}
    />
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  stateSurface: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: chatTokens.sidebarSearchBg,
  },
  errorText: {
    color: chatTokens.textPrimary,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  retryButton: {
    minWidth: 96,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: chatTokens.composerActionBg,
  },
  retryButtonPressed: {
    opacity: 0.78,
  },
  retryText: {
    color: chatTokens.composerActionText,
    fontSize: 14,
    fontWeight: '700',
  },
});
