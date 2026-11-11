import { createMailRichSnapshotRequest, type MailRichSnapshot } from '../../mail/mailRichSnapshotRequest';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { FluentTokens } from '../../theme/fluentTokens';
import { getSafeNativeMailExternalUrl } from '../../mail/nativeMailHtml';
import { MAIL_RICH_EDITOR_BRIDGE, richMailEditorDocument, type MailRichCommand } from '../../mail/nativeMailRichEditor';

const commands: Array<[MailRichCommand, string, string]> = [
  ['bold', 'Ж', 'Жирный'], ['italic', 'К', 'Курсив'],
  ['insertUnorderedList', '• ≡', 'Маркированный список'], ['insertOrderedList', '1. ≡', 'Нумерованный список'],
  ['createLink', 'Ссылка', 'Добавить ссылку'], ['removeFormat', 'Очистить', 'Убрать оформление'],
  ['undo', '↶', 'Отменить изменение'], ['redo', '↷', 'Повторить изменение'],
];

function createEditorSource(html: string, dark: boolean) {
  try { return { html: richMailEditorDocument(html, dark), baseUrl: 'about:blank' }; }
  catch { return null; }
}

export type NativeMailRichEditorHandle = { snapshot: () => Promise<MailRichSnapshot>; release: () => void };

export const NativeMailRichEditor = forwardRef<NativeMailRichEditorHandle, {
  initialHtml: string; disabled: boolean; tokens: FluentTokens;
  onChange: (value: MailRichSnapshot) => void; onReady: (ready: boolean) => void;
}>(function NativeMailRichEditor({ initialHtml, disabled, tokens, onChange, onReady }, ref) {
  const web = useRef<WebView>(null);
  // Parent remounts for a different document. Typing must never reload the WebView.
  const initial = useRef(initialHtml);
  const latestHtml = useRef(initialHtml);
  const generation = useRef(0);
  const alive = useRef(true);
  const [documentGeneration, setDocumentGeneration] = useState(0);
  const [source, setSource] = useState(() => createEditorSource(initial.current, tokens.pageBg === '#0f1115'));
  const requests = useRef(createMailRichSnapshotRequest()).current;
  const captureActive = useRef(false);
  const [capturing, setCapturing] = useState(false);
  const [ready, setReady] = useState(false);
  const sourceUnavailable = !source;
  const [failed, setFailed] = useState(sourceUnavailable);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState('');
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current += 1; requests.cancel(); }; }, [requests]);
  const fail = () => {
    if (!alive.current) return;
    generation.current += 1;
    requests.cancel(); captureActive.current = false; setCapturing(false);
    setFailed(true); setReady(false); onReady(false);
  };
  useEffect(() => {
    if (ready || failed) return;
    const timer = setTimeout(fail, 8000);
    return () => clearTimeout(timer);
  }, [ready, failed, documentGeneration]); // eslint-disable-line react-hooks/exhaustive-deps
  const restore = () => {
    requests.cancel(); generation.current += 1;
    captureActive.current = false; setCapturing(false); setReady(false); onReady(false);
    setFailed(false); setLinkOpen(false);
    setSource(createEditorSource(latestHtml.current, tokens.pageBg === '#0f1115'));
    setDocumentGeneration(generation.current);
  };
  useImperativeHandle(ref, () => ({
    snapshot: async () => {
      if (captureActive.current) throw new Error('Дождитесь завершения предыдущего действия.');
      if (!ready || !web.current) throw new Error('Редактор ещё не готов. Повторите действие.');
      const lease = generation.current;
      captureActive.current = true;
      setCapturing(true);
      try {
        const value = await requests.request((id) => web.current!.injectJavaScript(`window.hubitMailEditor?.('snapshot',${id}); true;`));
        if (!alive.current || lease !== generation.current) throw new Error('Редактор перезапущен. Повторите действие.');
        latestHtml.current = value.html;
        return value;
      } catch (cause) { if (alive.current && lease === generation.current) { captureActive.current = false; setCapturing(false); } throw cause; }
    },
    release: () => { if (!alive.current) return; requests.cancel(); captureActive.current = false; setCapturing(false); },
  }), [ready, requests]);
  const run = (command: MailRichCommand, value?: string) => {
    if (!disabled && !capturing && ready) web.current?.injectJavaScript(`window.hubitMailEditor?.(${JSON.stringify(command)},${JSON.stringify(value || '')}); true;`);
  };
  const syncDisabled = () => web.current?.injectJavaScript(`window.hubitMailEditor?.('disabled',${disabled || capturing}); true;`);
  // Lock the DOM as soon as a save/send begins, including native keyboard input.
  useEffect(() => { if (ready) syncDisabled(); }, [disabled, capturing, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  return <View>
    <View style={styles.toolbar}>{commands.map(([command, label, accessibilityLabel]) => <Pressable key={command} disabled={disabled || capturing || !ready} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled: disabled || capturing || !ready }} onPress={() => {
      if (command === 'createLink') { setLinkOpen(true); setLinkError(''); } else run(command);
    }} style={[styles.button, { borderColor: tokens.borderSoft, opacity: disabled || capturing || !ready ? 0.5 : 1 }]}><Text style={{ color: tokens.textPrimary }}>{label}</Text></Pressable>)}</View>
    {linkOpen ? <View>
      <TextInput accessibilityLabel="Адрес ссылки" value={link} onChangeText={setLink} editable={!disabled && !capturing && ready} autoCapitalize="none" keyboardType="url" style={{ color: tokens.textPrimary }} />
      {linkError ? <Text accessibilityRole="alert" style={{ color: tokens.error }}>{linkError}</Text> : null}
      <Pressable disabled={disabled || capturing || !ready} accessibilityRole="button" accessibilityLabel="Вставить ссылку" style={styles.button} onPress={() => {
        const url = getSafeNativeMailExternalUrl(link);
        if (!url || !/^(https?:|mailto:)/i.test(url)) { setLinkError('Введите ссылку https:// или адрес mailto:.'); return; }
        run('createLink', url); setLinkOpen(false); setLink('');
      }}><Text style={{ color: tokens.primary }}>Вставить</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Отменить вставку ссылки" style={styles.button} onPress={() => setLinkOpen(false)}><Text style={{ color: tokens.textPrimary }}>Отмена</Text></Pressable>
    </View> : null}
    {!ready && !failed ? <Text accessibilityLiveRegion="polite" style={{ color: tokens.textSecondary }}>Подготавливаем редактор…</Text> : null}
    {failed ? <View><Text accessibilityRole="alert" style={{ color: tokens.error }}>Редактор недоступен. Можно восстановить последнюю полученную версию текста. Непереданные изменения могли не сохраниться.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Восстановить редактор" disabled={disabled || sourceUnavailable} onPress={restore} style={styles.button}><Text style={{ color: tokens.primary }}>Восстановить редактор</Text></Pressable>
    </View> : null}
    {sourceUnavailable ? <Text accessibilityRole="alert" style={{ color: tokens.error }}>Не удалось подготовить письмо для редактора. Исходное содержимое не изменено.</Text> : <WebView key={documentGeneration} ref={web} testID="native-mail-rich-editor" source={source!} style={styles.editor} javaScriptEnabled injectedJavaScript={MAIL_RICH_EDITOR_BRIDGE}
      originWhitelist={['about:blank']} onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
      onLoadStart={() => { if (documentGeneration !== generation.current) return; if (ready) { fail(); return; } requests.cancel(); captureActive.current = false; setCapturing(false); setReady(false); onReady(false); }}
      onMessage={(event) => {
        try {
          if (!alive.current || documentGeneration !== generation.current || failed) return;
          const value = JSON.parse(event.nativeEvent.data);
          if (requests.receive(value)) return;
          if (value.type === 'ready') { setReady(true); setFailed(false); syncDisabled(); onReady(true); }
          if (value.type === 'change' && !disabled && ready && typeof value.html === 'string' && typeof value.text === 'string') {
            if (value.html.length > 2_000_000 || value.text.length > 2_000_000) { fail(); return; }
            latestHtml.current = value.html; onChange({ html: value.html, text: value.text });
          }
        } catch { /* Ignore invalid bridge messages. */ }
      }}
      onError={() => { if (documentGeneration === generation.current) fail(); }}
      onRenderProcessGone={() => { if (documentGeneration === generation.current) fail(); }}
      domStorageEnabled={false} cacheEnabled={false} incognito allowFileAccess={false} allowUniversalAccessFromFileURLs={false}
      javaScriptCanOpenWindowsAutomatically={false} mixedContentMode="never" setSupportMultipleWindows={false} />}
  </View>;
});
const styles = StyleSheet.create({ toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 }, button: { minWidth: 44, minHeight: 44, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: 6 }, editor: { minHeight: 280, height: 320 } });
