import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  getKbArticle,
  getKbCategories,
  listKbArticles,
  type KbArticle,
  type KbAttachment,
  type KbCategory,
} from '../../api/kbApi';
import { formatApiError } from '../../api/formatError';
import { useAuth } from '../../auth/AuthContext';
import { NativeFilterChip } from '../../components/ui/NativeFilterControls';
import { NativeKbArticleSheet } from '../../components/help/NativeKbArticleSheet';
import { openNativeFile, shareNativeFile } from '../../files/nativeAttachmentDownloads';
import { downloadNativeKbAttachment } from '../../help/nativeKbFiles';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { useNativeBottomNavInset } from '../../navigation/useNativeBottomNavInset';
import { formatWarehouse1cDate } from '../../components/warehouse1c/NativeWarehouse1CCards';
import { AccountScreenScaffold, AccountSectionCard } from '../account/AccountChrome';

const OTHER_CATEGORY_ID = '__other__';

type ArticleGroup = { key: string; title: string; data: KbArticle[] };

function normalizeHelpSearch(value: unknown): string {
  return String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .trim();
}

function articleMatchesQuery(article: KbArticle, categoryTitle: string, query: string): boolean {
  if (!query) return true;
  const haystack = normalizeHelpSearch([
    article.title,
    article.summary,
    categoryTitle,
    ...(article.tags || []),
  ].join(' '));
  return query.split(/\s+/).filter(Boolean).every((token) => haystack.includes(token));
}

export function NativeHelpScreen() {
  const { hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const navInset = useNativeBottomNavInset();
  const canRead = hasPermission('kb.read');

  const [categories, setCategories] = useState<KbCategory[]>([]);
  const [articles, setArticles] = useState<KbArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [detailArticle, setDetailArticle] = useState<KbArticle | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [busyAttachmentKey, setBusyAttachmentKey] = useState('');
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const detailSequenceRef = useRef(0);
  const detailAbortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    generationRef.current += 1;
    const requestId = generationRef.current;
    abortRef.current?.abort();
    if (!canRead || offlineMode) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setError('');
    try {
      const [categoriesPayload, articlesPayload] = await Promise.all([
        getKbCategories({ signal: controller.signal }),
        listKbArticles({ status: 'published', limit: 300, signal: controller.signal }),
      ]);
      if (requestId !== generationRef.current || controller.signal.aborted) return;
      setCategories(categoriesPayload);
      setArticles(articlesPayload.items);
    } catch (cause) {
      if (requestId !== generationRef.current || controller.signal.aborted) return;
      const statusCode = Number((cause as { response?: { status?: unknown } } | null)?.response?.status || 0);
      if (statusCode === 401 || statusCode === 403) {
        setDenied(true);
        setArticles([]);
        setCategories([]);
      } else {
        setError(formatApiError(cause, 'Не удалось загрузить базу знаний.'));
      }
    } finally {
      if (requestId === generationRef.current && !controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [canRead, offlineMode]);

  useEffect(() => {
    void load();
    return () => {
      abortRef.current?.abort();
      detailAbortRef.current?.abort();
    };
  }, [load]);

  const groups = useMemo<ArticleGroup[]>(() => {
    const normalizedQuery = normalizeHelpSearch(query);
    const byCategory = new Map<string, ArticleGroup>();
    const ordered: ArticleGroup[] = [];
    categories
      .slice()
      .sort((left, right) => left.order - right.order)
      .forEach((category) => {
        if (!category.id) return;
        const group: ArticleGroup = {
          key: category.id,
          title: category.title || category.id,
          data: [],
        };
        byCategory.set(category.id.toLowerCase(), group);
        ordered.push(group);
      });
    const other: ArticleGroup = { key: OTHER_CATEGORY_ID, title: 'Прочее', data: [] };
    articles.forEach((article) => {
      const group = byCategory.get(article.category.toLowerCase()) || other;
      if (categoryFilter && group.key !== categoryFilter) return;
      if (!articleMatchesQuery(article, group.title, normalizedQuery)) return;
      group.data.push(article);
    });
    const visible = ordered.filter((group) => group.data.length > 0);
    if (other.data.length > 0) visible.push(other);
    return visible;
  }, [articles, categories, categoryFilter, query]);

  const openArticle = useCallback(async (articleId: string) => {
    const id = String(articleId || '').trim();
    if (!id) return;
    detailSequenceRef.current += 1;
    const sequence = detailSequenceRef.current;
    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;
    setDetailArticle(articles.find((item) => item.id === id) || { id, title: '', category: '', articleType: '', status: '', summary: '', tags: [], ownerName: '', departmentName: '', visibilityScope: '', version: 0, updatedAt: '', attachments: [] });
    setDetailError('');
    setBusyAttachmentKey('');
    setDetailLoading(true);
    try {
      const detail = await getKbArticle(id, { signal: controller.signal });
      if (detailSequenceRef.current === sequence && !controller.signal.aborted) setDetailArticle(detail);
    } catch (cause) {
      if (detailSequenceRef.current === sequence && !controller.signal.aborted) {
        setDetailError(formatApiError(cause, 'Не удалось загрузить статью.'));
      }
    } finally {
      if (detailSequenceRef.current === sequence && !controller.signal.aborted) setDetailLoading(false);
    }
  }, [articles]);

  const closeArticle = useCallback(() => {
    detailSequenceRef.current += 1;
    detailAbortRef.current?.abort();
    setDetailArticle(null);
    setDetailError('');
    setDetailLoading(false);
    setBusyAttachmentKey('');
  }, []);

  const downloadAttachment = useCallback(async (articleId: string, attachment: KbAttachment) => {
    if (busyAttachmentKey) return;
    setBusyAttachmentKey(attachment.id);
    try {
      const downloaded = await downloadNativeKbAttachment(articleId, attachment);
      const previewable = /^image\//.test(attachment.contentType) || attachment.contentType === 'application/pdf';
      if (previewable) await openNativeFile(downloaded, attachment.contentType);
      else await shareNativeFile(downloaded, attachment.fileName || 'file.bin', attachment.contentType);
    } catch (cause) {
      setDetailError(formatApiError(cause, 'Не удалось скачать файл статьи.'));
    } finally {
      setBusyAttachmentKey('');
    }
  }, [busyAttachmentKey]);

  if (!canRead) {
    return (
      <AccountScreenScaffold title="Справка" tokens={tokens}>
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Для базы знаний нужно право kb.read.">{null}</AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  return (
    <AccountScreenScaffold title="Справка" tokens={tokens} scroll={false} contentUnderNav>
      <View style={styles.fixedHeader}>
        {offlineMode ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.warning }]}>Требуется сеть: база знаний не сохраняется на устройстве.</Text> : null}
        {error ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.error }]}>{error}</Text> : null}
        {denied ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.error }]}>Нет доступа к базе знаний.</Text> : null}
        <View style={[styles.search, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
          <MaterialCommunityIcons name="magnify" size={21} color={tokens.iconMuted} />
          <TextInput
            testID="native-help-search"
            value={query}
            onChangeText={setQuery}
            editable={!offlineMode}
            placeholder="Поиск по статьям базы знаний"
            placeholderTextColor={tokens.textTertiary}
            accessibilityLabel="Поиск по базе знаний"
            returnKeyType="search"
            style={[styles.searchInput, { color: tokens.textPrimary }]}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Очистить поиск" style={styles.iconButton}>
              <MaterialCommunityIcons name="close" size={20} color={tokens.iconMuted} />
            </Pressable>
          ) : null}
        </View>
        {groups.length > 1 ? (
          <View style={styles.categoryChips}>
            {groups.map((group) => (
              <NativeFilterChip
                key={group.key}
                label={`${group.title} · ${group.data.length}`}
                selected={categoryFilter === group.key}
                tokens={tokens}
                onPress={() => setCategoryFilter((current) => (current === group.key ? '' : group.key))}
                testID={`native-help-category-${group.key}`}
              />
            ))}
          </View>
        ) : null}
        {!loading ? (
          <Text accessibilityLiveRegion="polite" style={[styles.count, { color: tokens.textSecondary }]}>
            Статей: {groups.reduce((total, group) => total + group.data.length, 0)}
          </Text>
        ) : null}
        {loading && articles.length === 0 ? (
          <View style={styles.loading}>
            <ActivityIndicator color={tokens.primary} />
            <Text style={[styles.hint, { color: tokens.textSecondary }]}>Загружаем базу знаний…</Text>
          </View>
        ) : null}
      </View>
      <SectionList
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={7}
        testID="native-help-list"
        sections={groups}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={articles.length ? [styles.list, { paddingBottom: navInset }] : [styles.emptyList, { paddingBottom: navInset }]}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.groupTitle, { color: tokens.textSecondary }]}>{section.title}</Text>
        )}
        ListEmptyComponent={
          !loading && !error && !offlineMode && !denied ? (
            <Text style={[styles.empty, { color: tokens.textSecondary }]}>
              {query || categoryFilter ? 'По запросу ничего не найдено.' : 'В базе знаний пока нет опубликованных статей.'}
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            testID={`native-help-article-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel={`Открыть статью ${item.title}`}
            onPress={() => { void openArticle(item.id); }}
            style={({ pressed }) => [
              styles.card,
              { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft },
              pressed && styles.pressed,
            ]}
          >
            <MaterialCommunityIcons name="book-open-page-variant-outline" size={22} color={tokens.primary} />
            <View style={styles.cardBody}>
              <Text numberOfLines={2} style={[styles.cardTitle, { color: tokens.textPrimary }]}>{item.title}</Text>
              {item.summary && item.summary !== item.title ? (
                <Text numberOfLines={2} style={[styles.cardSummary, { color: tokens.textSecondary }]}>{item.summary}</Text>
              ) : null}
              <Text numberOfLines={1} style={[styles.cardMeta, { color: tokens.textTertiary }]}>
                {[
                  item.updatedAt ? `обновлена ${formatWarehouse1cDate(item.updatedAt)}` : '',
                  item.tags.length ? item.tags.slice(0, 3).map((tag) => `#${tag}`).join(' ') : '',
                  item.attachments.length ? `файлов: ${item.attachments.length}` : '',
                ].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={21} color={tokens.iconMuted} />
          </Pressable>
        )}
        refreshing={refreshing}
        onRefresh={() => { setRefreshing(true); void load(); }}
      />
      <NativeKbArticleSheet
        visible={detailArticle !== null}
        article={detailArticle}
        loading={detailLoading}
        error={detailError}
        busyAttachmentKey={busyAttachmentKey}
        onClose={closeArticle}
        onDownloadAttachment={(articleId, attachment) => { void downloadAttachment(articleId, attachment); }}
        tokens={tokens}
      />
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.82 },
  fixedHeader: { gap: 8, paddingBottom: 10 },
  notice: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  search: { minHeight: 48, borderWidth: 1, borderRadius: 13, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, minHeight: 46, fontSize: 15 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  categoryChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  count: { minHeight: 24, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  loading: { minHeight: 80, alignItems: 'center', justifyContent: 'center', gap: 8 },
  hint: { fontSize: 11, lineHeight: 16 },
  list: { paddingBottom: 8 },
  emptyList: { flexGrow: 1, paddingBottom: 60 },
  empty: { paddingVertical: 26, textAlign: 'center', fontSize: 13, lineHeight: 19 },
  groupTitle: { fontSize: 12, lineHeight: 16, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 6, marginBottom: 7 },
  card: {
    minHeight: 64,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginBottom: 9,
  },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  cardSummary: { marginTop: 2, fontSize: 12, lineHeight: 17 },
  cardMeta: { marginTop: 3, fontSize: 11, lineHeight: 15 },
});
