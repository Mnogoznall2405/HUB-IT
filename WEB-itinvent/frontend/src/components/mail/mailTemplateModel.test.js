import { describe, expect, it } from 'vitest';
import {
  buildTemplateEditorPreview,
  buildTemplateEditorState,
  buildTemplatePayload,
  buildTemplateVariableHints,
  normalizeTemplateFieldOptions,
} from './mailTemplateModel';

describe('mailTemplateModel', () => {
  it('normalizes template editor state from backend fields', () => {
    expect(buildTemplateEditorState({
      id: 7,
      code: 'Access',
      title: 'Access request',
      category: 'it',
      subject_template: 'Subject',
      body_template_md: 'Body',
      fields: [
        { key: 'Inventory Number', label: '', default_value: ['101795', '101796'], options: 'one; two' },
      ],
    })).toMatchObject({
      editId: '7',
      code: 'Access',
      fields: [
        {
          key: 'inventory_number',
          label: 'Поле 1',
          default_value: '101795, 101796',
          options: ['one', 'two'],
        },
      ],
    });
  });

  it('deduplicates variable hints and renders preview defaults', () => {
    const fields = [
      { key: 'inventory_number', default_value: '101795' },
      { key: 'Inventory Number', default_value: 'duplicate' },
    ];

    expect(buildTemplateVariableHints(fields)).toEqual(['inventory_number']);
    expect(buildTemplateEditorPreview({
      subject: 'Device {{inventory_number}}',
      body: 'Need help with {{ inventory_number }}',
      fields,
    })).toContain('Device 101795');
  });

  it('builds create/update payload with unique keys and typed defaults', () => {
    const { error, payload } = buildTemplatePayload({
      code: ' ACCESS ',
      title: ' Access request ',
      category: ' it ',
      subject: ' Need access ',
      body: 'Body',
      fields: [
        { key: 'role', label: 'Role', type: 'multiselect', default_value: 'reader; editor', options: 'reader; editor; reader' },
        { key: 'role', label: 'Role copy', type: 'checkbox', default_value: 'да' },
      ],
    });

    expect(error).toBe('');
    expect(payload).toMatchObject({
      code: 'access',
      title: 'Access request',
      category: 'it',
      subject_template: 'Need access',
      fields: [
        { key: 'role', default_value: ['reader', 'editor'], options: ['reader', 'editor'] },
        { key: 'role_2', default_value: true },
      ],
    });
  });

  it('returns validation errors before payload creation', () => {
    expect(buildTemplatePayload({ code: '', title: 'Title', subject: 'Subject' }).error)
      .toBe('Укажите код шаблона.');
    expect(normalizeTemplateFieldOptions(' one ; one \n two ')).toEqual(['one', 'two']);
  });
});
