import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  type ListRenderItemInfo,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { formatApiError } from '../../api/formatError';
import {
  createFeedCategory,
  deleteFeedCategory,
  listFeedCategories,
  listFeedTags,
  listManagedFeedPosts,
  listFeedPosts,
  markFeedPostRead,
  removeFeedReaction,
  setFeedBookmark,
  setFeedReaction,
  updateFeedCategory,
  type FeedCategory,
  type FeedManagedStatus,
  type FeedTag,
} from '../../api/feedApi';
import { useAuth } from '../../auth/AuthContext';
import {
  readNativeCollectionSnapshot,
  writeNativeCollectionSnapshot,
} from '../../cache/nativeSnapshotCache';
import { usePreferences } from '../../preferences/PreferencesContext';
import {
  AccountLoading,
  AccountScreenScaffold,
  AccountSectionCard,
  AccountStatusText,
} from '../account/AccountChrome';
import { useFluentTokens } from '../../theme/fluentTokens';
import { FeedPostCard } from '../../feed/FeedPostCard';
import { NativeAppliedChip, NativeFilterButton } from '../../components/ui/NativeFilterControls';
import { NativeFilterSheet } from '../../components/ui/NativeFilterSheet';
import {
  FEED_FILTERS,
  FEED_PAGE_SIZE,
  FEED_REACTIONS,
  type FeedFilterId,
  type FeedPost,
  type FeedReactionId,
} from '../../feed/feedFormat';

const SEARCH_DEBOUNCE_MS = 300;
const MANAGED_FILTERS: Array<{ id: FeedManagedStatus; label: string }> = [
  { id: 'draft', label: 'Черновики' },
  { id: 'scheduled', label: 'Запланированные' },
  { id: 'published', label: 'Опубликованные' },
  { id: 'archived', label: 'Архив' },
];
type FeedInboxFilterId = FeedFilterId | FeedManagedStatus;

type NativeFeedInboxSnapshot = {
  signature: string;
  items: FeedPost[];
  total: number;
  unreadTotal: number;
};

function isManagedFilter(value: FeedInboxFilterId): value is FeedManagedStatus {
  return MANAGED_FILTERS.some((item) => item.id === value);
}

function filterOfflineFeedPosts(
  items: FeedPost[],
  options: { filter: FeedInboxFilterId; query: string; categoryId: string; tag: string },
) {
  const normalizedQuery = options.query.trim().toLocaleLowerCase('ru-RU');
  return items.filter((post) => {
    if (normalizedQuery && !`${post.title || ''} ${post.preview || ''} ${post.body || ''}`.toLocaleLowerCase('ru-RU').includes(normalizedQuery)) return false;
    if (options.categoryId && post.category_id !== options.categoryId) return false;
    if (options.tag && !(post.tags || []).includes(options.tag)) return false;
    if (options.filter === 'unread' && !post.is_unread) return false;
    if (options.filter === 'important' && post.priority !== 'high') return false;
    if (options.filter === 'saved' && !post.viewer_bookmarked) return false;
    if (isManagedFilter(options.filter) && post.status !== options.filter) return false;
    return true;
  });
}

function useDebouncedValue<T>(value: T, delayMs = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

export function NativeFeedInboxScreen() {
  const { user, hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const allowed = hasPermission('dashboard.read');
  const canPublish = hasPermission('announcements.write');
  const canModerate = hasPermission('announcements.moderate');
  const canManage = canPublish || canModerate;

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FeedInboxFilterId>('all');
  const [categories, setCategories] = useState<FeedCategory[]>([]);
  const [tags, setTags] = useState<FeedTag[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [tag, setTag] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [categoryAdminOpen, setCategoryAdminOpen] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState('');
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [reactionPickerPostId, setReactionPickerPostId] = useState('');
  const [items, setItems] = useState<FeedPost[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const itemsLengthRef = useRef(0);
  const serverOffsetRef = useRef(0);
  const itemsRef = useRef<FeedPost[]>([]);
  const unreadTotalRef = useRef(0);
  const debouncedQuery = useDebouncedValue(query);
  itemsLengthRef.current = items.length;
  itemsRef.current = items;
  unreadTotalRef.current = unreadTotal;

  const loadPage = useCallback(async ({ reset = false }: { reset?: boolean } = {}) => {
    const requestId = ++requestRef.current;
    const offset = reset ? 0 : serverOffsetRef.current;
    if (reset) {
      if (itemsLengthRef.current > 0) setRefreshing(true);
      else setLoading(true);
    } else {
      setLoadingMore(true);
    }
    setError('');
    const userId = Number(user?.id || 0);
    const signature = JSON.stringify({
      filter,
      q: debouncedQuery.trim(),
      categoryId,
      tag,
    });
    let cached = false;
    if (reset && userId) {
      let snapshot = await readNativeCollectionSnapshot<NativeFeedInboxSnapshot>(
        'feed-inbox',
        userId,
        signature,
      );
      if (!snapshot && offlineMode) {
        const defaultSignature = JSON.stringify({ filter: 'all', q: '', categoryId: '', tag: '' });
        snapshot = await readNativeCollectionSnapshot<NativeFeedInboxSnapshot>(
          'feed-inbox',
          userId,
          defaultSignature,
        );
      }
      if (requestId !== requestRef.current) return;
      if (snapshot) {
        const nextItems = snapshot.data.signature === signature
          ? snapshot.data.items
          : filterOfflineFeedPosts(snapshot.data.items, {
            filter,
            query: debouncedQuery,
            categoryId,
            tag,
          });
        cached = true;
        setItems(nextItems);
        serverOffsetRef.current = nextItems.length;
        setTotal(snapshot.data.signature === signature ? snapshot.data.total : nextItems.length);
        setUnreadTotal(snapshot.data.unreadTotal);
        setLoading(false);
      }
    }
    if (offlineMode) {
      if (requestId === requestRef.current) {
        if (!cached && reset) { setItems([]); setTotal(0); setError('Нет подключения и сохранённой ленты.'); }
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
      return;
    }
    try {
      if (isManagedFilter(filter)) {
        const payload = await listManagedFeedPosts(filter, 100, { offset, q: debouncedQuery.trim(), category_id: categoryId, tag });
        if (requestId !== requestRef.current) return;
        const normalizedQuery = debouncedQuery.trim().toLocaleLowerCase('ru-RU');
        const filtered = payload.items.filter((post) => (
          (!normalizedQuery || `${post.title || ''} ${post.preview || ''} ${post.body || ''}`.toLocaleLowerCase('ru-RU').includes(normalizedQuery))
          && (!categoryId || post.category_id === categoryId)
          && (!tag || (post.tags || []).includes(tag))
        ));
        const nextItems = [...new Map((reset ? filtered : [...itemsRef.current, ...filtered]).map((post) => [post.id, post])).values()];
        serverOffsetRef.current = offset + payload.items.length;
        setItems(nextItems);
        setTotal(payload.total);
        if (userId) {
          void writeNativeCollectionSnapshot('feed-inbox', userId, signature, {
            signature,
            items: nextItems,
            total: payload.total,
            unreadTotal: unreadTotalRef.current,
          } satisfies NativeFeedInboxSnapshot);
        }
        return;
      }
      const payload = await listFeedPosts({
        q: debouncedQuery.trim(),
        unread_only: filter === 'unread',
        priority: filter === 'important' ? 'high' : '',
        bookmarked_only: filter === 'saved',
        category_id: categoryId,
        tag,
        limit: FEED_PAGE_SIZE,
        offset,
      });
      if (requestId !== requestRef.current) return;
      const nextItems = [...new Map((reset ? payload.items : [...itemsRef.current, ...payload.items]).map((post) => [post.id, post])).values()];
      serverOffsetRef.current = offset + payload.items.length;
      setItems(nextItems);
      setTotal(payload.total);
      const nextUnreadTotal = filter === 'all' && !debouncedQuery.trim()
        ? Number(payload.unread_total || 0)
        : unreadTotalRef.current;
      if (filter === 'all' && !debouncedQuery.trim()) {
        setUnreadTotal(nextUnreadTotal);
      }
      if (userId) {
        void writeNativeCollectionSnapshot('feed-inbox', userId, signature, {
          signature,
          items: nextItems,
          total: payload.total,
          unreadTotal: nextUnreadTotal,
        } satisfies NativeFeedInboxSnapshot);
      }
    } catch (cause) {
      if (requestId !== requestRef.current) return;
      setError(formatApiError(cause, cached
        ? 'Показана сохранённая лента. Не удалось получить обновления.'
        : 'Не удалось загрузить ленту.'));
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, [categoryId, debouncedQuery, filter, offlineMode, tag, user?.id]);

  useEffect(() => {
    if (allowed) void loadPage({ reset: true });
  }, [allowed, loadPage]);

  useEffect(() => {
    if (!allowed || offlineMode) return;
    let active = true;
    Promise.all([listFeedCategories(canModerate), listFeedTags()])
      .then(([nextCategories, nextTags]) => {
        if (!active) return;
        setCategories(nextCategories);
        setTags(nextTags);
      })
      .catch((cause) => { if (active) setError(formatApiError(cause, 'Не удалось загрузить категории и теги.')); });
    return () => { active = false; };
  }, [allowed, canModerate, offlineMode]);

  const openPost = useCallback((post: FeedPost) => {
    router.push({ pathname: '/(shell)/feed/[postId]', params: { postId: post.id } } as never);
  }, []);

  const patchPost = useCallback((postId: string, patch: Partial<FeedPost>) => {
    setItems((current) => current.map((item) => (
      item.id === postId ? { ...item, ...patch } : item
    )));
  }, []);

  const handleReaction = useCallback(async (post: FeedPost, reactionType: FeedReactionId) => {
    if (offlineMode) return;
    setReactionPickerPostId('');
    try {
      if (post.viewer_reaction === reactionType) {
        await removeFeedReaction(post.id);
        const counts = { ...(post.reaction_counts || {}) };
        counts[reactionType] = Math.max(0, Number(counts[reactionType] || 1) - 1);
        patchPost(post.id, { viewer_reaction: null, reaction_counts: counts });
      } else {
        await setFeedReaction(post.id, reactionType);
        const counts = { ...(post.reaction_counts || {}) };
        if (post.viewer_reaction) {
          const prev = String(post.viewer_reaction);
          counts[prev] = Math.max(0, Number(counts[prev] || 1) - 1);
        }
        counts[reactionType] = Number(counts[reactionType] || 0) + 1;
        patchPost(post.id, { viewer_reaction: reactionType, reaction_counts: counts, is_unread: false });
        void markFeedPostRead(post.id).catch(() => undefined);
      }
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось обновить реакцию.'));
    }
  }, [offlineMode, patchPost]);

  const saveCategory = useCallback(async () => {
    const name = categoryName.trim();
    if (name.length < 2 || categoryBusy || offlineMode) return;
    setCategoryBusy(true);
    setError('');
    try {
      if (editingCategoryId) {
        const current = categories.find((item) => item.id === editingCategoryId);
        const updated = await updateFeedCategory(editingCategoryId, { name, is_active: current?.is_active !== false });
        setCategories((items) => items.map((item) => item.id === editingCategoryId ? { ...item, ...updated } : item));
      } else {
        const created = await createFeedCategory(name);
        setCategories((items) => [...items, created].sort((left, right) => left.name.localeCompare(right.name, 'ru')));
      }
      setCategoryName('');
      setEditingCategoryId('');
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось сохранить категорию.'));
    } finally {
      setCategoryBusy(false);
    }
  }, [categories, categoryBusy, categoryName, editingCategoryId, offlineMode]);

  const deactivateCategory = useCallback((category: FeedCategory) => {
    if (categoryBusy || offlineMode) return;
    Alert.alert('Скрыть категорию?', category.name, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Скрыть', style: 'destructive', onPress: () => {
        setCategoryBusy(true);
        void deleteFeedCategory(category.id)
          .then(() => setCategories((items) => items.map((item) => item.id === category.id ? { ...item, is_active: false } : item)))
          .catch((cause) => setError(formatApiError(cause, 'Не удалось скрыть категорию.')))
          .finally(() => setCategoryBusy(false));
      } },
    ]);
  }, [categoryBusy, offlineMode]);

  const activateCategory = useCallback(async (category: FeedCategory) => {
    if (categoryBusy || offlineMode) return;
    setCategoryBusy(true);
    setError('');
    try {
      const updated = await updateFeedCategory(category.id, { name: category.name, is_active: true });
      setCategories((items) => items.map((item) => item.id === category.id ? { ...item, ...updated, is_active: true } : item));
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось восстановить категорию.'));
    } finally {
      setCategoryBusy(false);
    }
  }, [categoryBusy, offlineMode]);

  const handleBookmark = useCallback(async (post: FeedPost) => {
    if (offlineMode) return;
    const next = !post.viewer_bookmarked;
    try {
      await setFeedBookmark(post.id, next);
      patchPost(post.id, { viewer_bookmarked: next });
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось сохранить публикацию.'));
    }
  }, [offlineMode, patchPost]);

  const toggleReactionPicker = useCallback((post: FeedPost) => {
    setReactionPickerPostId((current) => current === post.id ? '' : post.id);
  }, []);

  const renderFeedPost = useCallback(({ item }: ListRenderItemInfo<FeedPost>) => (
    <View style={styles.postWithReactionPicker}>
      <FeedPostCard
        post={item}
        tokens={tokens}
        onOpen={openPost}
        onComments={openPost}
        onToggleReaction={offlineMode ? undefined : toggleReactionPicker}
        onBookmark={offlineMode ? undefined : handleBookmark}
      />
      {reactionPickerPostId === item.id ? (
        <View style={[styles.reactionPicker, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
          {FEED_REACTIONS.map((reaction) => (
            <Pressable key={reaction.id} testID={`feed-card-reaction-${item.id}-${reaction.id}`} accessibilityRole="button" accessibilityLabel={reaction.label} onPress={() => { void handleReaction(item, reaction.id); }} style={styles.reactionItem}><Text style={styles.reactionEmoji}>{reaction.emoji}</Text></Pressable>
          ))}
        </View>
      ) : null}
    </View>
  ), [handleBookmark, handleReaction, offlineMode, openPost, reactionPickerPostId, toggleReactionPicker, tokens]);

  if (!allowed) {
    return (
      <AccountScreenScaffold title="Лента" tokens={tokens}>
        <AccountSectionCard
          tokens={tokens}
          title="Нет доступа"
          description="Раздел доступен сотрудникам с правом чтения главной / ленты."
        >
          {null}
        </AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  return (
    <AccountScreenScaffold
      title="Лента"
      tokens={tokens}
      scroll={false}
      rightAction={canPublish && !offlineMode ? (
        <Pressable
          testID="feed-create"
          onPress={() => router.push('/(shell)/feed/editor' as never)}
          accessibilityRole="button"
          accessibilityLabel="Создать публикацию"
          style={styles.headerAction}
        >
          <MaterialCommunityIcons name="plus" size={22} color={tokens.primary} />
        </Pressable>
      ) : undefined}
    >
      <Text style={[styles.subtitle, { color: tokens.textSecondary }]}>
        {unreadTotal > 0 ? `Непрочитанных: ${unreadTotal}` : `Публикаций: ${total}`}
      </Text>

      <View style={[styles.searchBox, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
        <MaterialCommunityIcons name="magnify" size={20} color={tokens.iconMuted} />
        <TextInput
          testID="feed-search-input"
          value={query}
          onChangeText={setQuery}
          placeholder="Поиск по ленте"
          placeholderTextColor={tokens.textTertiary}
          style={[styles.search, { color: tokens.textPrimary }]}
          returnKeyType="search"
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Очистить поиск">
            <MaterialCommunityIcons name="close" size={18} color={tokens.iconMuted} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.filters}>
        <NativeFilterButton
          testID="feed-taxonomy-toggle"
          count={[filter !== 'all', Boolean(categoryId), Boolean(tag)].filter(Boolean).length}
          tokens={tokens}
          onPress={() => setFiltersOpen(true)}
        />
        {filter !== 'all' ? (
          <NativeAppliedChip
            label={[...FEED_FILTERS, ...MANAGED_FILTERS].find((item) => item.id === filter)?.label || filter}
            tokens={tokens}
            onRemove={() => setFilter('all')}
          />
        ) : null}
        {categoryId ? (
          <NativeAppliedChip
            label={categories.find((item) => item.id === categoryId)?.name || 'Категория'}
            tokens={tokens}
            onRemove={() => setCategoryId('')}
          />
        ) : null}
        {tag ? <NativeAppliedChip label={`#${tag}`} tokens={tokens} onRemove={() => setTag('')} /> : null}
      </View>

      <NativeFilterSheet
        visible={filtersOpen}
        title="Фильтры ленты"
        subtitle="Публикации, категории и теги"
        tokens={tokens}
        onClose={() => setFiltersOpen(false)}
        onReset={() => { setFilter('all'); setCategoryId(''); setTag(''); }}
        sections={[
          {
            kind: 'options' as const,
            key: 'filter',
            title: 'Показать',
            selected: filter,
            onSelect: (value) => setFilter(value as FeedInboxFilterId),
            testIDPrefix: 'feed-filter',
            options: [...FEED_FILTERS, ...(canManage ? MANAGED_FILTERS : [])].map((item) => ({ value: item.id, label: item.label })),
          },
          {
            kind: 'options' as const,
            key: 'category',
            title: 'Категория',
            selected: categoryId,
            onSelect: setCategoryId,
            testIDPrefix: 'feed-category',
            options: [{ value: '', label: 'Все' }, ...categories.filter((item) => item.is_active !== false).map((item) => ({ value: item.id, label: item.name }))],
          },
          ...(tags.length ? [{
            kind: 'options' as const,
            key: 'tag',
            title: 'Тег',
            selected: tag,
            onSelect: setTag,
            testIDPrefix: 'feed-tag',
            options: [{ value: '', label: 'Все' }, ...tags.slice(0, 20).map((item) => ({ value: item.name, label: `#${item.name}` }))],
          }] : []),
          ...(canModerate ? [{
            kind: 'custom' as const,
            key: 'category-admin',
            title: 'Управление категориями',
            children: (
              <View>
                <Pressable testID="feed-category-admin-toggle" accessibilityRole="button" accessibilityState={{ expanded: categoryAdminOpen }} onPress={() => setCategoryAdminOpen((value) => !value)} style={[styles.adminToggle, { borderColor: tokens.borderSoft }]}><MaterialCommunityIcons name="shape-outline" size={19} color={tokens.primary} /><Text style={{ color: tokens.primary, fontWeight: '800' }}>Изменить список категорий</Text></Pressable>
                {categoryAdminOpen ? (
                  <View style={styles.categoryAdmin}>
                    <View style={styles.categoryForm}>
                      <TextInput testID="feed-category-name" value={categoryName} onChangeText={setCategoryName} placeholder="Название категории" placeholderTextColor={tokens.textTertiary} style={[styles.categoryInput, { color: tokens.textPrimary, borderColor: tokens.border }]} />
                      <Pressable testID="feed-category-save" accessibilityRole="button" accessibilityState={{ disabled: categoryName.trim().length < 2 || categoryBusy || offlineMode }} disabled={categoryName.trim().length < 2 || categoryBusy || offlineMode} onPress={() => { void saveCategory(); }} style={[styles.categorySave, { backgroundColor: tokens.primary }]}><MaterialCommunityIcons name="check" size={20} color="#fff" /></Pressable>
                    </View>
                    {categories.map((category) => (
                      <View key={category.id} style={[styles.categoryRow, { borderBottomColor: tokens.borderSoft, opacity: category.is_active === false ? 0.55 : 1 }]}>
                        <Text numberOfLines={1} style={{ color: tokens.textPrimary, fontWeight: '700', flex: 1 }}>{category.name}{category.is_active === false ? ' · скрыта' : ''}</Text>
                        <Pressable accessibilityRole="button" accessibilityLabel={`Переименовать категорию ${category.name}`} onPress={() => { setEditingCategoryId(category.id); setCategoryName(category.name); }} style={styles.iconButton}><MaterialCommunityIcons name="pencil-outline" size={19} color={tokens.primary} /></Pressable>
                        {category.is_active !== false ? (
                          <Pressable accessibilityRole="button" accessibilityLabel={`Скрыть категорию ${category.name}`} onPress={() => deactivateCategory(category)} style={styles.iconButton}><MaterialCommunityIcons name="eye-off-outline" size={19} color={tokens.error} /></Pressable>
                        ) : (
                          <Pressable accessibilityRole="button" accessibilityLabel={`Восстановить категорию ${category.name}`} onPress={() => { void activateCategory(category); }} style={styles.iconButton}><MaterialCommunityIcons name="eye-outline" size={19} color={tokens.primary} /></Pressable>
                        )}
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ),
          }] : []),
        ]}
      />

      <AccountStatusText tokens={tokens} error={error} />

      {loading && items.length === 0 ? (
        <AccountLoading tokens={tokens} />
      ) : (
        <FlatList
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
          style={styles.list}
          testID="feed-post-list"
          data={items}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          refreshing={refreshing}
          onRefresh={() => { void loadPage({ reset: true }); }}
          onEndReached={() => {
            if (!offlineMode && !loadingMore && !refreshing && !loading && serverOffsetRef.current < total) void loadPage({ reset: false });
          }}
          onEndReachedThreshold={0.4}
          contentContainerStyle={items.length === 0 ? styles.emptyList : styles.listContent}
          ListEmptyComponent={(
            <Text style={[styles.empty, { color: tokens.textSecondary }]}>
              {query.trim() || filter !== 'all'
                ? 'По заданным условиям публикаций нет.'
                : 'В ленте пока нет публикаций.'}
            </Text>
          )}
          ListFooterComponent={loadingMore ? (
            <ActivityIndicator color={tokens.primary} style={{ marginVertical: 12 }} />
          ) : null}
          renderItem={renderFeedPost}
        />
      )}
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  headerAction: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtitle: { fontSize: 13, fontWeight: '700', marginBottom: 10 },
  searchBox: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  search: { flex: 1, minHeight: 40, fontSize: 15 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },

  adminToggle: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  categoryAdmin: { gap: 6 },
  categoryForm: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  categoryInput: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 15 },
  categorySave: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  categoryRow: { minHeight: 48, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  postWithReactionPicker: { gap: 6 },
  reactionPicker: { minHeight: 52, borderWidth: 1, borderRadius: 12, padding: 6, flexDirection: 'row', justifyContent: 'space-around' },
  reactionItem: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  reactionEmoji: { fontSize: 22 },
  list: { flex: 1 },
  listContent: { gap: 10, paddingBottom: 8 },
  emptyList: { flexGrow: 1, justifyContent: 'center', paddingVertical: 32 },
  empty: { textAlign: 'center', fontSize: 14 },
});
