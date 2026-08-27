import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { memo, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { MyFileRecord } from '../../api/myFilesApi';
import {
  formatMyFileDate,
  formatMyFileSize,
  isMyFileProcessing,
  isMyFileReady,
  myFileIcon,
  myFileName,
  nativeMyFilePreviewKind,
  myFileStatusLabel,
} from '../../myFiles/nativeMyFilesModel';
import type { FluentTokens } from '../../theme/fluentTokens';

export type MyFileCardAction = 'preview' | 'open' | 'share-file' | 'share-link' | 'rotate' | 'revoke' | 'delete';

export const NativeMyFileCard = memo(function NativeMyFileCard({
  item,
  tokens,
  canWrite,
  canShare,
  offline,
  actionsLocked,
  busyAction,
  onPreview,
  onOpen,
  onShareFile,
  onShareLink,
  onRotate,
  onRevoke,
  onDelete,
}: {
  item: MyFileRecord;
  tokens: FluentTokens;
  canWrite: boolean;
  canShare: boolean;
  offline: boolean;
  actionsLocked: boolean;
  busyAction: MyFileCardAction | null;
  onPreview: () => void;
  onOpen: () => void;
  onShareFile: () => void;
  onShareLink: () => void;
  onRotate: () => void;
  onRevoke: () => void;
  onDelete: () => void;
}) {
  const ready = isMyFileReady(item);
  const previewKind = nativeMyFilePreviewKind(item);
  const processing = isMyFileProcessing(item);
  const busy = Boolean(busyAction);
  const statusColor = item.status === 'failed'
    ? tokens.error
    : ready
      ? tokens.success
      : tokens.warning;
  const fileName = myFileName(item);
  return (
    <View
      testID={`native-my-file-${item.id}`}
      style={[styles.card, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}
    >
      <View style={styles.heading}>
        <View style={[styles.icon, { backgroundColor: tokens.accentSoft }]}>
          <MaterialCommunityIcons name={myFileIcon(item)} size={26} color={tokens.primary} />
        </View>
        <View style={styles.titleBody}>
          <Text numberOfLines={2} style={[styles.title, { color: tokens.textPrimary }]}>{fileName}</Text>
          <View style={styles.statusRow}>
            {processing ? <ActivityIndicator size="small" color={statusColor} /> : <View style={[styles.statusDot, { backgroundColor: statusColor }]} />}
            <Text numberOfLines={2} style={[styles.status, { color: statusColor }]}>{myFileStatusLabel(item)}</Text>
            {item.is_shared ? (
              <View style={[styles.sharedBadge, { backgroundColor: tokens.selected }]}>
                <MaterialCommunityIcons name="link-variant" size={14} color={tokens.primary} />
                <Text style={[styles.sharedText, { color: tokens.primary }]}>ссылка</Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      <View style={styles.metaRow}>
        <View style={styles.metaBlock}>
          <Text style={[styles.metaLabel, { color: tokens.textTertiary }]}>Размер</Text>
          <Text style={[styles.metaValue, { color: tokens.textPrimary }]}>{formatMyFileSize(item.original_size_bytes)}</Text>
        </View>
        <View style={styles.metaBlock}>
          <Text style={[styles.metaLabel, { color: tokens.textTertiary }]}>Хранится до</Text>
          <Text numberOfLines={1} style={[styles.metaValue, { color: tokens.textPrimary }]}>{formatMyFileDate(item.expires_at)}</Text>
        </View>
      </View>

      {item.is_shared ? (
        <Text style={[styles.shareExpiry, { color: tokens.textSecondary }]}>Публичная ссылка действует до {formatMyFileDate(item.share_expires_at || item.expires_at)}</Text>
      ) : null}

      <View style={styles.actions}>
        {previewKind ? (
          <Action
            testID={`native-my-file-preview-${item.id}`}
            label="Просмотр"
            icon="eye-outline"
            tokens={tokens}
            primary
            busy={busyAction === 'preview'}
            disabled={offline || actionsLocked || busy}
            onPress={onPreview}
          />
        ) : null}
        {ready ? (
          <Action
            testID={`native-my-file-open-${item.id}`}
            label="Открыть"
            icon="open-in-new"
            tokens={tokens}
            primary={!previewKind}
            busy={busyAction === 'open'}
            disabled={offline || actionsLocked || busy}
            onPress={onOpen}
          />
        ) : null}
        {ready ? (
          <Action
            label="Файлом"
            icon="share-variant-outline"
            tokens={tokens}
            busy={busyAction === 'share-file'}
            disabled={offline || actionsLocked || busy}
            onPress={onShareFile}
          />
        ) : null}
        {ready && canShare ? (
          <Action
            testID={`native-my-file-share-link-${item.id}`}
            label="Ссылкой"
            icon="link-variant"
            tokens={tokens}
            busy={busyAction === 'share-link'}
            disabled={offline || actionsLocked || busy}
            onPress={onShareLink}
          />
        ) : null}
        {item.is_shared && canShare ? (
          <Action
            testID={`native-my-file-rotate-link-${item.id}`}
            label="Новая ссылка"
            icon="link-variant-plus"
            tokens={tokens}
            busy={busyAction === 'rotate'}
            disabled={offline || actionsLocked || busy}
            onPress={onRotate}
          />
        ) : null}
        {item.is_shared && canShare ? (
          <Action
            label="Отключить"
            icon="link-variant-off"
            tokens={tokens}
            busy={busyAction === 'revoke'}
            disabled={offline || actionsLocked || busy}
            onPress={onRevoke}
          />
        ) : null}
        {canWrite ? (
          <Action
            testID={`native-my-file-delete-${item.id}`}
            label="Удалить"
            icon="delete-outline"
            tokens={tokens}
            danger
            busy={busyAction === 'delete'}
            disabled={offline || actionsLocked || busy}
            onPress={onDelete}
          />
        ) : null}
      </View>
    </View>
  );
});

function Action({
  testID,
  label,
  icon,
  tokens,
  primary = false,
  danger = false,
  busy,
  disabled,
  onPress,
}: {
  testID?: string;
  label: string;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  tokens: FluentTokens;
  primary?: boolean;
  danger?: boolean;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const foreground = primary ? '#fff' : danger ? tokens.error : tokens.textPrimary;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label === 'Файлом' ? 'Поделиться файлом' : label === 'Ссылкой' ? 'Поделиться публичной ссылкой' : label}
      accessibilityState={{ disabled, busy }}
      style={({ pressed }) => [
        styles.action,
        {
          backgroundColor: primary ? tokens.primary : 'transparent',
          borderColor: danger ? tokens.error : primary ? tokens.primary : tokens.border,
          opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
          transform: [{ scale: pressed && !disabled ? 0.96 : 1 }],
        },
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={foreground} /> : <MaterialCommunityIcons name={icon} size={17} color={foreground} />}
      <Text style={[styles.actionText, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 13, gap: 12, marginBottom: 9 },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  icon: { width: 50, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  titleBody: { flex: 1, minWidth: 0, gap: 6 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '800' },
  statusRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  status: { flexShrink: 1, fontSize: 11, lineHeight: 15, fontWeight: '800' },
  sharedBadge: { minHeight: 24, borderRadius: 12, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', gap: 3 },
  sharedText: { fontSize: 10, fontWeight: '800' },
  metaRow: { flexDirection: 'row', gap: 12 },
  metaBlock: { flex: 1, minWidth: 0 },
  metaLabel: { fontSize: 10, lineHeight: 14 },
  metaValue: { marginTop: 2, fontSize: 12, lineHeight: 16, fontWeight: '700' },
  shareExpiry: { fontSize: 11, lineHeight: 16, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  action: { minHeight: 44, borderRadius: 11, borderWidth: 1, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  actionText: { fontSize: 11, fontWeight: '800' },
});
