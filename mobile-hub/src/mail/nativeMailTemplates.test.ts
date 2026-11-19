import {
  buildTemplateEditorPreview,
  buildTemplateEditorState,
  buildTemplatePayload,
  buildTemplateVariableHints,
  makeTemplateField,
  normalizeTemplateFieldKey,
  normalizeTemplateFieldOptions,
} from './nativeMailTemplates';

describe('normalizeTemplateFieldKey', () => {
  it('normalizes case, spaces and punctuation into a template-safe key', () => {
    expect(normalizeTemplateFieldKey(' System__Name!! ')).toBe('system_name');
    expect(normalizeTemplateFieldKey('EMPLOYEE NAME')).toBe('employee_name');
    expect(normalizeTemplateFieldKey('_field__one_')).toBe('field_one');
    expect(normalizeTemplateFieldKey('a.b-c_d')).toBe('a.b-c_d');
  });

  it('keeps dots and dashes at the edges but strips underscores', () => {
    expect(normalizeTemplateFieldKey('..field.-x')).toBe('..field.-x');
    expect(normalizeTemplateFieldKey('__x__')).toBe('x');
  });

  it('returns an empty string for keys that normalize to nothing', () => {
    expect(normalizeTemplateFieldKey(' Имя Поля ')).toBe('');
    expect(normalizeTemplateFieldKey('')).toBe('');
    expect(normalizeTemplateFieldKey(null)).toBe('');
    expect(normalizeTemplateFieldKey(undefined)).toBe('');
  });
});

describe('normalizeTemplateFieldOptions', () => {
  it('splits strings on newlines and semicolons, trims and dedups in order', () => {
    expect(normalizeTemplateFieldOptions(' a\nb ; a \r\nc;;d ')).toEqual(['a', 'b', 'c', 'd']);
    expect(normalizeTemplateFieldOptions('')).toEqual([]);
    expect(normalizeTemplateFieldOptions(null)).toEqual([]);
  });

  it('normalizes arrays the same way', () => {
    expect(normalizeTemplateFieldOptions([' x ', 'y', 'x', ''])).toEqual(['x', 'y']);
  });
});

describe('makeTemplateField', () => {
  it('builds the same default field as the web editor', () => {
    expect(makeTemplateField(0)).toEqual({
      key: 'field_1',
      label: 'Поле 1',
      type: 'text',
      required: true,
      placeholder: '',
      default_value: '',
      options: [],
    });
    expect(makeTemplateField(2).key).toBe('field_3');
  });
});

describe('buildTemplateEditorState', () => {
  it('returns an empty create-state for a missing template', () => {
    expect(buildTemplateEditorState(null)).toEqual({
      editId: '', code: '', title: '', category: '', subject: '', body: '', fields: [],
    });
  });

  it('maps server fields to editor rows and joins array defaults', () => {
    const state = buildTemplateEditorState({
      id: 'tpl-1',
      code: 'access',
      title: 'Доступ',
      category: 'Доступы',
      subject_template: 'Заявка {{system}}',
      body_template_md: 'Текст',
      is_active: false,
      fields: [
        { key: 'F One', label: 'Поле', type: 'multiselect', required: false, default_value: ['a', 'b'], options: ['a', 'b', 'a'] },
        { key: '', label: '', type: 'checkbox' },
      ],
    });

    expect(state).toMatchObject({ editId: 'tpl-1', code: 'access', subject: 'Заявка {{system}}', body: 'Текст' });
    expect(state.fields[0]).toEqual({
      key: 'f_one', label: 'Поле', type: 'multiselect', required: false,
      placeholder: '', default_value: 'a, b', options: ['a', 'b'],
    });
    expect(state.fields[1].key).toBe('field_2');
    expect(state.fields[1].label).toBe('Поле 2');
    // is_active never leaks into the editor state, so a PATCH can not
    // silently reactivate a deactivated template.
    expect(state).not.toHaveProperty('is_active');
  });
});

describe('buildTemplateVariableHints', () => {
  it('dedups normalized keys', () => {
    expect(buildTemplateVariableHints([
      { key: ' Who ' }, { key: 'who' }, { key: 'item' }, { key: '!!' },
    ])).toEqual(['who', 'item']);
  });
});

describe('buildTemplateEditorPreview', () => {
  it('substitutes defaults and leaves unresolved placeholders as-is', () => {
    const preview = buildTemplateEditorPreview({
      subject: 'Заявка {{ who }}',
      body: 'Нужен {{item}} и {{missing}}',
      fields: [
        { key: 'who', default_value: 'Иван' },
        { key: 'item', default_value: '' },
        { key: 'missing', default_value: 'ноутбук' },
      ],
    });
    expect(preview).toBe('Тема: Заявка Иван\n\nНужен {{item}} и ноутбук');
  });

  it('renders empty parts with the web placeholders', () => {
    expect(buildTemplateEditorPreview({ subject: '', body: '', fields: [] }))
      .toBe('Тема: (без темы)\n\n(пустой текст)');
  });

  it('uses array defaults joined like the request form does', () => {
    const preview = buildTemplateEditorPreview({
      subject: '{{parts}}',
      fields: [{ key: 'parts', default_value: ['ssd', 'ram'] }],
    });
    expect(preview).toBe('Тема: ssd, ram\n\n(пустой текст)');
  });
});

describe('buildTemplatePayload', () => {
  it('reports the web validation errors verbatim', () => {
    expect(buildTemplatePayload({}).error).toBe('Укажите код шаблона.');
    expect(buildTemplatePayload({ code: 'x' }).error).toBe('Укажите название шаблона.');
    expect(buildTemplatePayload({ code: 'x', title: 'y' }).error).toBe('Укажите тему шаблона.');
    expect(buildTemplatePayload({ code: 'x', title: 'y', subject: 's' }).error).toBe('');
  });

  it('normalizes the envelope like the web payload', () => {
    const { error, payload } = buildTemplatePayload({
      code: ' Access ',
      title: ' Доступ ',
      category: ' Доступы ',
      subject: ' Тема ',
      body: 'Текст',
      fields: [],
    });
    expect(error).toBe('');
    expect(payload).toEqual({
      code: 'access',
      title: 'Доступ',
      category: 'Доступы',
      subject_template: 'Тема',
      body_template_md: 'Текст',
      fields: [],
    });
  });

  it('dedups keys with numeric suffixes and falls back to field_<n>', () => {
    const { payload } = buildTemplatePayload({
      code: 'c', title: 't', subject: 's',
      fields: [
        { key: 'dup', label: 'A' },
        { key: 'dup', label: 'B' },
        { key: 'dup', label: 'C' },
        { key: '', label: 'D' },
      ],
    });
    expect(payload?.fields.map((field) => field.key)).toEqual(['dup', 'dup_2', 'dup_3', 'field_4']);
    expect(payload?.fields[1].label).toBe('B');
  });

  it('uses the key as label fallback and required defaults to true', () => {
    const { payload } = buildTemplatePayload({
      code: 'c', title: 't', subject: 's',
      fields: [
        { key: 'a' },
        { key: 'b', required: false },
      ],
    });
    expect(payload?.fields[0]).toMatchObject({ label: 'a', required: true });
    expect(payload?.fields[1]).toMatchObject({ required: false });
  });

  it('coerces checkbox defaults to boolean', () => {
    const { payload } = buildTemplatePayload({
      code: 'c', title: 't', subject: 's',
      fields: [
        { key: 'yes', type: 'checkbox', default_value: 'да' },
        { key: 'on', type: 'checkbox', default_value: 'ON' },
        { key: 'no', type: 'checkbox', default_value: 'off' },
        { key: 'empty', type: 'checkbox', default_value: '' },
      ],
    });
    expect(payload?.fields.map((field) => field.default_value)).toEqual([true, true, false, false]);
  });

  it('coerces multiselect defaults to a deduped options array', () => {
    const { payload } = buildTemplatePayload({
      code: 'c', title: 't', subject: 's',
      fields: [
        { key: 'ms', type: 'multiselect', default_value: 'a;b\na' },
        { key: 'ms2', type: 'multiselect', default_value: ['x', 'x', 'y'] },
        { key: 'sel', type: 'select', default_value: 'один' },
      ],
    });
    expect(payload?.fields[0].default_value).toEqual(['a', 'b']);
    expect(payload?.fields[1].default_value).toEqual(['x', 'y']);
    expect(payload?.fields[2].default_value).toBe('один');
  });

  it('normalizes options into a deduped string list', () => {
    const { payload } = buildTemplatePayload({
      code: 'c', title: 't', subject: 's',
      fields: [{ key: 's', type: 'select', options: ' a \n b ; a ' }],
    });
    expect(payload?.fields[0].options).toEqual(['a', 'b']);
  });

  it('does not carry is_active into the payload', () => {
    const { payload } = buildTemplatePayload({ code: 'c', title: 't', subject: 's', fields: [] });
    expect(payload).not.toHaveProperty('is_active');
  });
});
