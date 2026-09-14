import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MyFileFolder } from '../../api/myFilesApi';
import { russianPlural } from '../../utils/russianPlural';
import type { FluentTokens } from '../../theme/fluentTokens';

export const NativeMyFileFolderCard = memo(function NativeMyFileFolderCard({
  folder,
  tokens,
  busy,
  onOpen,
  onMore,
}: {
  folder: MyFileFolder;
  tokens: FluentTokens;
  busy: boolean;
  onOpen: (folder: MyFileFolder) => void;
  onMore: (folder: MyFileFolder) => void;
}) {
  const handleOpen = useCallback(() => onOpen(folder), [folder, onOpen]);
  const handleMore = useCallback(() => onMore(folder), [folder, onMore]);
  return (
    <View
      testID={`native-my-folder-${folder.id}`}
      style={[styles.card, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}
    >
      <Pressable
        testID={`native-my-folder-open-${folder.id}`}
        onPress={handleOpen}
        accessibilityRole="button"
        accessibilityLabel={`Открыть папку ${folder.name}`}
        style={({ pressed }) => [styles.body, { opacity: pressed ? 0.7 : 1 }]}
      >
        <View style={[styles.icon, { backgroundColor: tokens.accentSoft }]}>
          <MaterialCommunityIcons name="folder-outline" size={24} color={tokens.primary} />
        </View>
        <View style={styles.titleBody}>
          <View style={styles.titleRow}>
            {folder.is_favorite ? (
              <MaterialCommunityIcons name="star" size={15} color={tokens.warning} />
            ) : null}
            <Text numberOfLines={1} style={[styles.title, { color: tokens.textPrimary }]}>{folder.name}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={[styles.meta, { color: tokens.textSecondary }]}>
              {folder.file_count} {russianPlural(folder.file_count, ['файл', 'файла', 'файлов'])}
            </Text>
            {folder.is_shared ? (
              <View style={[styles.sharedBadge, { backgroundColor: tokens.selected }]}>
                <MaterialCommunityIcons name="link-variant" size={13} color={tokens.primary} />
                <Text style={[styles.sharedText, { color: tokens.primary }]}>ссылка</Text>
              </View>
            ) : null}
          </View>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color={tokens.iconMuted} />
      </Pressable>
      <Pressable
        testID={`native-my-folder-more-${folder.id}`}
        onPress={handleMore}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={`Действия с папкой ${folder.name}`}
        accessibilityState={{ disabled: busy }}
        style={({ pressed }) => [styles.moreButton, { opacity: busy ? 0.5 : pressed ? 0.7 : 1 }]}
      >
        <MaterialCommunityIcons name="dots-vertical" size={22} color={tokens.iconMuted} />
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  body: {
    flex: 1,
    minWidth: 0,
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingLeft: 12,
  },
  icon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  titleBody: { flex: 1, minWidth: 0, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  title: { flexShrink: 1, fontSize: 14, lineHeight: 19, fontWeight: '800' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { fontSize: 12, lineHeight: 16 },
  sharedBadge: { minHeight: 20, borderRadius: 10, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', gap: 3 },
  sharedText: { fontSize: 11, fontWeight: '800' },
  moreButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
