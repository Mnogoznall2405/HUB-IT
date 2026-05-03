import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { equipmentAPI } from '../../api/client';
import { normalizeDbId } from './databaseRecordModel';
import {
  buildUploadActCommitPayload,
  buildUploadActDraftFormState,
  buildUploadActEmailDefaults,
  buildUploadActEmailResultState,
  buildUploadActInvVerification,
  buildUploadActParseErrorMessage,
  buildUploadActSelectedEmailPayload,
  clearUploadActReminderSearch,
  createEmptyUploadActEmailSummary,
  getUploadActAutoEmailEmployees,
  getUploadActEmailErrorMessage,
  getUploadActReminderDeepLinkAction,
  isApiUnavailableForActParseError,
  isUploadActCommitDisabled,
  parseUploadActReminderDeepLink,
  validateUploadActPdfFile,
} from './uploadAct';

const noop = () => {};

const createUploadActInitialForm = () => ({
  document_title: '',
  from_employee: '',
  to_employee: '',
  doc_date: '',
  equipment_inv_nos_text: '',
});

export function useDatabaseUploadActWorkflow({
  canDatabaseWrite = false,
  dbName = '',
  location = { pathname: '', search: '' },
  navigate = noop,
  searchOwnersCached = noop,
  notifyDatabaseSuccess = noop,
  notifyDatabaseInfo = noop,
  notifyDatabaseWarning = noop,
  getEmailStatusItemSx = noop,
} = {}) {
  const [uploadActModalOpen, setUploadActModalOpen] = useState(false);
  const [uploadActReminderBinding, setUploadActReminderBinding] = useState(null);
  const [uploadActPendingDeepLink, setUploadActPendingDeepLink] = useState(null);
  const [uploadActReminderLoading, setUploadActReminderLoading] = useState(false);
  const [uploadActReminderError, setUploadActReminderError] = useState('');
  const [uploadActFile, setUploadActFile] = useState(null);
  const [uploadActPreviewUrl, setUploadActPreviewUrl] = useState('');
  const [uploadActPreviewError, setUploadActPreviewError] = useState('');
  const [uploadActDraft, setUploadActDraft] = useState(null);
  const [uploadActParsing, setUploadActParsing] = useState(false);
  const [uploadActCommitting, setUploadActCommitting] = useState(false);
  const [uploadActError, setUploadActError] = useState('');
  const [uploadActInvVerified, setUploadActInvVerified] = useState(false);
  const [uploadActAutoEmail, setUploadActAutoEmail] = useState(true);
  const uploadActAutoEmailRef = useRef(true);
  const uploadActReminderLinkRef = useRef('');
  const [uploadActForm, setUploadActForm] = useState(createUploadActInitialForm);
  const [uploadActCommitResult, setUploadActCommitResult] = useState(null);
  const [uploadActEmailSubject, setUploadActEmailSubject] = useState('');
  const [uploadActEmailBody, setUploadActEmailBody] = useState('');
  const [uploadActEmailRecipientsInput, setUploadActEmailRecipientsInput] = useState('');
  const [uploadActEmailRecipientOptions, setUploadActEmailRecipientOptions] = useState([]);
  const [uploadActEmailRecipients, setUploadActEmailRecipients] = useState([]);
  const [uploadActEmailRecipientsLoading, setUploadActEmailRecipientsLoading] = useState(false);
  const [uploadActEmailLoading, setUploadActEmailLoading] = useState(false);
  const [uploadActEmailError, setUploadActEmailError] = useState('');
  const [uploadActEmailStatus, setUploadActEmailStatus] = useState('');
  const [uploadActEmailLastRecipients, setUploadActEmailLastRecipients] = useState([]);
  const [uploadActEmailSummary, setUploadActEmailSummary] = useState(createEmptyUploadActEmailSummary);

  useEffect(() => {
    uploadActAutoEmailRef.current = uploadActAutoEmail;
  }, [uploadActAutoEmail]);

  const uploadActStep = useMemo(() => {
    if (uploadActCommitResult?.doc_no) return 4;
    if (uploadActCommitting) return 3;
    if (uploadActDraft) return 2;
    if (uploadActFile) return 1;
    return 0;
  }, [uploadActCommitResult?.doc_no, uploadActCommitting, uploadActDraft, uploadActFile]);

  const uploadActInvVerification = useMemo(
    () => buildUploadActInvVerification(uploadActDraft?.equipment_inv_nos, uploadActForm.equipment_inv_nos_text),
    [uploadActDraft?.equipment_inv_nos, uploadActForm.equipment_inv_nos_text]
  );

  useEffect(() => {
    if (!uploadActModalOpen || !uploadActCommitResult?.doc_no) return undefined;

    const query = String(uploadActEmailRecipientsInput || '').trim();
    if (query.length < 2) {
      setUploadActEmailRecipientOptions([]);
      setUploadActEmailRecipientsLoading(false);
      return undefined;
    }

    let canceled = false;
    setUploadActEmailRecipientsLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await searchOwnersCached(query, 20);
        if (canceled) return;
        const owners = Array.isArray(response?.owners) ? response.owners : [];
        setUploadActEmailRecipientOptions(owners);
      } catch (error) {
        console.error('Error searching uploaded-act recipients:', error);
        if (!canceled) {
          setUploadActEmailRecipientOptions([]);
        }
      } finally {
        if (!canceled) {
          setUploadActEmailRecipientsLoading(false);
        }
      }
    }, 280);

    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [uploadActModalOpen, uploadActCommitResult?.doc_no, uploadActEmailRecipientsInput, searchOwnersCached]);

  const clearUploadActReminderQuery = useCallback(() => {
    const nextSearch = clearUploadActReminderSearch(location.search);
    if (nextSearch === null) return;
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch,
      },
      { replace: true }
    );
  }, [location.pathname, location.search, navigate]);

  const loadTransferReminder = useCallback(async (reminderId, { silent = false } = {}) => {
    const normalizedReminderId = String(reminderId || '').trim();
    if (!normalizedReminderId) return null;
    setUploadActReminderLoading(true);
    setUploadActReminderError('');
    try {
      const payload = await equipmentAPI.getTransferReminder(normalizedReminderId);
      setUploadActReminderBinding(payload || null);
      return payload || null;
    } catch (error) {
      const apiDetail = error?.response?.data?.detail;
      const message = typeof apiDetail === 'string' ? apiDetail : 'Не удалось загрузить напоминание по акту.';
      setUploadActReminderError(message);
      if (!silent) {
        notifyDatabaseWarning(message);
      }
      return null;
    } finally {
      setUploadActReminderLoading(false);
    }
  }, [notifyDatabaseWarning]);

  const openUploadActReminderTask = useCallback((taskId) => {
    const normalizedTaskId = String(taskId || '').trim();
    if (!normalizedTaskId) return;
    navigate(`/tasks?task=${encodeURIComponent(normalizedTaskId)}`);
  }, [navigate]);

  const refreshUploadActReminderStatus = useCallback((reminderId) => {
    const normalizedReminderId = String(reminderId || '').trim();
    if (!normalizedReminderId) return;
    void loadTransferReminder(normalizedReminderId);
  }, [loadTransferReminder]);

  const updateUploadActFormField = useCallback((field, value) => {
    setUploadActForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const resetUploadActState = useCallback(() => {
    setUploadActReminderBinding(null);
    setUploadActReminderLoading(false);
    setUploadActReminderError('');
    setUploadActFile(null);
    setUploadActPreviewUrl('');
    setUploadActPreviewError('');
    setUploadActDraft(null);
    setUploadActParsing(false);
    setUploadActCommitting(false);
    setUploadActError('');
    setUploadActInvVerified(false);
    setUploadActCommitResult(null);
    setUploadActAutoEmail(true);
    setUploadActEmailSubject('');
    setUploadActEmailBody('');
    setUploadActEmailRecipientsInput('');
    setUploadActEmailRecipientOptions([]);
    setUploadActEmailRecipients([]);
    setUploadActEmailRecipientsLoading(false);
    setUploadActEmailLoading(false);
    setUploadActEmailError('');
    setUploadActEmailStatus('');
    setUploadActEmailLastRecipients([]);
    setUploadActEmailSummary(createEmptyUploadActEmailSummary());
    setUploadActForm(createUploadActInitialForm());
  }, []);

  useEffect(() => {
    if (!uploadActFile) {
      setUploadActPreviewUrl('');
      setUploadActPreviewError('');
      return undefined;
    }

    let objectUrl = '';
    try {
      objectUrl = URL.createObjectURL(uploadActFile);
      setUploadActPreviewUrl(objectUrl);
      setUploadActPreviewError('');
    } catch {
      setUploadActPreviewUrl('');
      setUploadActPreviewError('Не удалось подготовить встроенный просмотр PDF. Откройте файл отдельно.');
    }

    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [uploadActFile]);

  const openUploadActModal = useCallback(() => {
    if (!canDatabaseWrite) return;
    resetUploadActState();
    setUploadActModalOpen(true);
  }, [canDatabaseWrite, resetUploadActState]);

  const openUploadActModalForReminder = useCallback(async ({
    reminderId = '',
    sourceTaskId = '',
  } = {}) => {
    if (!canDatabaseWrite) return;
    const normalizedReminderId = String(reminderId || '').trim();
    const normalizedTaskId = String(sourceTaskId || '').trim();
    resetUploadActState();
    setUploadActModalOpen(true);
    if (normalizedReminderId || normalizedTaskId) {
      setUploadActReminderBinding({
        reminder_id: normalizedReminderId || null,
        task_id: normalizedTaskId || null,
        pending_groups_total: 0,
        completed_groups_total: 0,
        pending_groups: [],
        completed_groups: [],
      });
    }
    if (normalizedReminderId) {
      await loadTransferReminder(normalizedReminderId, { silent: true });
    }
  }, [canDatabaseWrite, loadTransferReminder, resetUploadActState]);

  const closeUploadActModal = useCallback(() => {
    setUploadActModalOpen(false);
    setUploadActPendingDeepLink(null);
    resetUploadActState();
    clearUploadActReminderQuery();
  }, [clearUploadActReminderQuery, resetUploadActState]);

  useEffect(() => {
    setUploadActPendingDeepLink(parseUploadActReminderDeepLink(location.search));
  }, [location.search]);

  useEffect(() => {
    if (uploadActModalOpen) return;
    if (parseUploadActReminderDeepLink(location.search)) return;
    uploadActReminderLinkRef.current = '';
  }, [location.search, uploadActModalOpen]);

  useEffect(() => {
    const resolvedCurrentDbId = normalizeDbId(dbName || '');
    const { action, deepLink } = getUploadActReminderDeepLinkAction({
      search: location.search,
      currentDbId: resolvedCurrentDbId,
      handledSignature: uploadActReminderLinkRef.current,
      isModalOpen: uploadActModalOpen,
    });

    if (!deepLink) {
      setUploadActPendingDeepLink(null);
      return;
    }

    if (!uploadActPendingDeepLink || uploadActPendingDeepLink.signature !== deepLink.signature) {
      setUploadActPendingDeepLink(deepLink);
      return;
    }

    if (action === 'sync_db') {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('selected_database') !== deepLink.dbId) {
        localStorage.setItem('selected_database', deepLink.dbId);
      }
      if (typeof window !== 'undefined' && resolvedCurrentDbId !== deepLink.dbId) {
        window.dispatchEvent(new CustomEvent('database-changed', { detail: { databaseId: deepLink.dbId } }));
      }
      return;
    }

    if (action !== 'open') return;

    uploadActReminderLinkRef.current = deepLink.signature;
    void openUploadActModalForReminder({
      reminderId: deepLink.reminderId,
      sourceTaskId: deepLink.sourceTaskId,
    });
  }, [dbName, location.search, openUploadActModalForReminder, uploadActModalOpen, uploadActPendingDeepLink]);

  const handleUploadActFileSelect = useCallback((event) => {
    const nextFile = event?.target?.files?.[0] || null;
    setUploadActFile(nextFile);
    setUploadActDraft(null);
    setUploadActError('');
    setUploadActInvVerified(false);
  }, []);

  const applyUploadActDraft = useCallback((draft) => {
    setUploadActDraft(draft);
    setUploadActForm(buildUploadActDraftFormState(draft));
    setUploadActError('');
    setUploadActInvVerified(false);
    setUploadActAutoEmail(true);
    uploadActAutoEmailRef.current = true;
  }, []);

  const handleUploadActParse = useCallback(async (manualMode = false) => {
    if (!canDatabaseWrite) {
      setUploadActError('Недостаточно прав для изменения данных.');
      return;
    }
    const fileValidationError = validateUploadActPdfFile(uploadActFile);
    if (fileValidationError) {
      setUploadActError(fileValidationError);
      return;
    }

    setUploadActParsing(true);
    setUploadActError('');
    try {
      const draft = await equipmentAPI.parseUploadedAct(uploadActFile, { manualMode });
      applyUploadActDraft(draft);
      if (manualMode) {
        notifyDatabaseInfo('Черновик создан в ручном режиме. Заполните поля акта и инвентарные номера.');
      }
    } catch (error) {
      if (!manualMode && isApiUnavailableForActParseError(error)) {
        try {
          const fallbackDraft = await equipmentAPI.parseUploadedAct(uploadActFile, { manualMode: true });
          applyUploadActDraft(fallbackDraft);
          notifyDatabaseWarning('OpenRouter недоступен. Создан ручной черновик для заполнения.');
          return;
        } catch (fallbackError) {
          setUploadActError(buildUploadActParseErrorMessage({
            error: fallbackError,
            file: uploadActFile,
            manualMode: true,
          }));
          return;
        }
      }
      setUploadActError(buildUploadActParseErrorMessage({
        error,
        file: uploadActFile,
        manualMode,
      }));
    } finally {
      setUploadActParsing(false);
    }
  }, [
    applyUploadActDraft,
    canDatabaseWrite,
    notifyDatabaseInfo,
    notifyDatabaseWarning,
    uploadActFile,
  ]);

  const openUploadActPreviewInNewTab = useCallback(() => {
    if (!uploadActPreviewUrl) return;
    const openedWindow = window.open(uploadActPreviewUrl, '_blank', 'noopener,noreferrer');
    if (!openedWindow) {
      notifyDatabaseWarning('Не удалось открыть PDF в новой вкладке. Проверьте настройки браузера.');
    }
  }, [notifyDatabaseWarning, uploadActPreviewUrl]);

  const handleUploadActInvNosChange = useCallback((event) => {
    const nextValue = event?.target?.value ?? '';
    setUploadActForm((prev) => ({ ...prev, equipment_inv_nos_text: nextValue }));
    setUploadActInvVerified(false);
  }, []);

  const uploadActCommitDisabled = useMemo(() => (
    isUploadActCommitDisabled({
      hasDraft: Boolean(uploadActDraft),
      hasFinalInvNos: uploadActInvVerification.hasFinalInvNos,
      isParsing: uploadActParsing,
      isCommitting: uploadActCommitting,
      isEmailLoading: uploadActEmailLoading,
      isInventoryVerified: uploadActInvVerified,
    })
  ), [
    uploadActCommitting,
    uploadActDraft,
    uploadActEmailLoading,
    uploadActInvVerification.hasFinalInvNos,
    uploadActInvVerified,
    uploadActParsing,
  ]);

  const handleUploadActCommit = useCallback(async () => {
    if (!canDatabaseWrite) {
      setUploadActError('Недостаточно прав для изменения данных.');
      return;
    }
    const { error, payload } = buildUploadActCommitPayload({
      draft: uploadActDraft,
      form: uploadActForm,
      reminderBinding: uploadActReminderBinding,
    });
    if (error) {
      setUploadActError(error);
      return;
    }

    setUploadActCommitting(true);
    setUploadActError('');
    try {
      const result = await equipmentAPI.commitUploadedActDraft(payload);
      setUploadActCommitResult(result || null);
      const emailDefaults = buildUploadActEmailDefaults(result?.doc_no);
      setUploadActEmailSubject(emailDefaults.subject);
      setUploadActEmailBody(emailDefaults.body);
      setUploadActEmailError('');
      setUploadActEmailStatus('');
      setUploadActEmailLastRecipients([]);
      setUploadActEmailSummary(createEmptyUploadActEmailSummary());

      notifyDatabaseSuccess(`Акт загружен. DOC_NO: ${result?.doc_no}, FILE_NO: ${result?.file_no}.`);

      if (typeof result?.reminder_warning === 'string' && result.reminder_warning.trim()) {
        setUploadActReminderError(result.reminder_warning.trim());
        notifyDatabaseWarning(result.reminder_warning.trim());
      } else {
        setUploadActReminderError('');
      }

      if (String(result?.reminder_status || '').trim() === 'matched_partial') {
        notifyDatabaseInfo(`Подписанный акт привязан к reminder-задаче. Осталось актов: ${Number(result?.reminder_pending_groups || 0)}.`);
      }
      if (String(result?.reminder_status || '').trim() === 'completed') {
        notifyDatabaseSuccess('Все подписанные акты загружены. Reminder-задача закрыта автоматически.');
      }

      const nextReminderId = String(result?.reminder_id || uploadActReminderBinding?.reminder_id || '').trim();
      if (nextReminderId) {
        await loadTransferReminder(nextReminderId, { silent: true });
      }

      const { fromEmployee, toEmployee } = getUploadActAutoEmailEmployees(uploadActForm);
      if (uploadActAutoEmailRef.current && (fromEmployee || toEmployee)) {
        setUploadActEmailLoading(true);
        try {
          const autoEmailDefaults = buildUploadActEmailDefaults(result?.doc_no);
          const autoResult = await equipmentAPI.sendUploadedActEmail({
            doc_no: Number(result?.doc_no),
            mode: 'auto',
            from_employee: fromEmployee || undefined,
            to_employee: toEmployee || undefined,
            subject: autoEmailDefaults.subject,
            body: autoEmailDefaults.body,
          });
          const emailState = buildUploadActEmailResultState(autoResult, { mode: 'auto' });
          setUploadActEmailLastRecipients(emailState.recipients);
          setUploadActEmailSummary(emailState.summary);
          setUploadActEmailStatus(emailState.status);
          if (emailState.error) {
            setUploadActEmailError(emailState.error);
          }
        } catch (error) {
          setUploadActEmailError(
            getUploadActEmailErrorMessage(error, 'Автоотправка не выполнена.')
          );
        } finally {
          setUploadActEmailLoading(false);
        }
      } else {
        setUploadActEmailStatus(
          'Акт сохранён. Укажите сотрудников в блоке ниже и отправьте вручную.'
        );
      }
    } catch (error) {
      const apiDetail = error?.response?.data?.detail;
      setUploadActError(typeof apiDetail === 'string' ? apiDetail : 'Не удалось записать акт в базу.');
    } finally {
      setUploadActCommitting(false);
    }
  }, [
    canDatabaseWrite,
    loadTransferReminder,
    notifyDatabaseInfo,
    notifyDatabaseSuccess,
    notifyDatabaseWarning,
    uploadActDraft,
    uploadActForm,
    uploadActReminderBinding,
  ]);

  const handleUploadActEmailSend = useCallback(async () => {
    if (!canDatabaseWrite) {
      setUploadActEmailError('Недостаточно прав для изменения данных.');
      return;
    }

    const { error, payload } = buildUploadActSelectedEmailPayload({
      commitResult: uploadActCommitResult,
      recipients: uploadActEmailRecipients,
      subject: uploadActEmailSubject,
      body: uploadActEmailBody,
    });
    if (error) {
      setUploadActEmailError(error);
      return;
    }
    if (!payload) return;

    setUploadActEmailLoading(true);
    setUploadActEmailError('');
    setUploadActEmailStatus('');
    try {
      const result = await equipmentAPI.sendUploadedActEmail(payload);
      const emailState = buildUploadActEmailResultState(result, { mode: 'selected' });
      setUploadActEmailLastRecipients(emailState.recipients);
      setUploadActEmailSummary(emailState.summary);
      setUploadActEmailStatus(emailState.status);
      if (emailState.error) {
        setUploadActEmailError(emailState.error);
      }
    } catch (error) {
      setUploadActEmailError(getUploadActEmailErrorMessage(error, 'Ошибка отправки email.'));
    } finally {
      setUploadActEmailLoading(false);
    }
  }, [canDatabaseWrite, uploadActCommitResult, uploadActEmailRecipients, uploadActEmailSubject, uploadActEmailBody]);

  return {
    uploadActModalOpen,
    setUploadActModalOpen,
    uploadActReminderBinding,
    setUploadActReminderBinding,
    uploadActPendingDeepLink,
    setUploadActPendingDeepLink,
    uploadActReminderLoading,
    uploadActReminderError,
    setUploadActReminderError,
    uploadActFile,
    setUploadActFile,
    uploadActPreviewUrl,
    uploadActPreviewError,
    uploadActDraft,
    setUploadActDraft,
    uploadActParsing,
    uploadActCommitting,
    uploadActError,
    setUploadActError,
    uploadActInvVerified,
    setUploadActInvVerified,
    uploadActAutoEmail,
    setUploadActAutoEmail,
    uploadActForm,
    setUploadActForm,
    uploadActCommitResult,
    setUploadActCommitResult,
    uploadActEmailSubject,
    setUploadActEmailSubject,
    uploadActEmailBody,
    setUploadActEmailBody,
    uploadActEmailRecipientsInput,
    setUploadActEmailRecipientsInput,
    uploadActEmailRecipientOptions,
    uploadActEmailRecipients,
    setUploadActEmailRecipients,
    uploadActEmailRecipientsLoading,
    uploadActEmailLoading,
    uploadActEmailError,
    setUploadActEmailError,
    uploadActEmailStatus,
    uploadActEmailLastRecipients,
    uploadActEmailSummary,
    uploadActStep,
    uploadActInvVerification,
    uploadActCommitDisabled,
    clearUploadActReminderQuery,
    loadTransferReminder,
    openUploadActReminderTask,
    refreshUploadActReminderStatus,
    updateUploadActFormField,
    resetUploadActState,
    openUploadActModal,
    openUploadActModalForReminder,
    closeUploadActModal,
    handleUploadActFileSelect,
    applyUploadActDraft,
    handleUploadActParse,
    openUploadActPreviewInNewTab,
    handleUploadActInvNosChange,
    handleUploadActCommit,
    handleUploadActEmailSend,
    getUploadActEmailStatusItemSx: getEmailStatusItemSx,
  };
}

export default useDatabaseUploadActWorkflow;
