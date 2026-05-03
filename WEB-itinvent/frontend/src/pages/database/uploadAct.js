import { UPLOADED_ACT_PARSE_TIMEOUT_MS } from '../../api/client';
import { toNumberOrNull } from './databaseRecordModel';

const normalizeDbId = (value) => String(value ?? '').trim();

export const UPLOAD_ACT_MAX_SIZE_MB = 15;
export const UPLOAD_ACT_MAX_SIZE_BYTES = UPLOAD_ACT_MAX_SIZE_MB * 1024 * 1024;

const normalizeInvNoValue = (rawValue) => {
  let normalized = String(rawValue ?? '').trim();
  if (!normalized) return '';
  normalized = normalized.replace(/\s+/g, '').replace(/№/g, '').replace(/^[.,;:|]+|[.,;:|]+$/g, '');
  if (!normalized) return '';
  if (/^\d+[.,]0+$/.test(normalized)) {
    normalized = normalized.split(/[.,]/, 1)[0];
  }
  if (!/^\d+$/.test(normalized)) return '';
  return String(Number.parseInt(normalized, 10));
};

export const parseInvNosInput = (rawValue) => {
  const text = String(rawValue || '');
  const chunks = text.split(/[\s,;]+/g).map((token) => token.trim()).filter(Boolean);
  const invNos = [];
  chunks.forEach((chunk) => {
    const normalized = normalizeInvNoValue(chunk);
    if (normalized && !invNos.includes(normalized)) {
      invNos.push(normalized);
    }
  });
  return invNos;
};

export const buildUploadActDraftFormState = (draft) => ({
  document_title: String(draft?.document_title || '').trim(),
  from_employee: String(draft?.from_employee || '').trim(),
  to_employee: String(draft?.to_employee || '').trim(),
  doc_date: String(draft?.doc_date || '').trim(),
  equipment_inv_nos_text: Array.isArray(draft?.equipment_inv_nos)
    ? draft.equipment_inv_nos.map((invNo) => String(invNo)).join(', ')
    : '',
});

export const buildUploadActCommitPayload = ({ draft, form, reminderBinding } = {}) => {
  const draftId = String(draft?.draft_id || '').trim();
  if (!draftId) {
    return {
      error: 'Черновик не найден. Выполните распознавание снова.',
      payload: null,
    };
  }

  const finalInvNos = parseInvNosInput(form?.equipment_inv_nos_text);
  if (finalInvNos.length === 0) {
    return {
      error: 'Укажите хотя бы один инвентарный номер для привязки акта.',
      payload: null,
    };
  }

  return {
    error: '',
    payload: {
      draft_id: draftId,
      document_title: String(form?.document_title || '').trim() || undefined,
      from_employee: String(form?.from_employee || '').trim() || undefined,
      to_employee: String(form?.to_employee || '').trim() || undefined,
      doc_date: String(form?.doc_date || '').trim() || undefined,
      equipment_inv_nos: finalInvNos,
      source_task_id: String(reminderBinding?.task_id || '').trim() || undefined,
      reminder_id: String(reminderBinding?.reminder_id || '').trim() || undefined,
    },
  };
};

export const getUploadActAutoEmailEmployees = (form) => ({
  fromEmployee: String(form?.from_employee || '').trim(),
  toEmployee: String(form?.to_employee || '').trim(),
});

const uniqueInvNos = (values) => {
  const result = [];
  const seen = new Set();
  (Array.isArray(values) ? values : []).forEach((value) => {
    const normalized = normalizeInvNoValue(value);
    const key = normalized;
    if (!normalized || seen.has(key)) return;
    seen.add(key);
    result.push(normalized);
  });
  return result;
};

const toInvNoList = (value) => {
  if (Array.isArray(value)) return uniqueInvNos(value);
  return parseInvNosInput(value);
};

export const buildUploadActInvVerification = (recognizedInput, finalInput) => {
  const recognizedInvNos = toInvNoList(recognizedInput);
  const finalInvNos = toInvNoList(finalInput);
  const finalKeys = new Set(finalInvNos.map((item) => item.toLowerCase()));
  const recognizedKeys = new Set(recognizedInvNos.map((item) => item.toLowerCase()));
  const commonInvNos = recognizedInvNos.filter((item) => finalKeys.has(item.toLowerCase()));
  const onlyRecognizedInvNos = recognizedInvNos.filter((item) => !finalKeys.has(item.toLowerCase()));
  const onlyFinalInvNos = finalInvNos.filter((item) => !recognizedKeys.has(item.toLowerCase()));
  const hasRecognizedInvNos = recognizedInvNos.length > 0;
  const hasFinalInvNos = finalInvNos.length > 0;
  const hasDifferences = onlyRecognizedInvNos.length > 0 || onlyFinalInvNos.length > 0;

  let severity = 'success';
  let headline = 'Итоговый список совпадает с номерами, найденными API.';

  if (!hasRecognizedInvNos) {
    severity = 'warning';
    headline = 'API не нашёл инвентарные номера. Проверьте введённый список по PDF перед записью.';
  } else if (hasDifferences) {
    severity = 'warning';
    headline = 'Итоговый список отличается от распознанного API. Проверьте номера перед записью.';
  }

  return {
    severity,
    headline,
    hasRecognizedInvNos,
    hasFinalInvNos,
    hasDifferences,
    recognizedInvNos,
    finalInvNos,
    commonInvNos,
    onlyRecognizedInvNos,
    onlyFinalInvNos,
  };
};

const formatUploadActFileSize = (bytes) => {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return '0 МБ';
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`;
};

export const validateUploadActPdfFile = (file) => {
  if (!file) {
    return 'Выберите PDF-файл акта.';
  }

  const fileName = String(file.name || '').toLowerCase();
  if (!fileName.endsWith('.pdf')) {
    return 'Поддерживается только PDF.';
  }

  const size = Number(file.size || 0);
  if (size > UPLOAD_ACT_MAX_SIZE_BYTES) {
    return (
      `PDF слишком большой: ${formatUploadActFileSize(size)}. `
      + `Максимальный размер для акта: ${UPLOAD_ACT_MAX_SIZE_MB} МБ.`
    );
  }

  return '';
};

export const isUploadActParseNetworkError = (error) => !error?.response;

export const isUploadActProxyUnavailableError = (error) => {
  const statusCode = Number(error?.response?.status || 0);
  return [502, 503, 504].includes(statusCode);
};

export const isApiUnavailableForActParseError = (error) => {
  const statusCode = Number(error?.response?.status || 0);
  if (!error?.response) return false;
  const detail = String(error?.response?.data?.detail || error?.message || '').toLowerCase();
  if (isUploadActProxyUnavailableError(error) && !detail) return false;
  return (
    detail.includes('openrouter')
    || detail.includes('api распознавания')
    || detail.includes('распознавание через модель')
    || detail.includes('act_parse_model')
    || detail.includes('ocr_model')
    || detail.includes('timeout')
    || detail.includes('timed out')
  );
};

export const buildUploadActParseErrorMessage = ({
  error,
  file,
  manualMode = false,
  timeoutMs = UPLOADED_ACT_PARSE_TIMEOUT_MS,
} = {}) => {
  const statusCode = Number(error?.response?.status || 0);
  const apiDetail = error?.response?.data?.detail;
  const code = String(error?.code || '').trim();
  const fileSize = formatUploadActFileSize(file?.size || 0);
  const timeoutSec = Math.round(Number(timeoutMs || 0) / 1000);
  const mode = manualMode ? 'manual' : 'auto';
  const technicalDetails = [
    statusCode ? `status=${statusCode}` : 'status=no-response',
    code ? `axios=${code}` : '',
    `timeout=${timeoutSec}s`,
    `file=${fileSize}`,
    `mode=${mode}`,
  ].filter(Boolean).join('; ');

  if (typeof apiDetail === 'string' && apiDetail.trim()) {
    return `Backend вернул ошибку: ${apiDetail.trim()} Технические детали: ${technicalDetails}.`;
  }

  if (isUploadActParseNetworkError(error)) {
    return (
      'Запрос не дошёл до API распознавания или соединение было оборвано. '
      + 'Проверьте размер PDF, сеть и повторите попытку. '
      + `Технические детали: ${technicalDetails}.`
    );
  }

  if (isUploadActProxyUnavailableError(error)) {
    return (
      'Backend или IIS/ARR proxy не вернул ответ для распознавания акта. '
      + 'Обычно это происходит при перезапуске backend или разрыве соединения между IIS и FastAPI. '
      + `Технические детали: ${technicalDetails}.`
    );
  }

  return `Не удалось распознать акт. Технические детали: ${technicalDetails}.`;
};

export const isUploadActCommitDisabled = ({
  hasDraft,
  hasFinalInvNos,
  isParsing,
  isCommitting,
  isEmailLoading,
  isInventoryVerified,
}) => (
  !hasDraft
  || !hasFinalInvNos
  || isParsing
  || isCommitting
  || isEmailLoading
  || !isInventoryVerified
);

export const resolveDataModeRefreshBehavior = ({
  hasInitializedEffect = false,
  isLifecycleReady = false,
}) => {
  if (!hasInitializedEffect) {
    return { shouldRefresh: false, nextHasInitializedEffect: true };
  }

  if (!isLifecycleReady) {
    return { shouldRefresh: false, nextHasInitializedEffect: true };
  }

  return { shouldRefresh: true, nextHasInitializedEffect: true };
};

export const parseUploadActReminderDeepLink = (search = '') => {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  if (params.get('upload_act') !== '1') return null;

  const reminderId = String(params.get('reminder_id') || '').trim();
  const sourceTaskId = String(params.get('source_task_id') || '').trim();
  const dbId = normalizeDbId(params.get('db_id') || '');
  const signature = [reminderId, sourceTaskId, dbId].join('|');

  if (!signature) return null;

  return {
    reminderId,
    sourceTaskId,
    dbId,
    signature,
  };
};

export const clearUploadActReminderSearch = (search = '') => {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  let changed = false;

  ['upload_act', 'reminder_id', 'source_task_id', 'db_id'].forEach((key) => {
    if (params.has(key)) {
      params.delete(key);
      changed = true;
    }
  });

  if (!changed) return null;

  const nextSearch = params.toString();
  return nextSearch ? `?${nextSearch}` : '';
};

export const getUploadActReminderDeepLinkAction = ({
  search = '',
  currentDbId = '',
  handledSignature = '',
  isModalOpen = false,
}) => {
  const deepLink = parseUploadActReminderDeepLink(search);
  if (!deepLink) {
    return { action: 'idle', deepLink: null };
  }

  if (isModalOpen || handledSignature === deepLink.signature) {
    return { action: 'idle', deepLink };
  }

  const normalizedCurrentDbId = normalizeDbId(currentDbId || '');
  if (deepLink.dbId && normalizedCurrentDbId !== deepLink.dbId) {
    return { action: 'sync_db', deepLink };
  }

  return { action: 'open', deepLink };
};

export const createEmptyUploadActEmailSummary = () => ({
  mode: '',
  successCount: 0,
  failedCount: 0,
});

export const buildUploadActEmailDefaults = (docNo) => {
  const normalizedDocNo = String(docNo || '').trim();
  return {
    subject: `Акт №${normalizedDocNo}`.trim(),
    body: `Во вложении акт №${normalizedDocNo}.\n\nПисьмо сформировано автоматически системой IT Invent.`,
  };
};

export const buildUploadActSelectedEmailPayload = ({
  commitResult,
  recipients,
  subject,
  body,
} = {}) => {
  if (!commitResult?.doc_no) {
    return { error: '', payload: null };
  }

  const ownerNos = (Array.isArray(recipients) ? recipients : [])
    .map((owner) => toNumberOrNull(owner?.OWNER_NO ?? owner?.owner_no))
    .filter((ownerNo) => ownerNo !== null);

  if (ownerNos.length === 0) {
    return {
      error: 'Выберите хотя бы одного сотрудника.',
      payload: null,
    };
  }

  return {
    error: '',
    payload: {
      doc_no: Number(commitResult.doc_no),
      mode: 'selected',
      owner_nos: ownerNos,
      subject: String(subject || '').trim() || undefined,
      body: String(body || '').trim() || undefined,
    },
  };
};

export const buildUploadActEmailResultState = (result, { mode = 'selected' } = {}) => {
  const successCount = Number(result?.success_count || 0);
  const failedCount = Number(result?.failed_count || 0);
  const recipients = Array.isArray(result?.recipients) ? result.recipients : [];
  const isAuto = mode === 'auto';

  return {
    recipients,
    summary: {
      mode,
      successCount,
      failedCount,
    },
    status: isAuto
      ? `Автоотправка: отправлено ${successCount}, ошибок ${failedCount}.`
      : `Отправлено: ${successCount}, ошибок: ${failedCount}.`,
    error: failedCount > 0
      ? (
        isAuto
          ? 'Часть писем не отправлена. Проверьте статусы ниже.'
          : 'Часть писем не отправлена. Проверьте список статусов.'
      )
      : '',
  };
};

export const getUploadActEmailErrorMessage = (error, fallback) => {
  const apiDetail = error?.response?.data?.detail;
  return typeof apiDetail === 'string' ? apiDetail : fallback;
};
