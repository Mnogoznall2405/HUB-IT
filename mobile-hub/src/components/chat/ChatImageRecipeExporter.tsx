import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import {
  CHAT_IMAGE_EDITOR_EXPORT_HTML,
  parseChatImageEditorExportMessage,
} from '../../chat/chatImageEditorCanvas';

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

  useEffect(() => {
    readyRef.current = false;
  }, [requestId]);

  useEffect(() => {
    if (!readyRef.current || !requestId || !imageDataUrl) return;
    const script = `window.__hubitExport(${JSON.stringify({
      requestId,
      imageDataUrl,
      recipe: JSON.parse(recipeJson),
    })}); true;`;
    webRef.current?.injectJavaScript(script);
  }, [imageDataUrl, recipeJson, requestId]);

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        ref={webRef}
        source={{ html: CHAT_IMAGE_EDITOR_EXPORT_HTML }}
        originWhitelist={['*']}
        javaScriptEnabled
        onMessage={(event) => {
          const payload = parseChatImageEditorExportMessage(event.nativeEvent.data);
          if (!payload) return;
          if (payload.type === 'ready') {
            readyRef.current = true;
            onReady();
            if (requestId && imageDataUrl) {
              const script = `window.__hubitExport(${JSON.stringify({
                requestId,
                imageDataUrl,
                recipe: JSON.parse(recipeJson),
              })}); true;`;
              webRef.current?.injectJavaScript(script);
            }
            return;
          }
          if (payload.type === 'exported' && payload.requestId && payload.dataUrl) {
            onExported(payload.requestId, payload.dataUrl);
            return;
          }
          if (payload.type === 'error' && payload.requestId) {
            onError(payload.requestId, payload.message || 'export');
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { width: 1, height: 1, opacity: 0, overflow: 'hidden' },
});
