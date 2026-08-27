import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Image,
  StyleSheet,
  View,
  type ImageResizeMode,
  type ImageStyle,
  type StyleProp,
} from 'react-native';
import { getAuthenticatedRequestHeaders } from '../../files/authenticatedRequestHeaders';
import { subscribeAccessTokenChanges } from '../../auth/tokenStore';

export function AuthenticatedRemoteImage({
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
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
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
    try {
      const next = await getAuthenticatedRequestHeaders({
        forceRefresh,
        preserveSessionOnRefreshFailure: forceRefresh,
      });
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setHeaders(next);
      setFailed(false);
      if (forceRefresh) setRequestVersion((value) => value + 1);
    } catch {
      if (mountedRef.current && requestId === requestIdRef.current) setFailed(true);
    }
  }, []);

  useEffect(() => {
    refreshAttemptedRef.current = false;
    setFailed(false);
    setHeaders(null);
    setRequestVersion(0);
    void loadHeaders();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadHeaders, uri]);

  useEffect(() => subscribeAccessTokenChanges((accessToken) => {
    if (!accessToken) return;
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

  if (failed || !headers?.Authorization) {
    return fallback ?? <View style={[styles.placeholder, style]} />;
  }

  return (
    <Image
      key={`${uri}:${requestVersion}`}
      source={{ uri, headers }}
      style={style}
      resizeMode={resizeMode}
      accessibilityLabel={accessibilityLabel}
      onError={handleError}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: { backgroundColor: 'rgba(32, 31, 30, 0.06)' },
});
