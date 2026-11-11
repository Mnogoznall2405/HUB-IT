import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { formatApiError } from '../../api/formatError';
import {
  createTaskObject,
  createTaskProject,
  getTaskObjects,
  getTaskProjects,
  updateTaskObject,
  updateTaskProject,
  type TaskObject,
  type TaskProject,
} from '../../api/taskApi';
import { useAuth } from '../../auth/AuthContext';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens, type FluentTokens } from '../../theme/fluentTokens';
import {
  AccountLoading,
  AccountPrimaryButton,
  AccountScreenScaffold,
  AccountSecondaryButton,
  AccountSectionCard,
} from '../account/AccountChrome';

type TaxonomyDraft = { name: string; code: string; description: string; isActive: boolean };

function draftFrom(item: TaskProject | TaskObject): TaxonomyDraft {
  return {
    name: String(item.name || ''),
    code: String(item.code || ''),
    description: String(item.description || ''),
    isActive: item.is_active !== false,
  };
}

function TaxonomyFields({ draft, tokens, prefix, onChange }: {
  draft: TaxonomyDraft;
  tokens: FluentTokens;
  prefix: string;
  onChange: (next: TaxonomyDraft) => void;
}) {
  return (
    <View style={styles.fields}>
      <TextInput
        testID={`${prefix}-name`}
        value={draft.name}
        onChangeText={(name) => onChange({ ...draft, name })}
        accessibilityLabel="Название"
        placeholder="Название"
        placeholderTextColor={tokens.textTertiary}
        style={[styles.input, { color: tokens.textPrimary, borderColor: tokens.borderSoft, backgroundColor: tokens.pageBg }]}
      />
      <TextInput
        testID={`${prefix}-code`}
        value={draft.code}
        onChangeText={(code) => onChange({ ...draft, code })}
        accessibilityLabel="Код"
        autoCapitalize="characters"
        placeholder="Код (необязательно)"
        placeholderTextColor={tokens.textTertiary}
        style={[styles.input, { color: tokens.textPrimary, borderColor: tokens.borderSoft, backgroundColor: tokens.pageBg }]}
      />
      <TextInput
        testID={`${prefix}-description`}
        value={draft.description}
        onChangeText={(description) => onChange({ ...draft, description })}
        accessibilityLabel="Описание"
        multiline
        placeholder="Описание"
        placeholderTextColor={tokens.textTertiary}
        style={[styles.input, styles.description, { color: tokens.textPrimary, borderColor: tokens.borderSoft, backgroundColor: tokens.pageBg }]}
      />
      <Pressable
        testID={`${prefix}-active`}
        onPress={() => onChange({ ...draft, isActive: !draft.isActive })}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: draft.isActive }}
        style={styles.activeRow}
      >
        <MaterialCommunityIcons name={draft.isActive ? 'checkbox-marked' : 'checkbox-blank-outline'} size={22} color={draft.isActive ? tokens.primary : tokens.iconMuted} />
        <Text style={[styles.activeLabel, { color: tokens.textPrimary }]}>{draft.isActive ? 'Активен' : 'Отключён'}</Text>
      </Pressable>
    </View>
  );
}

export function NativeTaskTaxonomyScreen() {
  const { hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const allowed = hasPermission('tasks.write');
  const [projects, setProjects] = useState<TaskProject[]>([]);
  const [objects, setObjects] = useState<TaskObject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [editingProjectId, setEditingProjectId] = useState('');
  const [editingObjectId, setEditingObjectId] = useState('');
  const [projectDraft, setProjectDraft] = useState<TaxonomyDraft>({ name: '', code: '', description: '', isActive: true });
  const [objectDraft, setObjectDraft] = useState<TaxonomyDraft>({ name: '', code: '', description: '', isActive: true });
  const [newProject, setNewProject] = useState<TaxonomyDraft>({ name: '', code: '', description: '', isActive: true });
  const [newObject, setNewObject] = useState<TaxonomyDraft>({ name: '', code: '', description: '', isActive: true });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      const [nextProjects, nextObjects] = await Promise.all([
        getTaskProjects({ includeInactive: true }),
        getTaskObjects({ includeInactive: true }),
      ]);
      setProjects(nextProjects);
      setObjects(nextObjects);
      setSelectedProjectId((current) => current && nextProjects.some((item) => item.id === current)
        ? current
        : String(nextProjects[0]?.id || ''));
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось загрузить проекты и объекты.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const visibleObjects = useMemo(
    () => objects.filter((item) => String(item.project_id) === selectedProjectId),
    [objects, selectedProjectId],
  );

  const runMutation = async (operation: () => Promise<void>, successMessage: string) => {
    if (offlineMode || saving) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await operation();
      setMessage(successMessage);
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось сохранить справочник.'));
    } finally {
      setSaving(false);
    }
  };

  const saveProject = async (item: TaskProject) => {
    const name = projectDraft.name.trim();
    if (!name) {
      setError('Укажите название проекта.');
      return;
    }
    await runMutation(async () => {
      const updated = await updateTaskProject(String(item.id), {
        name,
        code: projectDraft.code.trim(),
        description: projectDraft.description.trim(),
        is_active: projectDraft.isActive,
      });
      setProjects((current) => current.map((entry) => entry.id === item.id ? updated : entry));
      setEditingProjectId('');
    }, 'Проект обновлён.');
  };

  const saveObject = async (item: TaskObject) => {
    const name = objectDraft.name.trim();
    if (!name) {
      setError('Укажите название объекта.');
      return;
    }
    await runMutation(async () => {
      const updated = await updateTaskObject(String(item.id), {
        project_id: selectedProjectId,
        name,
        code: objectDraft.code.trim(),
        description: objectDraft.description.trim(),
        is_active: objectDraft.isActive,
      });
      setObjects((current) => current.map((entry) => entry.id === item.id ? updated : entry));
      setEditingObjectId('');
    }, 'Объект обновлён.');
  };

  const addProject = async () => {
    const name = newProject.name.trim();
    if (!name) {
      setError('Укажите название нового проекта.');
      return;
    }
    await runMutation(async () => {
      const created = await createTaskProject({
        name,
        code: newProject.code.trim(),
        description: newProject.description.trim(),
        is_active: newProject.isActive,
      });
      setProjects((current) => [...current, created]);
      setSelectedProjectId(String(created.id));
      setNewProject({ name: '', code: '', description: '', isActive: true });
    }, 'Проект создан.');
  };

  const addObject = async () => {
    const name = newObject.name.trim();
    if (!selectedProjectId) {
      setError('Сначала создайте или выберите проект.');
      return;
    }
    if (!name) {
      setError('Укажите название нового объекта.');
      return;
    }
    await runMutation(async () => {
      const created = await createTaskObject({
        project_id: selectedProjectId,
        name,
        code: newObject.code.trim(),
        description: newObject.description.trim(),
        is_active: newObject.isActive,
      });
      setObjects((current) => [...current, created]);
      setNewObject({ name: '', code: '', description: '', isActive: true });
    }, 'Объект создан.');
  };

  if (!allowed) {
    return (
      <AccountScreenScaffold title="Проекты задач" onBack={() => router.back()} tokens={tokens}>
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Нужно право tasks.write.">{null}</AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  return (
    <AccountScreenScaffold
      title="Проекты и объекты"
      onBack={() => router.back()}
      tokens={tokens}
      refreshing={refreshing}
      onRefresh={() => { void load(true); }}
    >
      {offlineMode ? <Text accessibilityRole="alert" style={[styles.status, { color: tokens.warning }]}>Офлайн: изменение справочников отключено.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.status, { color: tokens.error }]}>{error}</Text> : null}
      {message ? <Text accessibilityLiveRegion="polite" style={[styles.status, { color: tokens.success }]}>{message}</Text> : null}
      {loading ? <AccountLoading tokens={tokens} /> : null}

      {!loading ? (
        <>
          <AccountSectionCard tokens={tokens} title="Проекты" description="Отключение сохраняет историю задач и скрывает проект из новых форм.">
            {projects.map((item) => (
              <View key={item.id} style={[styles.item, { borderBottomColor: tokens.borderSoft }]}> 
                {editingProjectId === item.id ? (
                  <>
                    <TaxonomyFields draft={projectDraft} tokens={tokens} prefix={`native-task-project-edit-${item.id}`} onChange={setProjectDraft} />
                    <View style={styles.buttonRow}>
                      <View style={styles.flex}><AccountSecondaryButton tokens={tokens} label="Отмена" disabled={saving} onPress={() => setEditingProjectId('')} /></View>
                      <View style={styles.flex}><AccountPrimaryButton testID={`native-task-project-save-${item.id}`} tokens={tokens} label={saving ? 'Сохраняем…' : 'Сохранить'} disabled={saving || offlineMode} onPress={() => { void saveProject(item); }} /></View>
                    </View>
                  </>
                ) : (
                  <Pressable
                    testID={`native-task-project-${item.id}`}
                    onPress={() => setSelectedProjectId(String(item.id))}
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectedProjectId === String(item.id) }}
                    style={styles.itemSummary}
                  >
                    <View style={styles.flex}>
                      <Text style={[styles.itemTitle, { color: tokens.textPrimary }]}>{item.name}</Text>
                      <Text style={[styles.itemMeta, { color: item.is_active === false ? tokens.error : tokens.textSecondary }]}>{item.code || 'Без кода'} · {item.is_active === false ? 'отключён' : 'активен'}</Text>
                    </View>
                    <Pressable
                      testID={`native-task-project-edit-open-${item.id}`}
                      onPress={() => { setEditingProjectId(String(item.id)); setProjectDraft(draftFrom(item)); }}
                      accessibilityRole="button"
                      accessibilityLabel={`Редактировать проект ${item.name}`}
                      style={styles.iconButton}
                    >
                      <MaterialCommunityIcons name="pencil-outline" size={21} color={tokens.primary} />
                    </Pressable>
                  </Pressable>
                )}
              </View>
            ))}
            <Text style={[styles.subheading, { color: tokens.textPrimary }]}>Новый проект</Text>
            <TaxonomyFields draft={newProject} tokens={tokens} prefix="native-task-project-new" onChange={setNewProject} />
            <AccountPrimaryButton testID="native-task-project-create" tokens={tokens} label={saving ? 'Создаём…' : 'Создать проект'} disabled={saving || offlineMode} onPress={() => { void addProject(); }} />
          </AccountSectionCard>

          <AccountSectionCard tokens={tokens} title="Объекты" description={selectedProjectId ? `Проект: ${projects.find((item) => String(item.id) === selectedProjectId)?.name || selectedProjectId}` : 'Сначала выберите проект'}>
            {visibleObjects.map((item) => (
              <View key={item.id} style={[styles.item, { borderBottomColor: tokens.borderSoft }]}> 
                {editingObjectId === item.id ? (
                  <>
                    <TaxonomyFields draft={objectDraft} tokens={tokens} prefix={`native-task-object-edit-${item.id}`} onChange={setObjectDraft} />
                    <View style={styles.buttonRow}>
                      <View style={styles.flex}><AccountSecondaryButton tokens={tokens} label="Отмена" disabled={saving} onPress={() => setEditingObjectId('')} /></View>
                      <View style={styles.flex}><AccountPrimaryButton testID={`native-task-object-save-${item.id}`} tokens={tokens} label={saving ? 'Сохраняем…' : 'Сохранить'} disabled={saving || offlineMode} onPress={() => { void saveObject(item); }} /></View>
                    </View>
                  </>
                ) : (
                  <View style={styles.itemSummary}>
                    <View style={styles.flex}>
                      <Text style={[styles.itemTitle, { color: tokens.textPrimary }]}>{item.name}</Text>
                      <Text style={[styles.itemMeta, { color: item.is_active === false ? tokens.error : tokens.textSecondary }]}>{item.code || 'Без кода'} · {item.is_active === false ? 'отключён' : 'активен'}</Text>
                    </View>
                    <Pressable
                      testID={`native-task-object-edit-open-${item.id}`}
                      onPress={() => { setEditingObjectId(String(item.id)); setObjectDraft(draftFrom(item)); }}
                      accessibilityRole="button"
                      accessibilityLabel={`Редактировать объект ${item.name}`}
                      style={styles.iconButton}
                    >
                      <MaterialCommunityIcons name="pencil-outline" size={21} color={tokens.primary} />
                    </Pressable>
                  </View>
                )}
              </View>
            ))}
            {selectedProjectId ? (
              <>
                <Text style={[styles.subheading, { color: tokens.textPrimary }]}>Новый объект</Text>
                <TaxonomyFields draft={newObject} tokens={tokens} prefix="native-task-object-new" onChange={setNewObject} />
                <AccountPrimaryButton testID="native-task-object-create" tokens={tokens} label={saving ? 'Создаём…' : 'Создать объект'} disabled={saving || offlineMode} onPress={() => { void addObject(); }} />
              </>
            ) : null}
          </AccountSectionCard>
        </>
      ) : null}
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  status: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  item: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  itemSummary: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemTitle: { fontSize: 15, lineHeight: 20, fontWeight: '800' },
  itemMeta: { marginTop: 2, fontSize: 12, fontWeight: '600' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  fields: { gap: 8 },
  input: { minHeight: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, fontSize: 14 },
  description: { minHeight: 78, paddingTop: 10, textAlignVertical: 'top' },
  activeRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  activeLabel: { fontSize: 14, fontWeight: '700' },
  buttonRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  subheading: { marginTop: 14, marginBottom: 8, fontSize: 14, fontWeight: '900' },
});
