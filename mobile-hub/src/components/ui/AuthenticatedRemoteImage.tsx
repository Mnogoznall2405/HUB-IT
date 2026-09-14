import { useCallback, useEffect, useRef, useState, type ReactNode, type ComponentProps } from 'react';
import { Image, type ImageSource } from 'expo-image';
import {
  StyleSheet,
  View,
  type ImageResizeMode,
  type ImageStyle,
  type StyleProp,
} from 'react-native';
import { getAuthenticatedRequestHeaders } from '../../files/authenticatedRequestHeaders';
import { getSessionGeneration, getSessionUserId, subscribeAccessTokenChanges } from '../../auth/tokenStore';
import { nativeImageCacheKey, removeNativeImageCacheEntry } from '../../files/nativeImageCache';
import { resolveAttachmentUrl } from '../../utils/attachmentUrl';

export function AuthenticatedRemoteImage(props: ComponentProps<typeof ProtectedImage>) {
  return <ProtectedImage key={props.uri} {...props} />;
}

function ProtectedImage({
  uri,
  style,
  accessibilityLabel,
  resizeMode = 'cover',
  fallback,
}: {
  uri: string;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
  resizeMode?: ImageResizeMode;
  fallback?: ReactNode;
}) {
  const [source, setSource] = useState<ImageSource | null>(null);
  const [failed, setFailed] = useState(false);
  const [requestVersion, setRequestVersion] = useState(0);
  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);
  const refreshAttemptedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  const loadHeaders = useCallback(async (forceRefresh = false) => {
    const requestId = ++requestIdRef.current;
    const generation = getSessionGeneration();
    const current = () => mountedRef.current && requestId === requestIdRef.current
      && generation === getSessionGeneration();
    try {
      const trustedUri = resolveAttachmentUrl(uri);
      if (!trustedUri) throw new Error('Недопустимый адрес изображения');
      const userId = Number(await getSessionUserId());
      const cacheKey = nativeImageCacheKey(userId, trustedUri);
      if (!current()) return;
      if (forceRefresh) {
        await removeNativeImageCacheEntry(cacheKey);
        if (!current()) return;
      }
      if (!forceRefresh) {
        // Read cached files before requesting fresh credentials, including offline cold starts.
        const cached = await Image.getCachePathAsync(cacheKey).catch(() => null);
        if (!current()) return;
        if (cached) {
          setSource({ uri: cached.startsWith('file:') ? cached : `file://${cached}`, cacheKey });
          setFailed(false);
          return;
        }
      }
      const next = await getAuthenticatedRequestHeaders({
        forceRefresh,
        preserveSessionOnRefreshFailure: forceRefresh,
      });
      if (!current()) return;
      setSource({ uri: trustedUri, headers: next, cacheKey });
      setFailed(false);
      if (forceRefresh) setRequestVersion((value) => value + 1);
    } catch {
      if (current()) setFailed(true);
    }
  }, [uri]);

  useEffect(() => {
    refreshAttemptedRef.current = false;
    setFailed(false);
    setSource(null);
    setRequestVersion(0);
    void loadHeaders();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadHeaders, uri]);

  useEffect(() => subscribeAccessTokenChanges((accessToken) => {
    if (!accessToken) {
      requestIdRef.current += 1;
      setSource(null);
      setFailed(true);
      return;
    }
    void loadHeaders();
  }), [loadHeaders]);

  const handleError = () => {
    if (refreshAttemptedRef.current) {
      setFailed(true);
      return;
    }
    refreshAttemptedRef.current = true;
    void loadHeaders(true);
  };

  if (failed || !source) {
    return fallback ?? <View style={[styles.placeholder, style]} />;
  }

  return (
    <Image
      key={`${uri}:${requestVersion}`}
      source={source}
      style={style}
      contentFit={resizeMode === 'stretch' ? 'fill' : resizeMode === 'center' ? 'none' : resizeMode === 'repeat' ? 'cover' : resizeMode}
      cachePolicy={requestVersion > 0 ? 'disk' : source.uri?.startsWith('file:') ? 'memory' : 'memory-disk'}
      recyclingKey={`${source.cacheKey}:${requestVersion}`}
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      onError={handleError}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: { backgroundColor: 'rgba(32, 31, 30, 0.06)' },
});
