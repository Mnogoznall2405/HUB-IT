import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TEMPLATE_FIELD_TYPES,
  buildTemplateEditorPreview,
  buildTemplateEditorState,
  buildTemplatePayload,
  buildTemplateVariableHints,
  makeTemplateField,
  normalizeTemplateFieldKey,
  normalizeTemplateFieldOptions,
} from './mailTemplateModel';

export default function useMailTemplateEditor({
  mailAPI,
  canManageTemplates = false,
  onError,
  onMessage,
} = {}) {
  const [templates, setTemplates] = useState([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateEditId, setTemplateEditId] = useState('');
  const [templateCode, setTemplateCode] = useState('');
  const [templateTitle, setTemplateTitle] = useState('');
  const [templateCategory, setTemplateCategory] = useState('');
  const [templateSubject, setTemplateSubject] = useState('');
  const [templateBody, setTemplateBody] = useState('');
  const [templateFields, setTemplateFields] = useState([]);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateDeleting, setTemplateDeleting] = useState(false);

  const templatesInitRef = useRef(false);
  const templatesLoadedRef = useRef(false);

  const templateVariableHints = useMemo(
    () => buildTemplateVariableHints(templateFields),
    [templateFields]
  );
  const templateEditorPreview = useMemo(() => buildTemplateEditorPreview({
    subject: templateSubject,
    body: templateBody,
    fields: templateFields,
  }), [templateSubject, templateBody, templateFields]);

  const refreshTemplates = useCallback(async () => {
    try {
      const data = await mailAPI.getTemplates({ include_inactive: canManageTemplates ? true : undefined });
      const nextItems = Array.isArray(data?.items) ? data.items : [];
      setTemplates(nextItems);
      templatesLoadedRef.current = true;
      return nextItems;
    } catch (requestError) {
      onError?.(requestError?.response?.data?.detail || 'Не удалось загрузить шаблоны IT-заявок.');
      return [];
    }
  }, [canManageTemplates, mailAPI, onError]);

  const ensureTemplatesLoaded = useCallback(async () => {
    if (templatesLoadedRef.current) return templates;
    return refreshTemplates();
  }, [refreshTemplates, templates]);

  const openTemplatesDialog = useCallback(() => {
    setTemplatesOpen(true);
  }, []);

  const closeTemplatesDialog = useCallback(() => {
    setTemplatesOpen(false);
  }, []);

  const startCreateTemplate = useCallback(() => {
    setTemplateEditId('');
    setTemplateCode('');
    setTemplateTitle('');
    setTemplateCategory('');
    setTemplateSubject('');
    setTemplateBody('');
    setTemplateFields([]);
  }, []);

  const startEditTemplate = useCallback((template) => {
    if (!template || typeof template !== 'object') {
      startCreateTemplate();
      return;
    }
    const state = buildTemplateEditorState(template);
    setTemplateEditId(state.editId);
    setTemplateCode(state.code);
    setTemplateTitle(state.title);
    setTemplateCategory(state.category);
    setTemplateSubject(state.subject);
    setTemplateBody(state.body);
    setTemplateFields(state.fields);
  }, [startCreateTemplate]);

  const addTemplateField = useCallback(() => {
    setTemplateFields((prev) => [...prev, makeTemplateField(prev.length)]);
  }, []);

  const moveTemplateField = useCallback((index, direction) => {
    setTemplateFields((prev) => {
      const from = Number(index);
      const delta = Number(direction);
      const to = from + delta;
      if (from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
      const next = [...prev];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }, []);

  const removeTemplateField = useCallback((index) => {
    setTemplateFields((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  }, []);

  const updateTemplateField = useCallback((index, patch) => {
    setTemplateFields((prev) => prev.map((field, itemIndex) => {
      if (itemIndex !== index) return field;
      return {
        ...field,
        ...(patch || {}),
      };
    }));
  }, []);

  const saveTemplate = useCallback(async () => {
    const { error: templateError, payload } = buildTemplatePayload({
      code: templateCode,
      title: templateTitle,
      category: templateCategory,
      subject: templateSubject,
      body: templateBody,
      fields: templateFields,
    });
    if (templateError) {
      onError?.(templateError);
      return;
    }

    setTemplateSaving(true);
    try {
      const saved = templateEditId
        ? await mailAPI.updateTemplate(templateEditId, payload)
        : await mailAPI.createTemplate(payload);
      await refreshTemplates();
      startEditTemplate(saved);
      onMessage?.(templateEditId ? 'Шаблон обновлен.' : 'Шаблон создан.');
    } catch (requestError) {
      onError?.(requestError?.response?.data?.detail || 'Не удалось сохранить шаблон.');
    } finally {
      setTemplateSaving(false);
    }
  }, [
    mailAPI,
    onError,
    onMessage,
    refreshTemplates,
    startEditTemplate,
    templateBody,
    templateCategory,
    templateCode,
    templateEditId,
    templateFields,
    templateSubject,
    templateTitle,
  ]);

  const deleteTemplate = useCallback(async () => {
    if (!templateEditId) return;
    setTemplateDeleting(true);
    try {
      await mailAPI.deleteTemplate(templateEditId);
      await refreshTemplates();
      startCreateTemplate();
      onMessage?.('Шаблон деактивирован.');
    } catch (requestError) {
      onError?.(requestError?.response?.data?.detail || 'Не удалось удалить шаблон.');
    } finally {
      setTemplateDeleting(false);
    }
  }, [mailAPI, onError, onMessage, refreshTemplates, startCreateTemplate, templateEditId]);

  useEffect(() => {
    if (!templatesOpen) {
      templatesInitRef.current = false;
      return;
    }
    if (!templatesLoadedRef.current) {
      refreshTemplates();
      return;
    }
    if (templatesInitRef.current) return;
    templatesInitRef.current = true;
    if (!templateEditId) {
      if (templates.length > 0) startEditTemplate(templates[0]);
      else startCreateTemplate();
    }
  }, [templatesOpen, templateEditId, templates, startEditTemplate, startCreateTemplate, refreshTemplates]);

  const dialogProps = useMemo(() => ({
    open: templatesOpen,
    onClose: closeTemplatesDialog,
    templates,
    startCreateTemplate,
    templateEditId,
    startEditTemplate,
    templateCode,
    setTemplateCode,
    templateTitle,
    setTemplateTitle,
    templateCategory,
    setTemplateCategory,
    templateSubject,
    setTemplateSubject,
    templateBody,
    setTemplateBody,
    addTemplateField,
    templateFields,
    moveTemplateField,
    removeTemplateField,
    updateTemplateField,
    normalizeFieldKey: normalizeTemplateFieldKey,
    normalizeFieldOptions: normalizeTemplateFieldOptions,
    fieldTypes: TEMPLATE_FIELD_TYPES,
    templateVariableHints,
    templateEditorPreview,
    saveTemplate,
    templateSaving,
    deleteTemplate,
    templateDeleting,
  }), [
    addTemplateField,
    closeTemplatesDialog,
    deleteTemplate,
    moveTemplateField,
    removeTemplateField,
    saveTemplate,
    startCreateTemplate,
    startEditTemplate,
    templateBody,
    templateCategory,
    templateCode,
    templateDeleting,
    templateEditId,
    templateEditorPreview,
    templateFields,
    templateSaving,
    templateSubject,
    templateTitle,
    templateVariableHints,
    templates,
    templatesOpen,
    updateTemplateField,
  ]);

  return {
    templates,
    templatesOpen,
    dialogProps,
    refreshTemplates,
    ensureTemplatesLoaded,
    openTemplatesDialog,
    closeTemplatesDialog,
  };
}
