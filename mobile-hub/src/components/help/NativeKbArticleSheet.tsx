import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useContext } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaInsetsContext, initialWindowMetrics } from 'react-native-safe-area-context';
import type { KbArticle, KbAttachment } from '../../api/kbApi';
import type { FluentTokens } from '../../theme/fluentTokens';
import { NativeModal } from '../ui/NativeModal';
import { NativeSheetHeader } from '../ui/NativeFilterControls';
import { formatWarehouse1cDate } from '../warehouse1c/NativeWarehouse1CCards';

function formatKbDate(value: string): string {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? formatWarehouse1cDate(value) : parsed.toLocaleString('ru-RU');
}

function formatKbFileSize(bytes: number): string {
  const size = Math.max(0, Number(bytes || 0));
  if (!size) return '';
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} КБ`;
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`;
}

function ContentSection({ title, tokens, children }: { title: string; tokens: FluentTokens; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <View style={[styles.section, { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft }]}>
      <Text style={[styles.sectionTitle, { color: tokens.textSecondary }]}>{title}</Text>
      {children}
    </View>
  );
}

function LinesList({ items, ordered, tokens }: { items: string[]; ordered?: boolean; tokens: FluentTokens }) {
  const rows = (items || []).map((item) => String(item || '').trim()).filter(Boolean);
  if (!rows.length) return null;
  return (
    <View style={styles.lines}>
      {rows.map((item, index) => (
        <View key={index} style={styles.lineRow}>
          <Text style={[styles.lineBullet, { color: tokens.primary }]}>{ordered ? `${index + 1}.` : '•'}</Text>
          <Text style={[styles.lineText, { color: tokens.textPrimary }]}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

export function NativeKbArticleSheet({
  visible,
  article,
  loading,
  error,
  busyAttachmentKey,
  onClose,
  onDownloadAttachment,
  tokens,
}: {
  visible: boolean;
  article: KbArticle | null;
  loading: boolean;
  error: string;
  busyAttachmentKey: string;
  onClose: () => void;
  onDownloadAttachment: (articleId: string, attachment: KbAttachment) => void;
  tokens: FluentTokens;
}) {
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets;
  const content = article?.content;
  const attachments = article?.attachments || [];
  const metaLine = [
    article?.version ? `версия ${article.version}` : '',
    article?.updatedAt ? `обновлена ${formatKbDate(article.updatedAt)}` : '',
    article?.ownerName ? `автор: ${article.ownerName}` : '',
    article?.departmentName || '',
  ].filter(Boolean).join(' · ');

  return (
    <NativeModal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть статью"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          testID="native-kb-article-sheet"
          accessibilityViewIsModal
          style={[styles.sheet, {
            backgroundColor: tokens.panelSolid,
            borderColor: tokens.borderSoft,
            paddingBottom: Math.max(16, (insets?.bottom || 0) + 8),
            paddingLeft: insets?.left || 0,
            paddingRight: insets?.right || 0,
          }]}
        >
          <NativeSheetHeader
            title={article?.title || 'Статья базы знаний'}
            subtitle={metaLine || undefined}
            tokens={tokens}
            onClose={onClose}
          />
          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={tokens.primary} />
              <Text style={[styles.hint, { color: tokens.textSecondary }]}>Загружаем статью…</Text>
            </View>
          ) : null}
          {error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text> : null}
          {!loading && !error && article ? (
            <ScrollView contentContainerStyle={styles.body}>
              {article.summary ? (
                <Text style={[styles.summary, { color: tokens.textSecondary }]}>{article.summary}</Text>
              ) : null}
              {article.tags.length ? (
                <View style={styles.tagsRow}>
                  {article.tags.map((tag) => (
                    <Text key={tag} style={[styles.tag, { color: tokens.textSecondary, borderColor: tokens.borderSoft }]}>#{tag}</Text>
                  ))}
                </View>
              ) : null}
              <ContentSection title="Описание" tokens={tokens}>
                {content?.overview ? <Text style={[styles.bodyText, { color: tokens.textPrimary }]}>{content.overview}</Text> : null}
              </ContentSection>
              <ContentSection title="Симптомы" tokens={tokens}>
                {content?.symptoms ? <Text style={[styles.bodyText, { color: tokens.textPrimary }]}>{content.symptoms}</Text> : null}
              </ContentSection>
              <ContentSection title="Что проверить" tokens={tokens}>
                <LinesList items={content?.checks || []} tokens={tokens} />
              </ContentSection>
              <ContentSection title="Команды" tokens={tokens}>
                {content?.commands?.length ? (
                  <View style={styles.lines}>
                    {content.commands.map((command, index) => (
                      <Text key={index} selectable style={[styles.command, { color: tokens.textPrimary, backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>{command}</Text>
                    ))}
                  </View>
                ) : null}
              </ContentSection>
              <ContentSection title="Шаги решения" tokens={tokens}>
                <LinesList items={content?.resolutionSteps || []} ordered tokens={tokens} />
              </ContentSection>
              <ContentSection title="Откат" tokens={tokens}>
                <LinesList items={content?.rollbackSteps || []} tokens={tokens} />
              </ContentSection>
              <ContentSection title="Эскалация" tokens={tokens}>
                {content?.escalation ? <Text style={[styles.bodyText, { color: tokens.textPrimary }]}>{content.escalation}</Text> : null}
              </ContentSection>
              {content?.faq?.length ? (
                <View style={[styles.section, { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft }]}>
                  <Text style={[styles.sectionTitle, { color: tokens.textSecondary }]}>Вопросы и ответы</Text>
                  {content.faq.map((item, index) => (
                    <View key={index} style={styles.faqItem}>
                      <Text style={[styles.faqQuestion, { color: tokens.textPrimary }]}>{item.question}</Text>
                      <Text style={[styles.bodyText, { color: tokens.textSecondary }]}>{item.answer}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {!content ? (
                <Text style={[styles.bodyText, { color: tokens.textSecondary }]}>В статье нет текстового содержимого.</Text>
              ) : null}
              {attachments.length ? (
                <View style={[styles.section, { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft }]}>
                  <Text style={[styles.sectionTitle, { color: tokens.textSecondary }]}>Файлы</Text>
                  {attachments.map((attachment) => {
                    const busy = busyAttachmentKey === attachment.id;
                    return (
                      <Pressable
                        key={attachment.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Скачать ${attachment.fileName}`}
                        disabled={busy}
                        onPress={() => onDownloadAttachment(article.id, attachment)}
                        style={({ pressed }) => [styles.fileRow, { borderColor: tokens.borderSoft }, pressed && styles.pressed]}
                      >
                        <MaterialCommunityIcons name="paperclip" size={18} color={tokens.iconMuted} />
                        <View style={styles.fileBody}>
                          <Text numberOfLines={2} style={[styles.fileName, { color: tokens.textPrimary }]}>{attachment.fileName}</Text>
                          {formatKbFileSize(attachment.size) ? (
                            <Text style={[styles.hint, { color: tokens.textTertiary }]}>{formatKbFileSize(attachment.size)}</Text>
                          ) : null}
                        </View>
                        {busy
                          ? <ActivityIndicator size="small" color={tokens.primary} />
                          : <MaterialCommunityIcons name="download-outline" size={20} color={tokens.primary} />}
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </ScrollView>
          ) : null}
        </View>
      </View>
    </NativeModal>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.82 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.48)' },
  sheet: {
    maxHeight: '92%',
    borderWidth: 1,
    borderBottomWidth: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  loading: { minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: 10 },
  hint: { fontSize: 12, lineHeight: 17 },
  error: { margin: 14, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  body: { paddingHorizontal: 14, paddingBottom: 24, gap: 10 },
  summary: { fontSize: 13, lineHeight: 19 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 7, paddingVertical: 3, fontSize: 11, lineHeight: 15, fontWeight: '800' },
  section: { borderWidth: 1, borderRadius: 16, padding: 13, gap: 6 },
  sectionTitle: { fontSize: 11, lineHeight: 15, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  bodyText: { fontSize: 13, lineHeight: 19 },
  lines: { gap: 5 },
  lineRow: { flexDirection: 'row', gap: 8 },
  lineBullet: { fontSize: 13, lineHeight: 19, fontWeight: '800', width: 18 },
  lineText: { flex: 1, fontSize: 13, lineHeight: 19 },
  command: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6, fontSize: 12, lineHeight: 17, fontFamily: 'monospace' },
  faqItem: { gap: 3, marginTop: 2 },
  faqQuestion: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  fileRow: {
    minHeight: 52,
    borderTopWidth: 1,
    paddingTop: 9,
    marginTop: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  fileBody: { flex: 1, minWidth: 0 },
  fileName: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
});
