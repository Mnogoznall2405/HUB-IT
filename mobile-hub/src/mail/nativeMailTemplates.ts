import type { MailItTemplate, MailItTemplateField, MailItTemplatePayload } from '../api/mailApi';

// Ported verbatim from the web editor (WEB-itinvent/frontend/src/components/mail/mailTemplateModel.js)
// so the native manager UI normalizes template fields exactly like the web dialog.

export const TEMPLATE_FIELD_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'text', label: 'Текст' },
  { value: 'textarea', label: 'Многострочный текст' },
  { value: 'select', label: 'Список' },
  { value: 'multiselect', label: 'Множественный список' },
  { value: 'date', label: 'Дата' },
  { value: 'checkbox', label: 'Флаг' },
  { value: 'email', label: 'Email' },
  { value: 'tel', label: 'Телефон' },
];

export type MailTemplateEditorField = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  placeholder: string;
  default_value: string;
  options: string[];
};

export type MailTemplateEditorState = {
  editId: string;
  code: string;
  title: string;
  category: string;
  subject: string;
  body: string;
  fields: MailTemplateEditorField[];
};

// Loose input shape: the helpers accept raw API fields and partial editor fields
// alike, like the JS original does via `field?.key` access.
export type MailTemplateFieldInput = {
  key?: unknown;
  label?: unknown;
  type?: unknown;
  required?: unknown;
  placeholder?: unknown;
  default_value?: unknown;
  options?: unknown;
};

export function normalizeTemplateFieldKey(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function normalizeTemplateFieldOptions(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value || '').split(/\r?\n|;/);
  const dedup = new Set<string>();
  raw.forEach((item) => {
    const normalized = String(item || '').trim();
    if (normalized) dedup.add(normalized);
  });
  return Array.from(dedup);
}

export function makeTemplateField(index = 0): MailTemplateEditorField {
  return {
    key: `field_${index + 1}`,
    label: `Поле ${index + 1}`,
    type: 'text',
    required: true,
    placeholder: '',
    default_value: '',
    options: [],
  };
}

export function buildTemplateEditorState(template?: MailItTemplate | null): MailTemplateEditorState {
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

export function buildTemplateVariableHints(fields: MailTemplateFieldInput[] = []): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  (Array.isArray(fields) ? fields : []).forEach((field) => {
    const key = normalizeTemplateFieldKey(field?.key);
    if (!key || seen.has(key)) return;
    seen.add(key);
    values.push(key);
  });
  return values;
}

export function buildTemplateEditorPreview({ subject = '', body = '', fields = [] }: {
  subject?: string;
  body?: string;
  fields?: MailTemplateFieldInput[];
} = {}): string {
  const values: Record<string, string> = {};
  buildTemplateVariableHints(fields).forEach((key) => { values[key] = `{{${key}}}`; });
  (Array.isArray(fields) ? fields : []).forEach((field) => {
    const key = normalizeTemplateFieldKey(field?.key);
    if (!key) return;
    const fallback = Array.isArray(field?.default_value)
      ? (field.default_value as unknown[]).join(', ')
      : String(field?.default_value || '');
    if (fallback && values[key] === `{{${key}}}`) values[key] = fallback;
  });
  const render = (text: string) => String(text || '').replace(/\{\{\s*([a-z0-9_.-]+)\s*\}\}/gi, (match, key) => (
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
}: {
  code?: string;
  title?: string;
  category?: string;
  subject?: string;
  body?: string;
  fields?: MailTemplateFieldInput[];
} = {}): { error: string; payload: MailItTemplatePayload | null } {
  const normalizedCode = String(code || '').trim().toLowerCase();
  const normalizedTitle = String(title || '').trim();
  const normalizedSubject = String(subject || '').trim();
  if (!normalizedCode) return { error: 'Укажите код шаблона.', payload: null };
  if (!normalizedTitle) return { error: 'Укажите название шаблона.', payload: null };
  if (!normalizedSubject) return { error: 'Укажите тему шаблона.', payload: null };

  const seenKeys = new Set<string>();
  const fieldsPayload: MailItTemplateField[] = (Array.isArray(fields) ? fields : []).map((field, index) => {
    let key = normalizeTemplateFieldKey(field?.key) || `field_${index + 1}`;
    if (seenKeys.has(key)) {
      let suffix = 2;
      while (seenKeys.has(`${key}_${suffix}`)) suffix += 1;
      key = `${key}_${suffix}`;
    }
    seenKeys.add(key);

    const type = String(field?.type || 'text');
    const options = normalizeTemplateFieldOptions(field?.options);
    let defaultValue: string | string[] | boolean;
    const rawDefault = field?.default_value ?? '';
    if (type === 'multiselect') {
      defaultValue = normalizeTemplateFieldOptions(rawDefault);
    } else if (type === 'checkbox') {
      const normalized = String(rawDefault).trim().toLowerCase();
      defaultValue = ['1', 'true', 'yes', 'on', 'да'].includes(normalized);
    } else {
      defaultValue = String(rawDefault || '');
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
