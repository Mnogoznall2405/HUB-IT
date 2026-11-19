import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  listDocflowAbsences,
  type DocflowAbsencesResult,
} from '../../api/docflowApi';
import { useAuth } from '../../auth/AuthContext';
import {
  readNativeCollectionSnapshot,
  writeNativeCollectionSnapshot,
} from '../../cache/nativeSnapshotCache';
import { resolveNativeDocflowError } from '../../docflow/docflowError';
import { NATIVE_DOCFLOW_ENABLED } from '../../docflow/nativeDocflowFeature';
import { openPortalPath } from '../../navigation/moduleRegistry';
import { AccountSectionCard } from '../../screens/account/AccountChrome';
import type { FluentTokens } from '../../theme/fluentTokens';

type AbsencesViewState = {
  loading?: boolean;
  data?: DocflowAbsencesResult;
  cached?: boolean;
  stale?: boolean;
  error?: 'credentials' | 'unavailable' | 'offline';
};

// Mirrors WEB DocflowAbsencesPanel: the whole section hides without
// docflow.read + address_book.read and when the server answers
// status=disabled (DOCFLOW_ABSENCES_ENABLED off).
export function NativeDocflowAbsencesSection({
  tokens,
  employeeCode = '',
  employee = false,
}: {
  tokens: FluentTokens;
  employeeCode?: string;
  employee?: boolean;
}) {
  const { user, hasPermission, offlineMode } = useAuth();
  const allowed = NATIVE_DOCFLOW_ENABLED
    && Boolean(user?.id)
    && hasPermission('docflow.read')
    && hasPermission('address_book.read');
  const scopedCode = employee ? String(employeeCode || '').trim() : '';
  const enabled = allowed && (!employee || Boolean(scopedCode));
  const signature = JSON.stringify({ employee_code: scopedCode });
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<AbsencesViewState | null>(null);
  const requestRef = useRef(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return undefined;
    const userId = Number(user?.id || 0);
    const requestId = ++requestRef.current;
    const controller = new AbortController();
    let active = true;
    let cachedResult: DocflowAbsencesResult | null = null;
    setView({ loading: true });
    void (async () => {
      if (userId) {
        const snapshot = await readNativeCollectionSnapshot<DocflowAbsencesResult>(
          'docflow-absences',
          userId,
          signature,
        );
        if (!active || requestId !== requestRef.current) return;
        if (snapshot) {
          cachedResult = snapshot.data;
          setView({ loading: true, data: snapshot.data, cached: true });
        }
      }
      if (offlineMode) {
        setView(cachedResult
          ? { data: cachedResult, cached: true, stale: true }
          : { error: 'offline' });
        return;
      }
      try {
        const result = await listDocflowAbsences({ employeeCode: scopedCode, signal: controller.signal });
        if (!active || requestId !== requestRef.current || controller.signal.aborted) return;
        setView({ data: result });
        if (userId && result.status !== 'disabled') {
          void writeNativeCollectionSnapshot('docflow-absences', userId, signature, result);
        }
      } catch (cause) {
        if (!active || requestId !== requestRef.current || controller.signal.aborted) return;
        const resolved = resolveNativeDocflowError(cause, 'Отсутствия Документооборота недоступны.');
        const reason = resolved.code === 'DOCFLOW_CREDENTIALS_REQUIRED' ? 'credentials' : 'unavailable';
        setView(cachedResult
          ? { data: cachedResult, cached: true, stale: true }
          : { error: reason });
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt, enabled, offlineMode, scopedCode, signature, user?.id]);

  if (!enabled || !view) return null;
  if (view.data?.status === 'disabled') return null;
  const items = view.data?.items || [];
  const showList = Boolean(view.data) && view.data?.status === 'available';
  const asOfTime = view.data?.as_of ? formatAsOfTime(view.data.as_of) : '';

  return (
    <View testID="docflow-absences" style={styles.root}>
      <AccountSectionCard tokens={tokens} title="Документооборот · отсутствия" collapsible>
        {view.loading && !view.data ? (
          <View accessibilityLiveRegion="polite" style={styles.loadingRow}>
            <ActivityIndicator size="small" color={tokens.primary} />
            <Text style={[styles.caption, { color: tokens.textSecondary }]}>Загружаем отсутствия…</Text>
          </View>
        ) : view.error ? (
          <View style={styles.noticeBlock}>
            {view.error === 'credentials' ? (
              <Pressable
                testID="docflow-absences-connect"
                onPress={() => openPortalPath('/docflow')}
                accessibilityRole="button"
                accessibilityLabel="Подключить учётную запись 1С в разделе Документооборот"
                style={styles.connectButton}
              >
                <Text style={[styles.notice, { color: tokens.primary }]}>
                  Подключите свою учётную запись 1С в разделе «Документооборот».
                </Text>
              </Pressable>
            ) : (
              <>
                <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.textSecondary }]}>
                  {view.error === 'offline'
                    ? 'Нет подключения и сохранённых отсутствий.'
                    : 'Отсутствия Документооборота недоступны.'}
                </Text>
                {view.error === 'unavailable' ? (
                  <Pressable
                    testID="docflow-absences-retry"
                    onPress={retry}
                    accessibilityRole="button"
                    accessibilityLabel="Повторить загрузку отсутствий"
                    style={[styles.retryButton, { borderColor: tokens.borderSoft, backgroundColor: tokens.panelMuted }]}
                  >
                    <Text style={[styles.retryLabel, { color: tokens.primary }]}>Повторить</Text>
                  </Pressable>
                ) : null}
              </>
            )}
          </View>
        ) : !showList ? (
          <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.textSecondary }]}>
            Не удалось подтвердить состояние списка отсутствий.
          </Text>
        ) : (
          <View style={styles.list}>
            {view.stale ? (
              <Text accessibilityRole="alert" style={[styles.caption, { color: tokens.warning }]}>
                Не удалось обновить. Показаны сохранённые отсутствия.
              </Text>
            ) : null}
            {!items.length ? (
              <Text style={[styles.itemText, { color: tokens.textSecondary }]}>
                {employee ? 'Связанных записей об отсутствии нет.' : 'На сегодня записей об отсутствии нет.'}
              </Text>
            ) : null}
            {items.map((item) => (
              <View key={item.id} style={[styles.item, { borderLeftColor: tokens.borderSoft }]}>
                {!employee ? (
                  <Text style={[styles.itemName, { color: tokens.textPrimary }]}>{item.display_name}</Text>
                ) : null}
                <Text style={[styles.itemText, { color: tokens.textPrimary }]}>
                  {item.label} · {formatAbsenceDate(item.starts_on)} — {formatAbsenceDate(item.ends_on)} включительно
                </Text>
                {item.comment ? (
                  <Text style={[styles.itemText, { color: tokens.textPrimary }]}>{item.comment}</Text>
                ) : null}
                <Text style={[styles.caption, { color: tokens.textSecondary }]}>
                  {item.will_handle_tasks ? 'Будет разбирать задачи' : 'Не будет разбирать задачи'}
                </Text>
                {item.differences.length ? (
                  <View style={[styles.chip, { borderColor: tokens.warning }]}>
                    <Text style={[styles.chipText, { color: tokens.warning }]}>Данные отличаются от ЗУП</Text>
                  </View>
                ) : null}
                {!employee && item.matching_status === 'unresolved' ? (
                  <Text style={[styles.caption, { color: tokens.textSecondary }]}>
                    Связь с адресной книгой не подтверждена
                  </Text>
                ) : null}
              </View>
            ))}
            {view.data?.zup_comparison === 'unavailable' ? (
              <Text style={[styles.caption, { color: tokens.textSecondary }]}>
                Сравнение с ЗУП недоступно: актуальность данных не подтверждена.
              </Text>
            ) : null}
            {employee && (view.data?.unresolved_count || 0) > 0 ? (
              <Text style={[styles.caption, { color: tokens.textSecondary }]}>
                Часть записей Документооборота не сопоставлена с адресной книгой.
              </Text>
            ) : null}
            <View style={styles.footer}>
              <Text style={[styles.caption, styles.footerText, { color: tokens.textSecondary }]}>
                Источник: 1С:Документооборот · {view.data?.count ?? items.length} записей{asOfTime ? ` · получено ${asOfTime}` : ''}
              </Text>
              <Pressable
                testID="docflow-absences-refresh"
                onPress={retry}
                disabled={offlineMode || view.loading}
                accessibilityRole="button"
                accessibilityLabel="Обновить отсутствия"
                accessibilityState={{ disabled: offlineMode || Boolean(view.loading) }}
                style={styles.retryButton}
              >
                <Text style={[styles.retryLabel, { color: offlineMode ? tokens.textTertiary : tokens.primary }]}>
                  Обновить отсутствия
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      </AccountSectionCard>
    </View>
  );
}

function formatAbsenceDate(value: string): string {
  const parts = String(value || '').split('-');
  return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : 'дата не указана';
}

function formatAsOfTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleTimeString('ru-RU');
}

const styles = StyleSheet.create({
  root: { marginTop: 8 },
  loadingRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  noticeBlock: { gap: 8 },
  notice: { fontSize: 13, lineHeight: 18 },
  connectButton: { minHeight: 44, justifyContent: 'center' },
  retryButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  retryLabel: { fontSize: 13, fontWeight: '700' },
  list: { gap: 8 },
  item: { borderLeftWidth: 2, paddingLeft: 8, gap: 2 },
  itemName: { fontSize: 14, fontWeight: '700' },
  itemText: { fontSize: 14, lineHeight: 19 },
  caption: { fontSize: 12, lineHeight: 16 },
  chip: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 2,
  },
  chipText: { fontSize: 11, fontWeight: '800' },
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  footerText: { flex: 1, minWidth: 0 },
});
