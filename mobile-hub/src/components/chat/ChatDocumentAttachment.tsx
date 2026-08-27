import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from '../../accessibility/useReducedMotion';
import type { ChatAttachment } from '../../api/types';
import { type ChatTokens, useChatStyles } from '../../theme/chatTokens';

const FILE_EXTENSION_COLORS: Record<string, string> = {
  pdf: '#e53935',
  xls: '#43a047',
  xlsx: '#43a047',
  csv: '#43a047',
  doc: '#1e88e5',
  docx: '#1e88e5',
  zip: '#f9a825',
  rar: '#f9a825',
  '7z': '#f9a825',
};

export type ChatAttachmentTransfer = {
  action: 'upload' | 'open' | 'share' | 'save';
  progress: number | null;
  status?: 'active' | 'failed' | 'cancelled';
  cancellable?: boolean;
};

export function getChatFileExtension(fileName?: string | null, mimeType?: string | null): string {
  const normalizedName = String(fileName || '').trim();
  const extension = normalizedName.includes('.')
    ? String(normalizedName.split('.').pop() || '').trim().toUpperCase()
    : '';
  if (extension) return extension.slice(0, 5);
  const normalizedMime = String(mimeType || '').trim().toLowerCase();
  if (normalizedMime.startsWith('image/')) return 'IMG';
  if (normalizedMime.startsWith('video/')) return 'VID';
  if (normalizedMime.startsWith('audio/')) return 'AUD';
  return 'FILE';
}

export function formatChatFileSize(value?: number | null): string {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} Б`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
  return `${(bytes / 1024 ** 3).toFixed(1)} ГБ`;
}

function transferLabel(transfer?: ChatAttachmentTransfer | null): string {
  if (!transfer) return '';
  if (transfer.status === 'failed') return transfer.action === 'upload' ? 'Не отправлено' : 'Ошибка загрузки';
  if (transfer.status === 'cancelled') return transfer.action === 'upload' ? 'Отправка отменена' : 'Загрузка отменена';
  if (transfer.action === 'upload') {
    if (transfer.progress == null) return 'Отправка…';
    return `Отправка ${Math.round(Math.max(0, Math.min(1, transfer.progress)) * 100)}%`;
  }
  if (transfer.action === 'save') return 'Сохраняем…';
  if (transfer.progress == null) return 'Загрузка…';
  return `Загрузка ${Math.round(Math.max(0, Math.min(1, transfer.progress)) * 100)}%`;
}

export function ChatDocumentAttachment({
  attachment,
  width,
  transfer,
  onOpen,
  onMore,
  onCancel,
  onRetry,
}: {
  attachment: ChatAttachment;
  width: number;
  transfer?: ChatAttachmentTransfer | null;
  onOpen?: () => void;
  onMore?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
}) {
  const { styles } = useChatStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const fileName = String(attachment.file_name || 'Вложение').trim() || 'Вложение';
  const extension = getChatFileExtension(fileName, attachment.mime_type);
  const size = formatChatFileSize(attachment.file_size);
  const idleMeta = [extension, size].filter(Boolean).join(' • ');
  const status = transferLabel(transfer);
  const subtitle = status || idleMeta;
  const progress = transfer?.progress == null
    ? null
    : Math.round(Math.max(0, Math.min(1, transfer.progress)) * 100);
  const accent = FILE_EXTENSION_COLORS[extension.toLowerCase()] || '#708fa0';
  const transferStatus = transfer?.status || (transfer ? 'active' : undefined);
  const busy = transferStatus === 'active';
  const failed = transferStatus === 'failed' || transferStatus === 'cancelled';
  const transferAction = busy && transfer?.cancellable && onCancel
    ? { label: `Отменить: ${fileName}`, icon: 'close' as const, onPress: onCancel }
    : failed && onRetry
      ? { label: `Повторить: ${fileName}`, icon: 'refresh' as const, onPress: onRetry }
      : null;

  return (
    <View style={[styles.row, { width }]}>
      <Pressable
        onPress={(event) => {
          event.stopPropagation();
          onOpen?.();
        }}
        disabled={!onOpen || busy}
        style={({ pressed }) => [
          styles.openButton,
          pressed && !reduceMotion && styles.pressed,
          pressed && reduceMotion && styles.pressedReduced,
        ]}
        accessibilityRole={onOpen ? 'button' : undefined}
        accessibilityLabel={busy
          ? `${status}: ${fileName}`
          : `Открыть файл ${fileName}${idleMeta ? `. ${idleMeta}` : ''}`}
        accessibilityHint={onOpen && !busy ? 'Скачивает файл и открывает его в приложении Android' : undefined}
        accessibilityState={{ disabled: !onOpen || busy, busy }}
      >
        <View
          style={[
            styles.extensionBadge,
            { backgroundColor: `${accent}26`, borderColor: `${accent}46` },
          ]}
          accessible={busy}
          accessibilityRole={busy ? 'progressbar' : undefined}
          accessibilityLabel={busy ? `${status}: ${fileName}` : undefined}
          accessibilityValue={busy
            ? progress == null
              ? { text: status }
              : { min: 0, max: 100, now: progress, text: `${progress} процентов` }
            : undefined}
        >
          {busy ? (
            progress == null ? (
              <ActivityIndicator size="small" color={accent} />
            ) : (
              <Text style={[styles.progressText, { color: accent }]}>{progress}%</Text>
            )
          ) : failed ? (
            <MaterialCommunityIcons name="alert-circle-outline" size={22} color={accent} />
          ) : (
            <Text style={[styles.extensionText, { color: accent }]}>{extension}</Text>
          )}
        </View>
        <View style={styles.copy}>
          <Text style={styles.fileName} numberOfLines={1} ellipsizeMode="middle">{fileName}</Text>
          <Text style={styles.fileMeta} numberOfLines={1}>{subtitle}</Text>
        </View>
      </Pressable>
      <Pressable
        onPress={(event) => {
          event.stopPropagation();
          if (transferAction) transferAction.onPress();
          else onMore?.();
        }}
        disabled={transferAction ? false : !onMore || busy}
        style={({ pressed }) => [
          styles.moreButton,
          pressed && !reduceMotion && styles.pressed,
          pressed && reduceMotion && styles.pressedReduced,
        ]}
        accessibilityRole={transferAction || onMore ? 'button' : undefined}
        accessibilityLabel={transferAction?.label || `Действия с вложением ${fileName}`}
        accessibilityState={{ disabled: transferAction ? false : !onMore || busy, busy }}
      >
        <MaterialCommunityIcons
          name={transferAction?.icon || 'dots-vertical'}
          size={22}
          color={failed ? accent : styles.moreIcon.color}
        />
      </Pressable>
    </View>
  );
}

const createStyles = (chatTokens: ChatTokens) => StyleSheet.create({
  row: {
    minHeight: 58,
    marginTop: 5,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: chatTokens.borderSoft,
    borderRadius: 14,
    backgroundColor: chatTokens.sidebarRowSoftActive,
    overflow: 'hidden',
  },
  openButton: {
    minWidth: 0,
    minHeight: 58,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 8,
    paddingVertical: 6,
  },
  extensionBadge: {
    width: 46,
    height: 46,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 23,
  },
  extensionText: { fontSize: 10, lineHeight: 13, fontWeight: '800', letterSpacing: 0.4 },
  progressText: { fontSize: 10, lineHeight: 13, fontWeight: '800' },
  copy: { minWidth: 0, flex: 1, marginLeft: 10 },
  fileName: { color: chatTokens.textPrimary, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  fileMeta: { marginTop: 2, color: chatTokens.textSecondary, fontSize: 12, lineHeight: 15 },
  moreButton: {
    width: 44,
    minWidth: 44,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreIcon: { color: chatTokens.textSecondary },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.86 },
  pressedReduced: { opacity: 0.78 },
});
