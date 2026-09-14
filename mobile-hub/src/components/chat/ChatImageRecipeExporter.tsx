import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import {
  CHAT_IMAGE_EDITOR_EXPORT_HTML,
  parseChatImageEditorExportMessage,
} from '../../chat/chatImageEditorCanvas';
const exportSource = { html: CHAT_IMAGE_EDITOR_EXPORT_HTML };

export function ChatImageRecipeExporter({
  requestId,
  imageDataUrl,
  recipeJson,
  onReady,
  onExported,
  onError,
}: {
  requestId: string;
  imageDataUrl: string;
  recipeJson: string;
  onReady: () => void;
  onExported: (requestId: string, dataUrl: string) => void;
  onError: (requestId: string, message: string) => void;
}) {
  const webRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const sentRef = useRef('');
  const settledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacksRef = useRef({ onError, onExported, onReady });
  callbacksRef.current = { onError, onExported, onReady };

  const finish = (message?: string, dataUrl?: string) => {
    if (settledRef.current) return;
    settledRef.current = true;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (dataUrl) callbacksRef.current.onExported(requestId, dataUrl);
    else callbacksRef.current.onError(requestId, message || 'export');
  };

  useEffect(() => {
    settledRef.current = false;
    timerRef.current = setTimeout(() => finish('timeout'), 30_000);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [requestId]);

  const inject = () => {
    if (!readyRef.current || !requestId || !imageDataUrl || sentRef.current === requestId || settledRef.current) return;
    try {
      const script = `window.__hubitExport(${JSON.stringify({ requestId, imageDataUrl, recipe: JSON.parse(recipeJson) })}); true;`;
      sentRef.current = requestId;
      webRef.current?.injectJavaScript(script);
    } catch { finish('export'); }
  };
  useEffect(inject, [imageDataUrl, recipeJson, requestId]);

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        ref={webRef}
        source={exportSource}
        originWhitelist={['*']}
        javaScriptEnabled
        onError={() => finish('webview')}
        onRenderProcessGone={() => finish('webview')}
        onContentProcessDidTerminate={() => finish('webview')}
        onMessage={(event) => {
          const payload = parseChatImageEditorExportMessage(event.nativeEvent.data);
          if (!payload) return;
          if (payload.type === 'ready') {
            readyRef.current = true;
            callbacksRef.current.onReady();
            inject();
            return;
          }
          if (payload.requestId !== requestId) return;
          if (payload.type === 'exported' && payload.dataUrl) {
            finish(undefined, payload.dataUrl);
            return;
          }
          if (payload.type === 'error' && payload.requestId) {
            finish(payload.message || 'export');
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { width: 1, height: 1, opacity: 0, overflow: 'hidden' },
});
