export const TEMPLATE_FIELD_TYPES = [
  { value: 'text', label: 'Текст' },
  { value: 'textarea', label: 'Многострочный текст' },
  { value: 'select', label: 'Список' },
  { value: 'multiselect', label: 'Множественный список' },
  { value: 'date', label: 'Дата' },
  { value: 'checkbox', label: 'Флаг' },
  { value: 'email', label: 'Email' },
  { value: 'tel', label: 'Телефон' },
];

export const normalizeTemplateFieldKey = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9_.-]/g, '_')
  .replace(/_+/g, '_')
  .replace(/^_+|_+$/g, '');

export const normalizeTemplateFieldOptions = (value) => {
  const raw = Array.isArray(value) ? value : String(value || '').split(/\r?\n|;/);
  const dedup = new Set();
  raw.forEach((item) => {
    const normalized = String(item || '').trim();
    if (normalized) dedup.add(normalized);
  });
  return Array.from(dedup);
};

export const makeTemplateField = (index = 0) => ({
  key: `field_${index + 1}`,
  label: `Поле ${index + 1}`,
  type: 'text',
  required: true,
  placeholder: '',
  default_value: '',
  options: [],
});

export function buildTemplateEditorState(template) {
  if (!template || typeof template !== 'object') {
    return {
      editId: '',
      code: '',
      title: '',
      category: '',
      subject: '',
      body: '',
      fields: [],
    };
  }
  const fields = Array.isArray(template.fields) ? template.fields : [];
  return {
    editId: String(template.id || ''),
    code: String(template.code || ''),
    title: String(template.title || ''),
    category: String(template.category || ''),
    subject: String(template.subject_template || ''),
    body: String(template.body_template_md || ''),
    fields: fields.map((field, index) => ({
      key: normalizeTemplateFieldKey(field?.key) || `field_${index + 1}`,
      label: String(field?.label || `Поле ${index + 1}`),
      type: String(field?.type || 'text'),
      required: Boolean(field?.required ?? true),
      placeholder: String(field?.placeholder || ''),
      default_value: Array.isArray(field?.default_value)
        ? field.default_value.join(', ')
        : String(field?.default_value ?? ''),
      options: normalizeTemplateFieldOptions(field?.options),
    })),
  };
}

export function buildTemplateVariableHints(fields = []) {
  const seen = new Set();
  const values = [];
  (Array.isArray(fields) ? fields : []).forEach((field) => {
    const key = normalizeTemplateFieldKey(field?.key);
    if (!key || seen.has(key)) return;
    seen.add(key);
    values.push(key);
  });
  return values;
}

export function buildTemplateEditorPreview({ subject = '', body = '', fields = [] } = {}) {
  const values = {};
  buildTemplateVariableHints(fields).forEach((key) => { values[key] = `{{${key}}}`; });
  (Array.isArray(fields) ? fields : []).forEach((field) => {
    const key = normalizeTemplateFieldKey(field?.key);
    if (!key) return;
    const fallback = Array.isArray(field?.default_value)
      ? field.default_value.join(', ')
      : String(field?.default_value || '');
    if (fallback && values[key] === `{{${key}}}`) values[key] = fallback;
  });
  const render = (text) => String(text || '').replace(/\{\{\s*([a-z0-9_.-]+)\s*\}\}/gi, (match, key) => (
    values[String(key || '').toLowerCase()] || match
  ));
  const subjectPreview = render(subject);
  const bodyPreview = render(body);
  return `Тема: ${subjectPreview || '(без темы)'}\n\n${bodyPreview || '(пустой текст)'}`;
}

export function buildTemplatePayload({
  code = '',
  title = '',
  category = '',
  subject = '',
  body = '',
  fields = [],
} = {}) {
  const normalizedCode = String(code || '').trim().toLowerCase();
  const normalizedTitle = String(title || '').trim();
  const normalizedSubject = String(subject || '').trim();
  if (!normalizedCode) return { error: 'Укажите код шаблона.', payload: null };
  if (!normalizedTitle) return { error: 'Укажите название шаблона.', payload: null };
  if (!normalizedSubject) return { error: 'Укажите тему шаблона.', payload: null };

  const seenKeys = new Set();
  const fieldsPayload = (Array.isArray(fields) ? fields : []).map((field, index) => {
    let key = normalizeTemplateFieldKey(field?.key) || `field_${index + 1}`;
    if (seenKeys.has(key)) {
      let suffix = 2;
      while (seenKeys.has(`${key}_${suffix}`)) suffix += 1;
      key = `${key}_${suffix}`;
    }
    seenKeys.add(key);

    const type = String(field?.type || 'text');
    const options = normalizeTemplateFieldOptions(field?.options);
    let defaultValue = field?.default_value ?? '';
    if (type === 'multiselect') {
      defaultValue = normalizeTemplateFieldOptions(defaultValue);
    } else if (type === 'checkbox') {
      const normalized = String(defaultValue).trim().toLowerCase();
      defaultValue = ['1', 'true', 'yes', 'on', 'да'].includes(normalized);
    } else {
      defaultValue = String(defaultValue || '');
    }

    return {
      key,
      label: String(field?.label || key),
      type,
      required: Boolean(field?.required ?? true),
      placeholder: String(field?.placeholder || ''),
      default_value: defaultValue,
      options,
    };
  });

  return {
    error: '',
    payload: {
      code: normalizedCode,
      title: normalizedTitle,
      category: String(category || '').trim(),
      subject_template: normalizedSubject,
      body_template_md: String(body || ''),
      fields: fieldsPayload,
    },
  };
}
