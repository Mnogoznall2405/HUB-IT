import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  addPcCleaningRecord,
  getPcCleaningRemaining,
  type PcCleaningBranchStat,
  type PcCleaningRemainingPc,
} from '../../api/statisticsApi';
import { formatApiError } from '../../api/formatError';
import {
  buildPcCleaningPayload,
  filterRemainingPcs,
  formatLastCleanedAt,
  isSameRemainingPc,
  remainingPcKey,
} from '../../statistics/nativeStatisticsModel';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { AccountSubpage } from '../account/AccountChrome';
import { useAuth } from '../../auth/AuthContext';

export function NativePcRemainingSheet({
  visible,
  branchRow,
  periodDays,
  databaseId,
  canWrite,
  onClose,
  onCleaningSaved,
}: {
  visible: boolean;
  branchRow: PcCleaningBranchStat | null;
  periodDays: number;
  databaseId?: string;
  canWrite: boolean;
  onClose: () => void;
  onCleaningSaved: () => void;
}) {
  const { offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<PcCleaningRemainingPc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [remainingCount, setRemainingCount] = useState<number | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [confirmRow, setConfirmRow] = useState<PcCleaningRemainingPc | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const itemsRef = useRef<PcCleaningRemainingPc[]>([]);
  const generation = useRef(0);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; abortRef.current?.abort(); }; }, []);

  const branchName = String(branchRow?.branch || '').trim() || 'Филиал';

  const reload = useCallback(async () => {
    if (!visible || !branchRow?.branch || offlineMode) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const data = await getPcCleaningRemaining({
        periodDays,
        branch: branchRow.branch,
        databaseId,
        signal: controller.signal,
      });
      if (!mountedRef.current || controller.signal.aborted) return;
      setItems(data.remaining_pcs);
      itemsRef.current = data.remaining_pcs;
      setRemainingCount(data.remaining_pc);
      setTotalCount(data.total_pc);
    } catch (requestError) {
      if (!mountedRef.current || controller.signal.aborted) return;
      if (!itemsRef.current.length) setError(formatApiError(requestError, 'Не удалось загрузить список непочищенных ПК'));
    } finally {
      if (mountedRef.current && !controller.signal.aborted) setLoading(false);
    }
  }, [visible, branchRow?.branch, periodDays, databaseId, offlineMode]);

  useEffect(() => {
    generation.current += 1;
    abortRef.current?.abort();
    setLoading(false);
    setSubmitting(false);
    if (!visible) { setItems([]); setConfirmRow(null); return; }
    setQuery('');
    setError('');
    setConfirmRow(null);
    const seeded = Array.isArray(branchRow?.remaining_pcs) ? branchRow.remaining_pcs : [];
    setItems(seeded);
    itemsRef.current = seeded;
    setRemainingCount(null);
    setTotalCount(null);
    void reload();
    return () => { generation.current += 1; abortRef.current?.abort(); };
  }, [visible, branchRow, reload]);

  const filtered = useMemo(() => filterRemainingPcs(items, query), [items, query]);

  const displayedRemaining = remainingCount ?? branchRow?.remaining_pc ?? items.length;
  const displayedTotal = totalCount ?? branchRow?.total_pc ?? displayedRemaining;

  const emptyMessage = (() => {
    if (loading) return 'Загрузка списка ПК…';
    if (error) return error;
    if (!items.length && displayedRemaining > 0) {
      return 'Список ПК не пришёл с сервера, хотя по покрытию ещё есть непочищенные.';
    }
    if (!items.length) return 'За выбранный период все ПК этого филиала почищены';
    return 'Нет ПК по выбранному фильтру';
  })();

  const confirmCleaning = useCallback(async () => {
    if (!confirmRow || submitting || offlineMode || !visible || !canWrite) return;
    const lease = generation.current;
    const built = buildPcCleaningPayload(confirmRow, { branch: branchName, databaseId });
    if (built.error || !built.payload) {
      setError(built.error || 'Некорректная запись чистки');
      setConfirmRow(null);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await addPcCleaningRecord(built.payload);
      if (!mountedRef.current || lease !== generation.current) return;
      setItems((current) => {
        const next = current.filter((item) => !isSameRemainingPc(item, confirmRow));
        itemsRef.current = next;
        return next;
      });
      setRemainingCount((current) => Math.max(0, (current ?? displayedRemaining) - 1));
      setConfirmRow(null);
      onCleaningSaved();
    } catch (requestError) {
      if (!mountedRef.current || lease !== generation.current) return;
      const message = formatApiError(requestError, 'Не удалось поставить чистку');
      setError(message);
      Alert.alert('Не удалось поставить чистку', message);
    } finally {
      if (mountedRef.current && lease === generation.current) setSubmitting(false);
    }
  }, [confirmRow, submitting, branchName, databaseId, displayedRemaining, onCleaningSaved, offlineMode, visible, canWrite]);

  const confirmLabel = confirmRow
    ? (confirmRow.inv_no || confirmRow.serial_no || 'этот ПК')
    : '';

  return (
    <>
      <AccountSubpage
        visible={visible}
        scroll={false}
        title={`Не почищены: ${branchName}`}
        tokens={tokens}
        onClose={onClose}
      >
        <FlatList data={filtered} keyExtractor={remainingPcKey} initialNumToRender={12} maxToRenderPerBatch={10} windowSize={7}
          keyboardShouldPersistTaps="handled" ListHeaderComponent={<>
        <Text style={[styles.caption, { color: tokens.textSecondary }]}>
          {displayedRemaining} из {displayedTotal || displayedRemaining} ПК без чистки за выбранный период
        </Text>
        {error ? <Text accessibilityRole="alert" style={[styles.errorText, { color: tokens.error }]}>{error}</Text> : null}
        <View style={[styles.search, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}>
          <MaterialCommunityIcons name="magnify" size={20} color={tokens.iconMuted} />
          <TextInput
            testID="native-remaining-search"
            value={query}
            onChangeText={(value) => setQuery(value.slice(0, 200))}
            placeholder="Инв. №, серийник, локация, сотрудник"
            placeholderTextColor={tokens.textTertiary}
            accessibilityLabel="Поиск ПК без чистки"
            style={[styles.searchInput, { color: tokens.textPrimary }]}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Очистить поиск" style={styles.iconButton}>
              <MaterialCommunityIcons name="close" size={18} color={tokens.iconMuted} />
            </Pressable>
          ) : null}
        </View>

        {loading && !items.length ? <ActivityIndicator style={styles.loader} color={tokens.primary} /> : null}
        {loading && items.length ? <ActivityIndicator size="small" color={tokens.primary} /> : null}

        </>} ListEmptyComponent={!loading ? <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>{emptyMessage}</Text> : null}
          renderItem={({ item, index }) => {
          const serial = String(item.serial_no || item.hw_serial_no || '').trim();
          const canClean = Boolean(serial);
          return (
            <View
              key={remainingPcKey(item, index)}
              style={[styles.row, { borderColor: tokens.borderSoft }]}
              testID={`native-remaining-row-${index}`}
            >
              <View style={styles.rowBody}>
                <Text style={[styles.rowTitle, { color: tokens.textPrimary }]}>
                  {item.inv_no || '—'} · {serial || '—'}
                </Text>
                <Text style={[styles.rowMeta, { color: tokens.textSecondary }]}>
                  {[item.model_name, item.location, item.employee].filter(Boolean).join(' · ') || '—'}
                </Text>
                <Text style={[styles.rowMeta, {
                  color: item.last_cleaned_at ? tokens.warning : tokens.error,
                }]}>
                  {formatLastCleanedAt(item.last_cleaned_at)}
                </Text>
              </View>
              {canWrite ? (
                <Pressable
                  onPress={() => setConfirmRow(item)}
                  disabled={submitting || !canClean || offlineMode}
                  accessibilityRole="button"
                  accessibilityLabel={`Поставить чистку ${item.inv_no || serial}`}
                  testID={`native-remaining-clean-${index}`}
                  style={[styles.cleanButton, { borderColor: tokens.primary, opacity: canClean && !submitting ? 1 : 0.4 }]}
                >
                  <MaterialCommunityIcons name="broom" size={16} color={tokens.primary} />
                  <Text style={[styles.cleanButtonText, { color: tokens.primary }]}>Чистка</Text>
                </Pressable>
              ) : null}
            </View>
          );
        }} />
      </AccountSubpage>

      {confirmRow ? (
        <AccountSubpage
          visible
          title="Поставить чистку?"
          tokens={tokens}
          onClose={() => { if (!submitting) setConfirmRow(null); }}
          footer={(
            <View style={styles.confirmActions}>
              <Pressable
                onPress={() => setConfirmRow(null)}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel="Отмена"
                style={[styles.secondaryButton, { borderColor: tokens.border }]}
              >
                <Text style={[styles.secondaryButtonText, { color: tokens.textPrimary }]}>Отмена</Text>
              </Pressable>
              <Pressable
                onPress={() => void confirmCleaning()}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel="Подтвердить чистку"
                testID="native-remaining-confirm"
                style={[styles.primaryButton, { backgroundColor: tokens.primary, opacity: submitting ? 0.6 : 1 }]}
              >
                {submitting ? <ActivityIndicator size="small" color="#fff" /> : (
                  <Text style={styles.primaryButtonText}>Поставить</Text>
                )}
              </Pressable>
            </View>
          )}
        >
          <Text style={[styles.confirmText, { color: tokens.textPrimary }]}>
            Зарегистрировать чистку ПК {confirmLabel}
            {confirmRow.model_name ? ` (${confirmRow.model_name})` : ''}?
          </Text>
        </AccountSubpage>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  caption: { fontSize: 13, marginBottom: 8 },
  errorText: { fontSize: 13, marginBottom: 8 },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 8 },
  iconButton: { padding: 4 },
  loader: { marginVertical: 20 },
  emptyText: { fontSize: 14, textAlign: 'center', paddingVertical: 20 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 14, fontWeight: '600' },
  rowMeta: { fontSize: 12 },
  cleanButton: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7,
  },
  cleanButtonText: { fontSize: 13, fontWeight: '600' },
  confirmText: { fontSize: 15, lineHeight: 22 },
  confirmActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  secondaryButton: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  secondaryButtonText: { fontSize: 15, fontWeight: '600' },
  primaryButton: { borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10, minWidth: 110, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
