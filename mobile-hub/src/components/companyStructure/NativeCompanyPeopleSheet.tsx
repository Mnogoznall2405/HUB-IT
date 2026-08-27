import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { memo } from 'react';
import { ActivityIndicator, Modal, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { CompanyStructurePerson } from '../../api/companyStructureApi';
import { companyPersonKey, groupCompanyPeople } from '../../companyStructure/nativeCompanyStructureModel';
import type { FluentTokens } from '../../theme/fluentTokens';
import { NativeCompanyPersonCard } from './NativeCompanyPersonCard';

export const NativeCompanyPeopleSheet = memo(function NativeCompanyPeopleSheet({
  visible,
  title,
  people,
  total,
  loading,
  error,
  focusedName,
  tokens,
  onClose,
  onRetry,
  onCall,
  onEmail,
}: {
  visible: boolean;
  title: string;
  people: CompanyStructurePerson[];
  total: number;
  loading: boolean;
  error: string;
  focusedName?: string;
  tokens: FluentTokens;
  onClose: () => void;
  onRetry: () => void;
  onCall: (phone: string) => void;
  onEmail: (email: string) => void;
}) {
  const sections = groupCompanyPeople(people).map((section) => ({
    title: section.title,
    key: section.key,
    data: section.items,
  }));
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={[styles.safe, { backgroundColor: tokens.pageBg }]}>
        <View style={[styles.header, { backgroundColor: tokens.headerBandBg, borderBottomColor: tokens.borderSoft }]}>
          <View style={styles.titleBody}>
            <Text numberOfLines={1} style={[styles.title, { color: tokens.textPrimary }]}>{title || 'Сотрудники'}</Text>
            <Text style={[styles.subtitle, { color: tokens.textSecondary }]}>
              {loading ? 'Загрузка…' : total > people.length ? `Показано ${people.length} из ${total}` : `${people.length} человек`}
            </Text>
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Закрыть список сотрудников" style={styles.close}>
            <MaterialCommunityIcons name="close" size={24} color={tokens.textPrimary} />
          </Pressable>
        </View>
        {error ? (
          <View style={styles.errorBody}>
            <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text>
            <Pressable onPress={onRetry} accessibilityRole="button" style={[styles.retry, { borderColor: tokens.primary }]}>
              <Text style={{ color: tokens.primary, fontWeight: '800' }}>Повторить</Text>
            </Pressable>
          </View>
        ) : null}
        {loading && !people.length ? (
          <View style={styles.loading}><ActivityIndicator color={tokens.primary} /></View>
        ) : (
          <SectionList
            testID="native-company-people-list"
            sections={sections}
            keyExtractor={companyPersonKey}
            contentContainerStyle={people.length ? styles.list : styles.empty}
            renderSectionHeader={({ section }) => (
              <View style={[styles.sectionHeader, { backgroundColor: tokens.pageBg }]}>
                <Text style={[styles.sectionTitle, { color: tokens.textPrimary }]}>{section.title}</Text>
                <Text style={[styles.sectionCount, { color: tokens.textSecondary }]}>{section.data.length}</Text>
              </View>
            )}
            ListEmptyComponent={<Text style={[styles.emptyText, { color: tokens.textSecondary }]}>Сотрудники не указаны.</Text>}
            renderItem={({ item }) => (
              <NativeCompanyPersonCard
                person={item}
                tokens={tokens}
                highlighted={Boolean(focusedName && item.full_name === focusedName)}
                onCall={onCall}
                onEmail={onEmail}
              />
            )}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
});

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { minHeight: 58, borderBottomWidth: 1, paddingLeft: 16, paddingRight: 4, flexDirection: 'row', alignItems: 'center' },
  titleBody: { flex: 1, minWidth: 0 },
  title: { fontSize: 17, fontWeight: '800' },
  subtitle: { marginTop: 2, fontSize: 11 },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  errorBody: { paddingHorizontal: 14, paddingTop: 10 },
  error: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  retry: { minHeight: 44, marginTop: 6, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 12, paddingBottom: 24 },
  sectionHeader: { minHeight: 44, paddingTop: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { flex: 1, fontSize: 13, fontWeight: '800' },
  sectionCount: { fontSize: 11, fontWeight: '700' },
  empty: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { textAlign: 'center', fontSize: 13 },
});
