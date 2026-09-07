import { NativeModal as Modal } from '../../components/ui/NativeModal';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { initialWindowMetrics, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import {
  applyDocflowTaskAction,
  getDocflowCommand,
  getDocflowTask,
  type DocflowAvailableAction,
  type DocflowCommand,
  type DocflowTaskDetail,
  type DocflowTaskFile,
} from '../../api/docflowApi';
import { openExternalUrl } from '../../addressBook/messengerLinks';
import { useAuth } from '../../auth/AuthContext';
import {
  readNativeEntitySnapshot,
  writeNativeEntitySnapshot,
} from '../../cache/nativeSnapshotCache';
import { useAndroidBackHandler } from '../../chat/useAndroidBackHandler';
import { resolveNativeDocflowError } from '../../docflow/docflowError';
import {
  docflowActionRequiresComment,
  docflowCommandIsWaiting,
  docflowTaskStatus,
  formatDocflowDate,
  formatDocflowFileSize,
  isDocflowTaskOverdue,
  mergeAppliedDocflowTask,
  splitDocflowDescription,
} from '../../docflow/nativeDocflowModel';
import { downloadNativeDocflowFile, downloadNativeDocflowPreview } from '../../docflow/nativeDocflowFiles';
import { openNativeFile, shareNativeFile } from '../../files/nativeAttachmentDownloads';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { hubRealtimeSocket } from '../../realtime/hubRealtimeSocket';
import { HubTextField } from '../../components/ui/HubTextField';
import {
  AccountLoading,
  AccountScreenScaffold,
  AccountSectionCard,
} from '../account/AccountChrome';
import { goBackOrReplace } from '../account/accountBack';

type FileAction = 'open' | 'preview' | 'share';

type ActionAttempt = {
  signature: string;
  key: string;
};

export function docflowKeyboardAvoidingBehavior(platform: string): 'padding' | 'height' {
  return platform === 'ios' ? 'padding' : 'height';
}

function createActionIdempotencyKey(): string {
  return Crypto.randomUUID?.()
    || `docflow-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

export function NativeDocflowDetailScreen({ taskRef }: { taskRef: string }) {
  const { user, hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const safeInsets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets;
  const modalBottomInset = safeInsets?.bottom || 0;
  const canRead = hasPermission('docflow.read');
  const canAct = hasPermission('docflow.act');
  const [task, setTask] = useState<DocflowTaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState('');
  const [correlationId, setCorrelationId] = useState('');
  const [relatedError, setRelatedError] = useState('');
  const [fileError, setFileError] = useState('');
  const [fileBusy, setFileBusy] = useState('');
  const [fileProgress, setFileProgress] = useState<number | null>(null);
  const [selectedAction, setSelectedAction] = useState<DocflowAvailableAction | null>(null);
  const [actionComment, setActionComment] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [command, setCommand] = useState<DocflowCommand | null>(null);
  const requestRef = useRef(0);
  const fileLockRef = useRef(false);
  const fileAbortRef = useRef<AbortController | null>(null);
  const actionAttemptRef = useRef<ActionAttempt | null>(null);
  const commandCheckRef = useRef(false);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else goBackOrReplace('/(shell)/docflow');
  }, []);

  useAndroidBackHandler(() => {
    if (selectedAction) {
      if (!actionBusy) setSelectedAction(null);
      return true;
    }
    if (fileAbortRef.current) {
      fileAbortRef.current.abort();
      return true;
    }
    goBack();
    return true;
  });

  const loadTask = useCallback(async (refresh = false) => {
    if (!canRead || !taskRef) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const requestId = ++requestRef.current;
    if (refresh) setRefreshing(true); else setLoading(true);
    setError('');
    setCorrelationId('');
    setRelatedError('');
    const userId = Number(user?.id || 0);
    const snapshot = userId
      ? await readNativeEntitySnapshot<DocflowTaskDetail>(
        'docflow-task-details',
        userId,
        taskRef,
        Number.MAX_SAFE_INTEGER,
      )
      : null;
    if (requestId !== requestRef.current) return;
    if (snapshot) {
      setTask(snapshot.data);
      if (!refresh) setLoading(false);
    }
    if (offlineMode) {
      if (!snapshot) setError('Нет подключения и сохранённой карточки 1С ДО.');
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const core = await getDocflowTask(taskRef, false);
      if (requestId !== requestRef.current) return;
      setTask(core);
      if (userId) void writeNativeEntitySnapshot('docflow-task-details', userId, taskRef, core);
      setLoading(false);
      setEnriching(true);
      try {
        const detail = await getDocflowTask(taskRef, true);
        if (requestId !== requestRef.current) return;
        setTask(detail);
        if (userId) void writeNativeEntitySnapshot('docflow-task-details', userId, taskRef, detail);
        if (detail.files_incomplete) {
          setRelatedError('Список связанных файлов загрузился не полностью. Обновите карточку и повторите попытку.');
        }
      } catch (cause) {
        if (requestId !== requestRef.current) return;
        const resolved = resolveNativeDocflowError(cause, 'Не удалось загрузить связанные документы и файлы. Основная карточка доступна.');
        setRelatedError(resolved.message);
      }
    } catch (cause) {
      if (requestId !== requestRef.current) return;
      const resolved = resolveNativeDocflowError(cause, 'Не удалось открыть задание 1С.');
      if (!snapshot) setTask(null);
      setError(snapshot ? `Показана сохранённая копия. ${resolved.message}` : resolved.message);
      setCorrelationId(resolved.correlationId);
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false);
        setRefreshing(false);
        setEnriching(false);
      }
    }
  }, [canRead, offlineMode, taskRef, user?.id]);

  useEffect(() => {
    void loadTask();
    return () => {
      requestRef.current += 1;
      fileAbortRef.current?.abort();
    };
  }, [loadTask]);

  useEffect(() => {
    if (!canRead || offlineMode || !taskRef) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = (event: unknown) => {
      const envelope = event && typeof event === 'object'
        ? event as { payload?: unknown }
        : {};
      const payload = envelope.payload && typeof envelope.payload === 'object'
        ? envelope.payload as Record<string, unknown>
        : {};
      const changedTaskRef = String(payload.task_ref || '').trim();
      if (changedTaskRef && changedTaskRef !== String(taskRef)) return;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void loadTask(true);
      }, 180);
    };
    const releases = [
      hubRealtimeSocket.onDocflowChanged(refresh),
      hubRealtimeSocket.on('hub.realtime.connected', refresh),
    ];
    return () => {
      if (timer) clearTimeout(timer);
      releases.forEach((release) => release());
    };
  }, [canRead, loadTask, offlineMode, taskRef]);

  const handleFile = useCallback(async (file: DocflowTaskFile, action: FileAction) => {
    if (offlineMode || fileLockRef.current) return;
    fileLockRef.current = true;
    const controller = new AbortController();
    fileAbortRef.current = controller;
    setFileBusy(`${action}-${file.ref}`);
    setFileProgress(null);
    setFileError('');
    try {
      const downloaded = action === 'preview'
        ? await downloadNativeDocflowPreview(taskRef, file, {
          signal: controller.signal,
          onProgress: setFileProgress,
        })
        : await downloadNativeDocflowFile(taskRef, file, {
        signal: controller.signal,
        onProgress: setFileProgress,
      });
      if (action === 'share') await shareNativeFile(downloaded, file.name, file.content_type);
      else await openNativeFile(downloaded, action === 'preview' ? 'application/pdf' : file.content_type);
    } catch (cause) {
      if (!controller.signal.aborted) setFileError(resolveNativeDocflowError(cause, 'Не удалось скачать файл из 1С.').message);
    } finally {
      if (fileAbortRef.current === controller) fileAbortRef.current = null;
      fileLockRef.current = false;
      setFileBusy('');
      setFileProgress(null);
    }
  }, [offlineMode, taskRef]);

  const finalizeAppliedCommand = useCallback((result: DocflowCommand) => {
    setTask((current) => current ? mergeAppliedDocflowTask(current, result) : current);
    setCommand(null);
    setSelectedAction(null);
    setActionComment('');
    setActionError('');
    setActionNotice('1С подтвердила выполнение задания.');
    actionAttemptRef.current = null;
    void getDocflowTask(taskRef, true).then((fresh) => {
      setTask(mergeAppliedDocflowTask(fresh, result));
    }).catch(() => {
      // Optimistic completed state remains visible when the enrichment refresh fails.
    });
  }, [taskRef]);

  const handleCommandResult = useCallback((result: DocflowCommand) => {
    if (result.status === 'applied' || result.status === 'already_applied') {
      finalizeAppliedCommand(result);
      return;
    }
    if (result.status === 'rejected') {
      if (result.task) setTask(result.task);
      setCommand(null);
      setActionNotice(result.error_code === 'DOCFLOW_ACTION_NOT_APPLIED'
        ? '1С не применила действие. Карточка обновлена — действие можно выполнить заново.'
        : '1С отклонила действие. Обновите карточку и повторите попытку.');
      actionAttemptRef.current = null;
      return;
    }
    setCommand(result);
    setActionNotice('');
  }, [finalizeAppliedCommand]);

  const checkCommand = useCallback(async () => {
    const commandId = command?.command_id.trim();
    if (!commandId || commandCheckRef.current || offlineMode) return;
    commandCheckRef.current = true;
    setActionBusy(true);
    setActionError('');
    try {
      handleCommandResult(await getDocflowCommand(commandId));
    } catch (cause) {
      const resolved = resolveNativeDocflowError(cause, 'Не удалось проверить состояние команды в 1С.');
      setActionError(resolved.message);
      if (resolved.correlationId) setCorrelationId(resolved.correlationId);
    } finally {
      commandCheckRef.current = false;
      setActionBusy(false);
    }
  }, [command?.command_id, handleCommandResult, offlineMode]);

  useEffect(() => {
    if (!docflowCommandIsWaiting(command) || offlineMode) return undefined;
    const firstCheck = setTimeout(() => { void checkCommand(); }, 750);
    const interval = setInterval(() => { void checkCommand(); }, 3_000);
    return () => {
      clearTimeout(firstCheck);
      clearInterval(interval);
    };
  }, [checkCommand, command, offlineMode]);

  const openAction = useCallback((action: DocflowAvailableAction) => {
    if (!canAct || offlineMode || actionBusy || command) return;
    setSelectedAction(action);
    setActionComment('');
    setActionError('');
    setActionNotice('');
    actionAttemptRef.current = null;
  }, [actionBusy, canAct, command, offlineMode]);

  const submitAction = useCallback(async () => {
    if (!task || !selectedAction || actionBusy || offlineMode) return;
    const stateToken = task.state_token?.trim() || '';
    const comment = actionComment.trim();
    if (!stateToken) {
      setActionError('Карточка задания устарела. Обновите её перед выполнением действия.');
      return;
    }
    if (docflowActionRequiresComment(selectedAction) && !comment) {
      setActionError('Введите комментарий — без него действие выполнить нельзя.');
      return;
    }
    const signature = `${task.ref}\n${stateToken}\n${selectedAction.code}\n${comment}`;
    if (actionAttemptRef.current?.signature !== signature) {
      actionAttemptRef.current = { signature, key: createActionIdempotencyKey() };
    }
    setActionBusy(true);
    setActionError('');
    setActionNotice('');
    try {
      const result = await applyDocflowTaskAction(task.ref, {
        action: selectedAction.code,
        comment,
        state_token: stateToken,
      }, actionAttemptRef.current.key);
      handleCommandResult(result);
      if (docflowCommandIsWaiting(result)) {
        setSelectedAction(null);
        setActionComment('');
      }
    } catch (cause) {
      const resolved = resolveNativeDocflowError(cause, 'Не удалось выполнить действие в 1С.');
      if (resolved.code === 'DOCFLOW_DIGITAL_SIGNATURE_REQUIRED') {
        setTask((current) => current ? {
          ...current,
          requires_digital_signature: true,
          available_actions: [],
          action_unavailable_reason: 'Для этого задания требуется электронная подпись. Выполните действие в 1С.',
        } : current);
        setSelectedAction(null);
        setActionComment('');
        setActionNotice(resolved.message);
        actionAttemptRef.current = null;
      } else {
        setActionError(resolved.message);
      }
      if (resolved.correlationId) setCorrelationId(resolved.correlationId);
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, actionComment, handleCommandResult, offlineMode, selectedAction, task]);

  const openTaskIn1c = useCallback(async () => {
    if (task?.open_in_1c_url) {
      const opened = await openExternalUrl(task.open_in_1c_url);
      if (!opened) setActionError('Не удалось открыть клиент 1С. Повторите попытку.');
      return;
    }
    setActionError('Для этого действия 1С не предоставила ссылку запуска.');
  }, [task?.open_in_1c_url]);

  if (!canRead) {
    return (
      <AccountScreenScaffold title="Задание 1С" tokens={tokens} onBack={goBack}>
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Для карточки нужно право docflow.read.">{null}</AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  if (!taskRef) {
    return (
      <AccountScreenScaffold title="Задание 1С" tokens={tokens} onBack={goBack}>
        <Text accessibilityRole="alert" style={{ color: tokens.error }}>Не указан идентификатор задания.</Text>
      </AccountScreenScaffold>
    );
  }

  return (
    <AccountScreenScaffold
      title="Задание 1С"
      footer={task && !task.completed && (task.available_actions.length || task.action_unavailable_reason || task.requires_digital_signature) ? (
        <View style={{ maxHeight: 180 }}><ScrollView keyboardShouldPersistTaps="handled">
            <AccountSectionCard
              tokens={tokens}
              title={task.requires_digital_signature ? 'Требуется электронная подпись' : 'Действия задания'}
              description={task.action_unavailable_reason || (!canAct
                ? 'Для выполнения задания нужно право docflow.act.'
                : !task.state_token
                  ? 'Обновите карточку: 1С не вернула токен актуального состояния.'
                  : 'Выберите действие. Перед отправкой приложение попросит подтверждение.')}
            >
              {actionError && !selectedAction ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{actionError}</Text> : null}
              {docflowCommandIsWaiting(command) ? (
                <View accessibilityLiveRegion="polite" accessibilityRole="progressbar" style={[styles.commandStatus, { backgroundColor: tokens.accentSoft, borderColor: tokens.primary }]}>
                  <ActivityIndicator color={tokens.primary} />
                  <View style={styles.commandBody}>
                    <Text style={[styles.commandTitle, { color: tokens.textPrimary }]}>Подтверждаем выполнение в 1С</Text>
                    <Text style={[styles.commandText, { color: tokens.textSecondary }]}>Обычно это занимает несколько секунд.</Text>
                    {command?.correlation_id ? <Text selectable style={[styles.correlation, { color: tokens.textSecondary }]}>Код обращения: {command.correlation_id}</Text> : null}
                  </View>
                  <Pressable testID="native-docflow-command-check" onPress={() => { void checkCommand(); }} disabled={actionBusy || offlineMode} accessibilityRole="button" accessibilityLabel="Проверить состояние команды в 1С" style={[styles.checkAction, { borderColor: tokens.border }]}>
                    <Text style={[styles.checkActionText, { color: tokens.primary }]}>Проверить</Text>
                  </Pressable>
                </View>
              ) : task.requires_digital_signature || task.action_unavailable_reason ? (
                <Pressable testID="native-docflow-actions-web" onPress={() => { void openTaskIn1c(); }} accessibilityRole="button" style={[styles.webAction, { backgroundColor: tokens.primary }]}>
                  <Text style={styles.webActionText}>{task.open_in_1c_url ? 'Выполнить в 1С' : 'Действие недоступно'}</Text>
                </Pressable>
              ) : canAct && task.state_token ? (
                <View style={styles.actionList}>
                  {task.available_actions.map((action) => (
                    <Pressable
                      key={action.code}
                      testID={`native-docflow-action-${action.code}`}
                      onPress={() => openAction(action)}
                      disabled={offlineMode || actionBusy}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: offlineMode || actionBusy }}
                      style={[
                        styles.taskAction,
                        {
                          backgroundColor: action.code === 'reject' ? 'transparent' : tokens.primary,
                          borderColor: action.code === 'reject' ? tokens.error : tokens.primary,
                          opacity: offlineMode || actionBusy ? 0.5 : 1,
                        },
                      ]}
                    >
                      <Text style={[styles.taskActionText, { color: action.code === 'reject' ? tokens.error : '#fff' }]}>{action.label}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </AccountSectionCard>
        </ScrollView></View>
      ) : null}
      tokens={tokens}
      onBack={goBack}
      refreshing={refreshing}
      onRefresh={offlineMode ? undefined : () => { void loadTask(true); }}
    >
      {offlineMode ? <Text accessibilityRole="alert" style={[styles.warning, { color: tokens.warning }]}>Автономный режим: обновление, файлы и действия 1С отключены.</Text> : null}
      {loading && !task ? <AccountLoading tokens={tokens} /> : !task ? (
        <AccountSectionCard tokens={tokens} title="Карточка недоступна" description={error || 'Задание не найдено.'}>
          {correlationId ? <Text selectable style={[styles.correlation, { color: tokens.textSecondary }]}>Код обращения: {correlationId}</Text> : null}
          <Pressable onPress={() => { void loadTask(); }} disabled={offlineMode} accessibilityRole="button" style={[styles.retry, { borderColor: tokens.border }]}>
            <Text style={[styles.retryText, { color: tokens.primary }]}>Повторить</Text>
          </Pressable>
        </AccountSectionCard>
      ) : (
        <>
          <View style={[styles.hero, { backgroundColor: tokens.panelSolid, borderColor: isDocflowTaskOverdue(task) ? tokens.error : tokens.borderSoft }]}>
            <View style={[styles.heroIcon, { backgroundColor: task.completed ? tokens.selected : tokens.accentSoft }]}>
              <MaterialCommunityIcons name={task.completed ? 'check-circle-outline' : 'file-document-outline'} size={25} color={task.completed ? tokens.success : tokens.primary} />
            </View>
            <View style={styles.heroBody}>
              <Text style={[styles.overline, { color: tokens.textSecondary }]}>{task.process_type_label || task.task_type_label || 'Задание 1С'}</Text>
              <Text selectable style={[styles.title, { color: tokens.textPrimary }]}>{task.title}</Text>
              <Text style={{ color: isDocflowTaskOverdue(task) ? tokens.error : tokens.textSecondary }}>Срок: {formatDocflowDate(task.due_at)}</Text>
              <Text style={[styles.status, { color: task.completed ? tokens.success : tokens.primary }]}>{docflowTaskStatus(task)}</Text>
            </View>
          </View>

          {error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text> : null}
          {relatedError ? <Text accessibilityRole="alert" style={[styles.warning, { color: tokens.warning }]}>{relatedError}</Text> : null}
          {actionNotice ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.success }]}>{actionNotice}</Text> : null}
          {enriching ? <Text accessibilityLiveRegion="polite" style={[styles.enriching, { color: tokens.textSecondary }]}>Загружаем связанные документы и файлы…</Text> : null}

          <AccountSectionCard tokens={tokens} title="Описание">
            {splitDocflowDescription(task.description).length ? splitDocflowDescription(task.description).map((paragraph, index) => (
              <Text key={`${index}-${paragraph.slice(0, 20)}`} selectable style={[styles.paragraph, { color: tokens.textPrimary }]}>{paragraph}</Text>
            )) : <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>Описание в 1С не указано.</Text>}
          </AccountSectionCard>

          <AccountSectionCard tokens={tokens} collapsible title="Сведения">
            {[
              ['Автор', task.author],
              ['Поставлено', formatDocflowDate(task.created_at)],
              ['Срок исполнения', formatDocflowDate(task.due_at)],
              ['Выполнено', formatDocflowDate(task.completed_at)],
              ['Результат', task.result],
              ['Состояние', task.business_state],
              ['Важность', task.importance],
            ].filter((entry) => entry[1]).map(([label, value]) => (
              <View key={label} style={styles.field}>
                <Text style={[styles.fieldLabel, { color: tokens.textSecondary }]}>{label}</Text>
                <Text selectable style={[styles.fieldValue, { color: tokens.textPrimary }]}>{value}</Text>
              </View>
            ))}
          </AccountSectionCard>

          {task.related_objects.length ? (
            <AccountSectionCard tokens={tokens} collapsible title={task.related_objects.length === 1 ? 'Связанный документ' : 'Связанные документы'}>
              {task.related_objects.map((item) => (
                <View key={item.ref} style={[styles.related, { borderColor: tokens.primary }]}>
                  <Text style={[styles.relatedType, { color: tokens.textSecondary }]}>{item.object_type_label || 'Документ 1С'}</Text>
                  <Text selectable style={[styles.relatedTitle, { color: tokens.textPrimary }]}>{item.title}</Text>
                </View>
              ))}
            </AccountSectionCard>
          ) : null}

          <AccountSectionCard tokens={tokens} collapsible title={`Файлы · ${task.files.length}`} description="Файлы открываются с вашими правами доступа 1С.">
            {fileError ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{fileError}</Text> : null}
            {task.files.length ? task.files.map((file) => {
              const busy = fileBusy.endsWith(`-${file.ref}`);
              return (
                <View key={file.ref} style={[styles.file, { borderColor: tokens.borderSoft }]}>
                  <MaterialCommunityIcons name="file-outline" size={23} color={tokens.primary} />
                  <View style={styles.fileBody}>
                    <Text numberOfLines={2} style={[styles.fileName, { color: tokens.textPrimary }]}>{file.name}</Text>
                    <Text style={[styles.fileMeta, { color: tokens.textSecondary }]}>{busy && fileProgress != null ? `${Math.round(fileProgress * 100)}%` : formatDocflowFileSize(file.size)}</Text>
                  </View>
                  {busy ? (
                    <Pressable testID={`native-docflow-file-cancel-${file.ref}`} onPress={() => fileAbortRef.current?.abort()} accessibilityRole="button" accessibilityLabel={`Отменить скачивание ${file.name}`} style={styles.fileAction}>
                      <MaterialCommunityIcons name="close" size={21} color={tokens.error} />
                    </Pressable>
                  ) : (
                    <>
                      <Pressable testID={`native-docflow-file-open-${file.ref}`} onPress={() => { void handleFile(file, file.preview_supported ? 'preview' : 'open'); }} disabled={offlineMode || Boolean(fileBusy)} accessibilityRole="button" accessibilityLabel={`${file.preview_supported ? 'Предпросмотр' : 'Открыть'} ${file.name}`} style={styles.fileAction}>
                        <MaterialCommunityIcons name={file.preview_supported ? 'eye-outline' : 'open-in-new'} size={20} color={tokens.primary} />
                      </Pressable>
                      <Pressable testID={`native-docflow-file-share-${file.ref}`} onPress={() => { void handleFile(file, 'share'); }} disabled={offlineMode || Boolean(fileBusy)} accessibilityRole="button" accessibilityLabel={`Поделиться ${file.name}`} style={styles.fileAction}>
                        <MaterialCommunityIcons name="share-variant-outline" size={20} color={tokens.primary} />
                      </Pressable>
                    </>
                  )}
                </View>
              );
            }) : <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>К этому заданию файлы не прикреплены.</Text>}
          </AccountSectionCard>

        </>
      )}

      <Modal
        visible={Boolean(selectedAction)}
        transparent
        animationType="slide"
        onRequestClose={() => { if (!actionBusy) setSelectedAction(null); }}
      >
        <KeyboardAvoidingView
          testID="native-docflow-action-keyboard-avoiding"
          style={styles.modalRoot}
          behavior={docflowKeyboardAvoidingBehavior(Platform.OS)}
        >
          <Pressable accessibilityRole="button" accessibilityLabel="Закрыть подтверждение действия" style={styles.scrim} onPress={() => { if (!actionBusy) setSelectedAction(null); }} />
          {selectedAction ? (
            <View accessibilityViewIsModal style={[styles.actionSheet, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderStrong }]}>
              <View style={styles.sheetHeader}>
                <View style={styles.commandBody}>
                  <Text style={[styles.sheetTitle, { color: tokens.textPrimary }]}>Подтвердите действие</Text>
                  <Text style={[styles.sheetSubtitle, { color: tokens.textSecondary }]}>Изменение будет отправлено в 1С от вашего имени.</Text>
                </View>
                <Pressable onPress={() => { if (!actionBusy) setSelectedAction(null); }} disabled={actionBusy} accessibilityRole="button" accessibilityLabel="Закрыть" style={styles.fileAction}>
                  <MaterialCommunityIcons name="close" size={22} color={tokens.iconMuted} />
                </Pressable>
              </View>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                contentContainerStyle={styles.sheetBody}
              >
                <Text style={[styles.selectedActionLabel, { color: tokens.textPrimary }]}>{selectedAction.label}</Text>
                <HubTextField
                  testID="native-docflow-action-comment"
                  label={docflowActionRequiresComment(selectedAction) ? 'Комментарий или результат *' : 'Комментарий или результат'}
                  value={actionComment}
                  onChangeText={(value) => { setActionComment(value.slice(0, 2_000)); setActionError(''); }}
                  multiline
                  numberOfLines={4}
                  maxLength={2_000}
                  disabled={actionBusy}
                />
                {actionError ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{actionError}</Text> : null}
              </ScrollView>
              <View
                testID="native-docflow-action-footer"
                style={[
                  styles.sheetFooter,
                  {
                    borderTopColor: tokens.borderSoft,
                    paddingBottom: Math.max(modalBottomInset, 12),
                  },
                ]}
              >
                <Pressable
                  testID="native-docflow-action-confirm"
                  onPress={() => { void submitAction(); }}
                  disabled={actionBusy || offlineMode}
                  accessibilityRole="button"
                  accessibilityState={{ busy: actionBusy, disabled: actionBusy || offlineMode }}
                  style={[styles.webAction, { backgroundColor: selectedAction.code === 'reject' ? tokens.error : tokens.primary, opacity: actionBusy || offlineMode ? 0.5 : 1 }]}
                >
                  {actionBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.webActionText}>{selectedAction.label}</Text>}
                </Pressable>
              </View>
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </Modal>
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  headerAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  warning: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  error: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  correlation: { fontSize: 10 },
  retry: { minHeight: 44, marginTop: 10, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontSize: 13, fontWeight: '800' },
  hero: { borderRadius: 17, borderWidth: 1, padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  heroIcon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  heroBody: { flex: 1, minWidth: 0 },
  overline: { fontSize: 10, lineHeight: 14, fontWeight: '800', textTransform: 'uppercase' },
  title: { marginTop: 3, fontSize: 16, lineHeight: 22, fontWeight: '800' },
  status: { marginTop: 6, fontSize: 11, lineHeight: 15, fontWeight: '800' },
  enriching: { fontSize: 11, textAlign: 'center' },
  paragraph: { fontSize: 13, lineHeight: 20, marginBottom: 9 },
  emptyText: { fontSize: 12, lineHeight: 17 },
  field: { marginBottom: 11 },
  fieldLabel: { fontSize: 11, fontWeight: '700' },
  fieldValue: { marginTop: 3, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  related: { borderLeftWidth: 3, paddingLeft: 10, marginBottom: 11 },
  relatedType: { fontSize: 10, lineHeight: 14, textTransform: 'uppercase' },
  relatedTitle: { marginTop: 3, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  file: { minHeight: 64, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 9 },
  fileBody: { flex: 1, minWidth: 0 },
  fileName: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  fileMeta: { marginTop: 2, fontSize: 10 },
  fileAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  notice: { marginBottom: 8, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  actionList: { gap: 8 },
  taskAction: { minHeight: 46, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  taskActionText: { fontSize: 13, lineHeight: 18, fontWeight: '800', textAlign: 'center' },
  commandStatus: { borderWidth: 1, borderRadius: 14, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 },
  commandBody: { flex: 1, minWidth: 0 },
  commandTitle: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  commandText: { marginTop: 2, fontSize: 11, lineHeight: 16 },
  checkAction: { minHeight: 44, borderRadius: 11, borderWidth: 1, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  checkActionText: { fontSize: 11, fontWeight: '800' },
  webAction: { minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  webActionText: { color: '#fff', fontSize: 13, fontWeight: '800', textAlign: 'center' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.48)' },
  actionSheet: { maxHeight: '82%', borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, overflow: 'hidden' },
  sheetHeader: { minHeight: 62, paddingLeft: 16, paddingRight: 6, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sheetTitle: { fontSize: 18, lineHeight: 24, fontWeight: '900' },
  sheetSubtitle: { marginTop: 2, fontSize: 12, lineHeight: 17 },
  sheetBody: { padding: 16, paddingTop: 4, gap: 12, paddingBottom: 12 },
  sheetFooter: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 12 },
  selectedActionLabel: { fontSize: 15, lineHeight: 20, fontWeight: '800' },
});
