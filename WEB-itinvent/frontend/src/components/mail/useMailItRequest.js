import { useCallback, useMemo, useState } from 'react';

export function buildItRequestFieldDefaults(template) {
  const defaults = {};
  (Array.isArray(template?.fields) ? template.fields : []).forEach((field) => {
    const key = String(field?.key || '');
    if (!key) return;
    const defaultValue = field?.default_value;
    defaults[key] = Array.isArray(defaultValue)
      ? defaultValue.join(', ')
      : String(defaultValue ?? '');
  });
  return defaults;
}

export default function useMailItRequest({
  templates = [],
  ensureTemplatesLoaded,
  sendItRequest,
  handleMailCredentialsRequired,
  getMailErrorDetail,
  onError,
  onMessage,
} = {}) {
  const [itOpen, setItOpen] = useState(false);
  const [itTemplateId, setItTemplateId] = useState('');
  const [itFieldValues, setItFieldValues] = useState({});
  const [itSending, setItSending] = useState(false);

  const activeTemplate = useMemo(
    () => (Array.isArray(templates) ? templates : [])
      .find((item) => String(item?.id) === String(itTemplateId)) || null,
    [templates, itTemplateId]
  );

  const openItRequest = useCallback(() => {
    setItOpen(true);
    Promise.resolve(ensureTemplatesLoaded?.()).catch(() => {});
  }, [ensureTemplatesLoaded]);

  const closeItRequest = useCallback(() => {
    setItOpen(false);
  }, []);

  const clearItRequest = useCallback(() => {
    setItTemplateId('');
    setItFieldValues({});
  }, []);

  const selectItTemplate = useCallback((value) => {
    const nextId = String(value || '');
    setItTemplateId(nextId);
    const found = (Array.isArray(templates) ? templates : [])
      .find((item) => String(item?.id) === nextId);
    setItFieldValues(buildItRequestFieldDefaults(found));
  }, [templates]);

  const updateItFieldValue = useCallback((key, value) => {
    const resolvedKey = String(key || '');
    if (!resolvedKey) return;
    setItFieldValues((prev) => ({ ...(prev || {}), [resolvedKey]: value }));
  }, []);

  const submitItRequest = useCallback(async () => {
    if (!itTemplateId) {
      onError?.('Выберите шаблон IT-заявки.');
      return false;
    }
    setItSending(true);
    try {
      await sendItRequest?.({ template_id: itTemplateId, fields: itFieldValues || {} });
      setItOpen(false);
      onMessage?.('IT-заявка отправлена.');
      return true;
    } catch (requestError) {
      if (!(await handleMailCredentialsRequired?.(requestError, 'Не удалось отправить IT-заявку.'))) {
        const detail = getMailErrorDetail
          ? getMailErrorDetail(requestError, 'Не удалось отправить IT-заявку.')
          : (requestError?.response?.data?.detail || 'Не удалось отправить IT-заявку.');
        onError?.(detail);
      }
      return false;
    } finally {
      setItSending(false);
    }
  }, [
    getMailErrorDetail,
    handleMailCredentialsRequired,
    itFieldValues,
    itTemplateId,
    onError,
    onMessage,
    sendItRequest,
  ]);

  return {
    itOpen,
    itTemplateId,
    itFieldValues,
    itSending,
    activeTemplate,
    openItRequest,
    closeItRequest,
    clearItRequest,
    selectItTemplate,
    updateItFieldValue,
    submitItRequest,
  };
}
