import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { MailAttachment } from '../../api/mailApi';
import { getSafeNativeMailExternalUrl, prepareNativeMailHtml, shouldAllowMailDocumentNavigation } from '../../mail/nativeMailHtml';
import type { FluentTokens } from '../../theme/fluentTokens';

const MAIL_HEIGHT_BRIDGE = `
  (function () {
    var sendHeight = function () {
      var body = document.body;
      var root = document.documentElement;
      var height = Math.ceil(Math.max(
        body ? body.scrollHeight : 0,
        body ? body.offsetHeight : 0,
        root ? root.scrollHeight : 0,
        root ? root.offsetHeight : 0
      ));
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'mail-height', height: height }));
    };
    window.addEventListener('load', sendHeight);
    Array.prototype.forEach.call(document.images || [], function (image) {
      image.addEventListener('load', sendHeight);
      image.addEventListener('error', sendHeight);
    });
    document.addEventListener('click', function (event) {
      var target = event.target;
      while (target && target.tagName !== 'A') target = target.parentElement;
      if (!target || !target.href) return;
      event.preventDefault();
      event.stopPropagation();
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'mail-link', url: target.href }));
    }, true);
    if (window.ResizeObserver && document.documentElement) {
      new ResizeObserver(sendHeight).observe(document.documentElement);
    }
    setTimeout(sendHeight, 0);
    setTimeout(sendHeight, 120);
    setTimeout(sendHeight, 500);
  })();
  true;
`;

export function NativeMailHtmlBody({
  bodyHtml,
  plainText,
  attachments,
  compact,
  flat = false,
  tokens,
}: {
  bodyHtml: string;
  plainText?: string | null;
  attachments?: MailAttachment[];
  compact?: boolean;
  flat?: boolean;
  tokens: FluentTokens;
}) {
  const { height: windowHeight, fontScale } = useWindowDimensions();
  const textZoom = Math.round((Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1) * 100);
  const [textOnly, setTextOnly] = useState(false);
  const [renderFailed, setRenderFailed] = useState(false);
  const [allowExternalImages, setAllowExternalImages] = useState(false);
  const [contentHeight, setContentHeight] = useState(compact ? 260 : 420);
  const [longContent, setLongContent] = useState(false);
  const prepared = useMemo(() => prepareNativeMailHtml(bodyHtml, attachments, {
    allowExternalImages,
    dark: tokens.pageBg === '#0f1115',
  }), [allowExternalImages, attachments, bodyHtml, tokens.pageBg]);
  const webFallback = useMemo(
    () => String(plainText || '').trim() || htmlToReadableText(bodyHtml) || 'В письме нет содержимого.',
    [bodyHtml, plainText],
  );

  useEffect(() => {
    setContentHeight(compact ? 260 : 420);
    setLongContent(false);
  }, [bodyHtml, compact]);

  useEffect(() => {
    setRenderFailed(false);
    setTextOnly(false);
  }, [bodyHtml]);

  const openExternalLink = useCallback(async (value: unknown) => {
    const url = getSafeNativeMailExternalUrl(value);
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Не удалось открыть ссылку', 'На устройстве нет подходящего приложения или ссылка недоступна.');
    }
  }, []);

  const handleNavigation = useCallback((url: string) => {
    if (shouldAllowMailDocumentNavigation(url)) return true;
    void openExternalLink(url);
    return false;
  }, [openExternalLink]);

  const longContentHeight = Math.max(160, Math.min(900, Math.round(windowHeight * 0.72)));

  return (
    <View style={styles.container}>
      {Platform.OS !== 'web' ? <View>
        {renderFailed ? <Text accessibilityRole="alert" style={{ color: tokens.textSecondary }}>Не удалось показать оформление. Текст письма доступен ниже.</Text> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={textOnly || renderFailed ? 'Показать оформление письма' : 'Читать письмо как текст'}
          onPress={() => { setTextOnly(!(textOnly || renderFailed)); setRenderFailed(false); }} style={styles.privacyAction}>
          <Text style={{ color: tokens.primary }}>{textOnly || renderFailed ? 'Показать оформление' : 'Читать как текст'}</Text>
        </Pressable>
      </View> : null}
      {prepared.hasBlockedExternalImages || allowExternalImages ? (
        <View style={[styles.privacyBar, { backgroundColor: tokens.panelInset }]}>
          <Text style={[styles.privacyText, { color: tokens.textSecondary }]}>
            {allowExternalImages
              ? 'Внешние изображения разрешены для этого письма.'
              : 'Внешние изображения скрыты для защиты приватности.'}
          </Text>
          <Pressable
            testID="native-mail-toggle-external-images"
            accessibilityRole="button"
            accessibilityLabel={allowExternalImages ? 'Скрыть внешние изображения' : 'Показать внешние изображения'}
            onPress={() => setAllowExternalImages((current) => !current)}
            style={styles.privacyAction}
          >
            <Text style={[styles.privacyActionText, { color: tokens.primary }]}>
              {allowExternalImages ? 'Скрыть' : 'Показать'}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {Platform.OS === 'web' || textOnly || renderFailed ? (
        <Text testID="native-mail-html-web-fallback" selectable style={[styles.webFallback, { color: tokens.textPrimary }]}>{webFallback}</Text>
      ) : <View style={[
        styles.webFrame,
        flat ? styles.webFrameFlat : null,
        { borderColor: tokens.borderSoft, backgroundColor: flat ? tokens.pageBg : tokens.panelSolid },
      ]}>
        <WebView
          testID="native-mail-html-body"
          source={{ html: prepared.document, baseUrl: 'about:blank' }}
          originWhitelist={['about:blank', 'data:text/html*', 'http://*', 'https://*', 'mailto:*', 'tel:*']}
          onShouldStartLoadWithRequest={(request) => handleNavigation(request.url)}
          onError={() => setRenderFailed(true)}
          onRenderProcessGone={() => setRenderFailed(true)}
          javaScriptEnabled
          injectedJavaScript={MAIL_HEIGHT_BRIDGE}
          onMessage={(event) => {
            try {
              const payload = JSON.parse(String(event.nativeEvent.data || '')) as { type?: string; height?: number; url?: string };
              const nextHeight = Number(payload.height || 0);
              if (payload.type === 'mail-height' && Number.isFinite(nextHeight) && nextHeight > 0) {
                if (nextHeight > 20_000) {
                  setLongContent(true);
                  setContentHeight(longContentHeight);
                } else {
                  setLongContent(false);
                  setContentHeight(Math.max(80, Math.ceil(nextHeight)));
                }
              } else if (payload.type === 'mail-link') {
                void openExternalLink(payload.url);
              }
            } catch {
              // Ignore malformed bridge messages. The sanitized document is the only expected sender.
            }
          }}
          javaScriptCanOpenWindowsAutomatically={false}
          domStorageEnabled={false}
          cacheEnabled={false}
          incognito
          allowFileAccess={false}
          allowUniversalAccessFromFileURLs={false}
          mixedContentMode="never"
          setSupportMultipleWindows={false}
          nestedScrollEnabled={longContent}
          scrollEnabled={longContent}
          textZoom={textZoom}
          accessibilityLabel={String(plainText || '').trim() || 'Содержимое HTML-письма'}
          style={{ height: longContent ? longContentHeight : contentHeight, backgroundColor: flat ? tokens.pageBg : tokens.panelSolid }}
        />
      </View>}
      {longContent && !textOnly && !renderFailed ? (
        <Text testID="native-mail-long-html-hint" style={[styles.longContentHint, { color: tokens.textTertiary }]}>Длинное письмо: прокручивайте содержимое внутри блока.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 15, gap: 8 },
  privacyBar: { minHeight: 44, borderRadius: 10, paddingLeft: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  privacyText: { flex: 1, fontSize: 11, lineHeight: 16, fontWeight: '600' },
  privacyAction: { minWidth: 76, minHeight: 44, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  privacyActionText: { fontSize: 12, fontWeight: '900' },
  webFrame: { overflow: 'hidden', borderWidth: 1, borderRadius: 12 },
  webFrameFlat: { borderWidth: 0, borderRadius: 0 },
  webFallback: { fontSize: 16, lineHeight: 25 },
  longContentHint: { fontSize: 11, lineHeight: 16 },
});

function htmlToReadableText(value: string): string {
  return String(value || '')
    .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/(?:p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
