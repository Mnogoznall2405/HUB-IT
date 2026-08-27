import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { formatApiError } from '../../api/formatError';
import {
  createMailFolder,
  deleteMailFolder,
  getMailFolderTree,
  renameMailFolder,
  setMailFolderFavorite,
  type MailFolderNode,
} from '../../api/mailApi';
import { listMailboxes, type MailMailbox } from '../../api/mailMailboxesApi';
import { useAuth } from '../../auth/AuthContext';
import { buildNativeMailFolderOptions } from '../../mail/nativeMailFolders';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { AccountScreenScaffold, AccountSectionCard } from '../account/AccountChrome';
import { goBackOrReplace } from '../account/accountBack';

type FolderDialogState = {
  mode: 'create' | 'rename';
  targetId: string;
  parentFolderId: string;
  scope: 'mailbox' | 'archive';
  contextLabel: string;
};

const CLOSED_DIALOG: FolderDialogState = {
  mode: 'create',
  targetId: '',
  parentFolderId: '',
  scope: 'mailbox',
  contextLabel: '',
};

function first(value: string | string[] | undefined): string {
  return String(Array.isArray(value) ? value[0] : value || '').trim();
}

function folderId(node: MailFolderNode): string {
  return String(node.id || node.folder_id || node.key || '').trim();
}

function folderLabel(node: MailFolderNode): string {
  return String(node.label || node.display_name || node.name || '').trim() || 'Папка';
}

export function NativeMailFoldersScreen() {
  const params = useLocalSearchParams<{ mailboxId?: string | string[] }>();
  const { hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const allowed = hasPermission('mail.access');
  const [mailboxId, setMailboxId] = useState(first(params.mailboxId));
  const [mailboxes, setMailboxes] = useState<MailMailbox[]>([]);
  const [folderTree, setFolderTree] = useState<MailFolderNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyFolder, setBusyFolder] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialog, setDialog] = useState<FolderDialogState>(CLOSED_DIALOG);
  const [folderName, setFolderName] = useState('');

  const options = useMemo(() => buildNativeMailFolderOptions(folderTree), [folderTree]);
  const customRows = useMemo(() => options.flatMap((option) => {
    const node = folderTree.find((item) => folderId(item) === option.id);
    if (!node || node.well_known_key) return [];
    return [{ option, node }];
  }), [folderTree, options]);

  const load = useCallback(async () => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [mailboxItems, tree] = await Promise.all([
        listMailboxes(false),
        getMailFolderTree(mailboxId),
      ]);
      const active = mailboxItems.filter((item) => item.is_active !== false);
      setMailboxes(active);
      setFolderTree(tree.items);
      if (!mailboxId) {
        const selected = active.find((item) => item.is_primary) || active[0];
        if (selected?.id) setMailboxId(String(selected.id));
      }
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось загрузить папки почты.'));
    } finally {
      setLoading(false);
    }
  }, [allowed, mailboxId]);

  useEffect(() => { void load(); }, [load]);

  const openCreate = useCallback((scope: 'mailbox' | 'archive', parent?: { id: string; label: string }) => {
    setDialog({
      mode: 'create',
      targetId: '',
      parentFolderId: parent?.id || '',
      scope,
      contextLabel: parent?.label || (scope === 'archive' ? 'Корень архива' : 'Корень ящика'),
    });
    setFolderName('');
    setError('');
    setDialogOpen(true);
  }, []);

  const openRename = useCallback((node: MailFolderNode) => {
    const id = folderId(node);
    if (!id || node.well_known_key || node.can_rename === false) return;
    setDialog({
      mode: 'rename',
      targetId: id,
      parentFolderId: '',
      scope: node.scope === 'archive' ? 'archive' : 'mailbox',
      contextLabel: folderLabel(node),
    });
    setFolderName(folderLabel(node));
    setError('');
    setDialogOpen(true);
  }, []);

  const saveFolder = useCallback(async () => {
    const name = folderName.trim();
    if (!name || busyFolder || offlineMode) return;
    const busyId = dialog.mode === 'rename' ? dialog.targetId : 'create';
    setBusyFolder(busyId);
    setError('');
    setStatus('');
    try {
      if (dialog.mode === 'rename') {
        await renameMailFolder(dialog.targetId, mailboxId, name);
        setStatus('Папка переименована.');
      } else {
        await createMailFolder({
          mailboxId,
          name,
          parentFolderId: dialog.parentFolderId,
          scope: dialog.scope,
        });
        setStatus('Папка создана.');
      }
      setDialogOpen(false);
      setFolderName('');
      await load();
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось сохранить папку.'));
    } finally {
      setBusyFolder('');
    }
  }, [busyFolder, dialog, folderName, load, mailboxId, offlineMode]);

  const toggleFavorite = useCallback(async (node: MailFolderNode) => {
    const id = folderId(node);
    if (!id || busyFolder || offlineMode) return;
    setBusyFolder(id);
    setError('');
    setStatus('');
    try {
      await setMailFolderFavorite(id, !node.is_favorite, mailboxId);
      setStatus(node.is_favorite ? 'Папка удалена из избранного.' : 'Папка добавлена в избранное.');
      await load();
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось изменить избранные папки.'));
    } finally {
      setBusyFolder('');
    }
  }, [busyFolder, load, mailboxId, offlineMode]);

  const confirmDelete = useCallback((node: MailFolderNode) => {
    const id = folderId(node);
    if (!id || node.well_known_key || node.can_delete === false || busyFolder || offlineMode) return;
    const label = folderLabel(node);
    Alert.alert(
      `Удалить папку «${label}»?`,
      'Папка и находящиеся в ней письма будут удалены на почтовом сервере. Это действие нельзя отменить в приложении.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusyFolder(id);
              setError('');
              setStatus('');
              try {
                await deleteMailFolder(id, mailboxId);
                setStatus('Папка удалена.');
                await load();
              } catch (cause) {
                setError(formatApiError(cause, 'Не удалось удалить папку.'));
              } finally {
                setBusyFolder('');
              }
            })();
          },
        },
      ],
    );
  }, [busyFolder, load, mailboxId, offlineMode]);

  if (!allowed) {
    return <AccountScreenScaffold title="Папки почты" tokens={tokens} onBack={() => goBackOrReplace('/(shell)/mail/settings')}><AccountSectionCard tokens={tokens} title="Нет доступа" description="Для почты нужно право mail.access.">{null}</AccountSectionCard></AccountScreenScaffold>;
  }

  return (
    <AccountScreenScaffold title="Папки почты" tokens={tokens} onBack={() => goBackOrReplace('/(shell)/mail/settings')} refreshing={loading} onRefresh={() => { void load(); }}>
      {mailboxes.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mailboxRow}>
          {mailboxes.map((mailbox) => (
            <Pressable
              key={mailbox.id}
              testID={`native-mail-folders-mailbox-${mailbox.id}`}
              accessibilityRole="button"
              accessibilityState={{ selected: mailboxId === String(mailbox.id) }}
              onPress={() => { setMailboxId(String(mailbox.id)); setStatus(''); }}
              style={[styles.mailboxChip, {
                backgroundColor: mailboxId === String(mailbox.id) ? tokens.selected : tokens.panelSolid,
                borderColor: mailboxId === String(mailbox.id) ? tokens.selectedBorder : tokens.borderSoft,
              }]}
            >
              <Text style={[styles.mailboxText, { color: mailboxId === String(mailbox.id) ? tokens.primary : tokens.textSecondary }]}>{mailbox.label || mailbox.mailbox_email || 'Ящик'}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {offlineMode ? <Text accessibilityRole="alert" style={[styles.warning, { color: tokens.warning }]}>Автономный режим: управление папками недоступно.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text> : null}
      {status ? <Text accessibilityLiveRegion="polite" style={[styles.success, { color: tokens.success }]}>{status}</Text> : null}
      <View style={styles.createActions}>
        <CreateButton testID="native-mail-folder-create" label="Новая папка" disabled={Boolean(busyFolder) || offlineMode} tokens={tokens} onPress={() => openCreate('mailbox')} />
        <CreateButton testID="native-mail-archive-folder-create" label="В архиве" disabled={Boolean(busyFolder) || offlineMode} tokens={tokens} onPress={() => openCreate('archive')} />
      </View>
      {loading && !folderTree.length ? <View style={styles.loading}><ActivityIndicator color={tokens.primary} /></View> : null}
      {!loading && !customRows.length ? (
        <AccountSectionCard tokens={tokens} title="Пользовательских папок нет" description="Создайте папку в ящике или архиве.">{null}</AccountSectionCard>
      ) : (
        <View style={styles.folderRows}>
          {customRows.map(({ option, node }) => {
            const id = option.id;
            const busy = busyFolder === id;
            const disabled = Boolean(busyFolder) || offlineMode;
            return (
              <View key={id} testID={`native-mail-managed-folder-${id}`} style={[styles.folderRow, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
                <MaterialCommunityIcons name={node.is_favorite ? 'folder-star' : 'folder-outline'} size={24} color={node.is_favorite ? tokens.primary : tokens.iconMuted} />
                <View style={styles.folderText}>
                  <Text numberOfLines={2} style={[styles.folderTitle, { color: tokens.textPrimary }]}>{option.pathLabel}</Text>
                  <Text style={[styles.folderMeta, { color: tokens.textSecondary }]}>{option.unread} непрочитанных · {node.scope === 'archive' ? 'Архив' : 'Ящик'}</Text>
                </View>
                {busy ? <ActivityIndicator color={tokens.primary} /> : (
                  <View style={styles.folderActions}>
                    <FolderAction testID={`native-mail-folder-favorite-${id}`} icon={node.is_favorite ? 'star' : 'star-outline'} label={node.is_favorite ? 'Убрать из избранного' : 'Добавить в избранное'} disabled={disabled} tokens={tokens} onPress={() => { void toggleFavorite(node); }} />
                    <FolderAction testID={`native-mail-folder-child-${id}`} icon="folder-plus-outline" label="Создать вложенную папку" disabled={disabled} tokens={tokens} onPress={() => openCreate(node.scope === 'archive' ? 'archive' : 'mailbox', { id, label: option.pathLabel })} />
                    {node.can_rename !== false ? <FolderAction testID={`native-mail-folder-rename-${id}`} icon="pencil-outline" label="Переименовать папку" disabled={disabled} tokens={tokens} onPress={() => openRename(node)} /> : null}
                    {node.can_delete !== false ? <FolderAction testID={`native-mail-folder-delete-${id}`} icon="trash-can-outline" label="Удалить папку" danger disabled={disabled} tokens={tokens} onPress={() => confirmDelete(node)} /> : null}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
      <Modal visible={dialogOpen} transparent animationType="fade" onRequestClose={() => { if (!busyFolder) setDialogOpen(false); }}>
        <Pressable style={styles.dialogBackdrop} accessibilityRole="button" accessibilityLabel="Закрыть редактор папки" onPress={() => { if (!busyFolder) setDialogOpen(false); }}>
          <Pressable testID="native-mail-folder-dialog" style={[styles.dialogCard, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]} onPress={(event) => event.stopPropagation()}>
            <Text style={[styles.dialogTitle, { color: tokens.textPrimary }]}>{dialog.mode === 'rename' ? 'Переименовать папку' : 'Новая папка'}</Text>
            <Text style={[styles.dialogContext, { color: tokens.textSecondary }]}>{dialog.mode === 'rename' ? dialog.contextLabel : `Расположение: ${dialog.contextLabel}`}</Text>
            <TextInput
              testID="native-mail-folder-name"
              value={folderName}
              onChangeText={setFolderName}
              maxLength={255}
              autoFocus
              selectTextOnFocus={dialog.mode === 'rename'}
              placeholder="Название папки"
              placeholderTextColor={tokens.textTertiary}
              accessibilityLabel="Название папки"
              returnKeyType="done"
              onSubmitEditing={() => { void saveFolder(); }}
              style={[styles.dialogInput, { color: tokens.textPrimary, borderColor: tokens.borderSoft, backgroundColor: tokens.panelInset }]}
            />
            <View style={styles.dialogActions}>
              <Pressable accessibilityRole="button" disabled={Boolean(busyFolder)} onPress={() => setDialogOpen(false)} style={styles.dialogButton}>
                <Text style={[styles.dialogButtonText, { color: tokens.textSecondary }]}>Отмена</Text>
              </Pressable>
              <Pressable
                testID="native-mail-folder-save"
                accessibilityRole="button"
                accessibilityLabel="Сохранить папку"
                accessibilityState={{ disabled: !folderName.trim() || Boolean(busyFolder) || offlineMode, busy: Boolean(busyFolder) }}
                disabled={!folderName.trim() || Boolean(busyFolder) || offlineMode}
                onPress={() => { void saveFolder(); }}
                style={[styles.dialogButton, styles.dialogPrimary, { backgroundColor: tokens.primary, opacity: !folderName.trim() || busyFolder || offlineMode ? 0.5 : 1 }]}
              >
                {busyFolder ? <ActivityIndicator color="#fff" /> : <Text style={[styles.dialogButtonText, { color: '#fff' }]}>Сохранить</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </AccountScreenScaffold>
  );
}

function CreateButton({ testID, label, disabled, tokens, onPress }: { testID: string; label: string; disabled: boolean; tokens: ReturnType<typeof useFluentTokens>; onPress: () => void }) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.createButton, { backgroundColor: tokens.primary, opacity: disabled ? 0.5 : 1 }]}><MaterialCommunityIcons name="folder-plus-outline" size={20} color="#fff" /><Text style={styles.createButtonText}>{label}</Text></Pressable>;
}

function FolderAction({ testID, icon, label, danger, disabled, tokens, onPress }: { testID: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; label: string; danger?: boolean; disabled: boolean; tokens: ReturnType<typeof useFluentTokens>; onPress: () => void }) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.folderAction, { opacity: disabled ? 0.45 : 1 }]}><MaterialCommunityIcons name={icon} size={20} color={danger ? tokens.error : tokens.iconMuted} /></Pressable>;
}

const styles = StyleSheet.create({
  mailboxRow: { gap: 8, paddingBottom: 10 },
  mailboxChip: { minHeight: 44, borderWidth: 1, borderRadius: 22, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  mailboxText: { fontSize: 12, fontWeight: '800' },
  warning: { marginBottom: 8, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  error: { marginBottom: 8, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  success: { marginBottom: 8, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  createActions: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  createButton: { flex: 1, minHeight: 48, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  createButtonText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  loading: { minHeight: 200, alignItems: 'center', justifyContent: 'center' },
  folderRows: { gap: 8 },
  folderRow: { minHeight: 70, borderWidth: 1, borderRadius: 14, paddingLeft: 12, paddingRight: 4, flexDirection: 'row', alignItems: 'center', gap: 10 },
  folderText: { flex: 1, minWidth: 0, paddingVertical: 10 },
  folderTitle: { fontSize: 13, lineHeight: 18, fontWeight: '900' },
  folderMeta: { marginTop: 3, fontSize: 11, lineHeight: 15 },
  folderActions: { flexDirection: 'row', alignItems: 'center' },
  folderAction: { width: 44, height: 52, alignItems: 'center', justifyContent: 'center' },
  dialogBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  dialogCard: { width: '100%', maxWidth: 440, borderWidth: 1, borderRadius: 18, padding: 16 },
  dialogTitle: { fontSize: 19, lineHeight: 25, fontWeight: '900' },
  dialogContext: { marginTop: 4, fontSize: 12, lineHeight: 17 },
  dialogInput: { minHeight: 50, marginTop: 14, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 15 },
  dialogActions: { marginTop: 14, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  dialogButton: { minWidth: 100, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  dialogPrimary: { minWidth: 120 },
  dialogButtonText: { fontSize: 13, fontWeight: '900' },
});
