import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { ChatAttachment } from '../../api/types';
import { subscribeAccessTokenChanges } from '../../auth/tokenStore';
import { pickChatAttachmentPlaybackUrl, pickChatAttachmentPreviewUrl } from '../../chat/chatMedia';
import { getChatMediaRequestHeaders } from '../../files/chatMediaRequest';
import { resolveAttachmentUrl } from '../../utils/attachmentUrl';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';

const PLAYER_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1" />
<style>
  html,body{margin:0;height:100%;background:#000}
  video{width:100%;height:100%;object-fit:contain;background:#000}
</style>
</head>
<body>
<video id="v" controls playsinline webkit-playsinline></video>
<script>
function post(payload) {
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload));
}
var video = document.getElementById('v');
window.__hubitPlay = async function (payload) {
  try {
    var response = await fetch(payload.url, { headers: payload.headers || {} });
    if (!response.ok) throw new Error('http');
    var blob = await response.blob();
    video.src = URL.createObjectURL(blob);
    await video.play();
    post({ type: 'playing' });
  } catch (error) {
    post({ type: 'error', message: String(error && error.message || error) });
  }
};
video.addEventListener('error', function () { post({ type: 'error', message: 'play' }); });
post({ type: 'ready' });
</script>
</body>
</html>`;

function headersEqual(
  left: Record<string, string> | null,
  right: Record<string, string>,
): boolean {
  if (!left) return false;
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) return false;
  return leftEntries.every(([key, value]) => right[key] === value);
}

export function ChatVideoPlayer({
  attachment,
}: {
  attachment?: ChatAttachment | null;
}) {
  const { styles } = useChatStyles(createStyles);
  const playbackUrl = resolveAttachmentUrl(pickChatAttachmentPlaybackUrl(attachment));
  const previewUrl = resolveAttachmentUrl(pickChatAttachmentPreviewUrl(attachment));
  const [started, setStarted] = useState(false);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [directFailed, setDirectFailed] = useState(false);
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  const [playerVersion, setPlayerVersion] = useState(0);
  const webRef = useRef<{ injectJavaScript?: (script: string) => void } | null>(null);
  const mountedRef = useRef(false);
  const startedRef = useRef(false);
  const requestIdRef = useRef(0);
  const currentHeadersRef = useRef<Record<string, string> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    startedRef.current = started;
  }, [started]);

  const loadHeaders = useCallback(async ({ reloadStarted = false } = {}) => {
    const requestId = ++requestIdRef.current;
    try {
      const nextHeaders = await getChatMediaRequestHeaders({
        preserveSessionOnRefreshFailure: true,
      });
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      const changed = !headersEqual(currentHeadersRef.current, nextHeaders);
      currentHeadersRef.current = nextHeaders;
      setHeaders(nextHeaders);
      if (reloadStarted && changed && startedRef.current) {
        setDirectFailed(false);
        setReady(false);
        setLoading(true);
        setError('');
        setPlayerVersion((value) => value + 1);
      }
    } catch {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      if (!currentHeadersRef.current) setHeaders(null);
    }
  }, []);

  useEffect(() => {
    setStarted(false);
    setReady(false);
    setLoading(false);
    setError('');
    setDirectFailed(false);
    setPlayerVersion(0);
  }, [attachment?.id, playbackUrl]);

  useEffect(() => {
    currentHeadersRef.current = null;
    setHeaders(null);
    void loadHeaders();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadHeaders, playbackUrl]);

  useEffect(() => subscribeAccessTokenChanges((accessToken) => {
    if (!accessToken || !playbackUrl) return;
    void loadHeaders({ reloadStarted: true });
  }), [loadHeaders, playbackUrl]);

  const start = () => {
    if (!playbackUrl || !headers || loading) return;
    setStarted(true);
    setLoading(true);
    setError('');
    setDirectFailed(false);
  };

  const injectPlay = (inject?: (script: string) => void) => {
    if (!playbackUrl || !headers || !inject) return;
    inject(`window.__hubitPlay(${JSON.stringify({ url: playbackUrl, headers })}); true;`);
  };

  const enterBlobFallback = () => {
    setDirectFailed(true);
    setReady(false);
    setLoading(true);
  };

  const handleDirectFailure = () => {
    const failedHeaders = currentHeadersRef.current;
    const failedPlaybackUrl = playbackUrl;
    const requestId = ++requestIdRef.current;
    void getChatMediaRequestHeaders({
      forceRefresh: true,
      preserveSessionOnRefreshFailure: true,
    })
      .then((nextHeaders) => {
        if (
          !mountedRef.current
          || requestId !== requestIdRef.current
          || failedPlaybackUrl !== playbackUrl
        ) return;
        if (!headersEqual(failedHeaders, nextHeaders)) {
          currentHeadersRef.current = nextHeaders;
          setHeaders(nextHeaders);
          setDirectFailed(false);
          setReady(false);
          setLoading(true);
          setError('');
          setPlayerVersion((value) => value + 1);
          return;
        }
        enterBlobFallback();
      })
      .catch(() => {
        if (mountedRef.current && requestId === requestIdRef.current) enterBlobFallback();
      });
  };

  if (!playbackUrl) {
    return <Text style={styles.placeholder}>Видео недоступно</Text>;
  }

  if (!started) {
    return (
      <View style={styles.stage}>
        {previewUrl ? (
          <Image source={{ uri: previewUrl, headers: headers || {} }} style={StyleSheet.absoluteFill} resizeMode="contain" />
        ) : null}
        <Pressable
          onPress={start}
          disabled={!headers}
          style={({ pressed }) => [styles.play, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Воспроизвести видео"
        >
          <Text style={styles.playMark}>▶</Text>
          <Text style={styles.playText}>{headers ? 'Смотреть' : 'Подготавливаем…'}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.player}>
      <WebView
        key={`${attachment?.id || playbackUrl}:${directFailed ? 'blob' : 'direct'}:${playerVersion}`}
        testID="chat-video-webview"
        ref={(node) => {
          webRef.current = node as { injectJavaScript?: (script: string) => void } | null;
        }}
        source={directFailed
          ? { html: PLAYER_HTML }
          : { uri: playbackUrl, headers: headers || {} }}
        originWhitelist={['*']}
        javaScriptEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        onLoadStart={() => {
          if (!directFailed) setLoading(true);
        }}
        onLoadEnd={() => {
          if (!directFailed) {
            setLoading(false);
            setError('');
          }
        }}
        onError={() => {
          if (!directFailed) {
            handleDirectFailure();
            return;
          }
          setLoading(false);
          setError('Не удалось воспроизвести видео');
        }}
        onHttpError={() => {
          if (!directFailed) {
            handleDirectFailure();
          }
        }}
        onMessage={(event) => {
          if (!directFailed) return;
          try {
            const payload = JSON.parse(event.nativeEvent.data) as { type?: string };
            if (payload.type === 'ready') {
              setReady(true);
              injectPlay(webRef.current?.injectJavaScript);
              return;
            }
            if (payload.type === 'playing') {
              setLoading(false);
              setError('');
              return;
            }
            if (payload.type === 'error') {
              setLoading(false);
              setError('Не удалось воспроизвести видео');
            }
          } catch {
            setLoading(false);
            setError('Не удалось воспроизвести видео');
          }
        }}
        style={styles.web}
      />
      {loading || (directFailed && !ready) ? (
        <View style={styles.cover} accessibilityLiveRegion="polite">
          <ActivityIndicator color="#fff" />
          <Text style={styles.coverText}>Загружаем видео…</Text>
        </View>
      ) : null}
      {error ? (
        <View style={styles.cover}>
          <Text style={styles.error}>{error}</Text>
          <Pressable
            onPress={() => {
              setStarted(false);
              setDirectFailed(false);
              setReady(false);
              setError('');
              void loadHeaders();
            }}
            style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Повторить воспроизведение видео"
          >
            <Text style={styles.retryText}>Повторить</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  stage: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' },
  play: {
    minWidth: 132,
    minHeight: 132,
    borderRadius: 66,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.46)',
  },
  playMark: { color: '#fff', fontSize: 36, fontWeight: '700' },
  playText: { marginTop: 6, color: '#fff', fontSize: 14, fontWeight: '700' },
  player: { flex: 1, width: '100%' },
  web: { flex: 1, backgroundColor: '#000' },
  cover: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  coverText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  placeholder: { color: '#fff', fontSize: 18, fontWeight: '700' },
  error: { color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center', paddingHorizontal: 24 },
  retry: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    justifyContent: 'center',
    backgroundColor: chatTokens.composerActionBg,
  },
  retryText: { color: '#fff', fontWeight: '700' },
  pressed: { opacity: 0.8 },
});
