import type { DocflowTaskDetail } from '../api/docflowApi';
import {
  buildDocflowAssignmentDueAt,
  defaultDocflowAssignmentDueFields,
  docflowTaskStatus,
  formatDocflowFileSize,
  isDocflowTaskOverdue,
  splitDocflowDescription,
} from './nativeDocflowModel';

const task = {
  ref: 'task-1', task_type: '', task_type_label: '', title: 'Task', number: null,
  created_at: null, due_at: '2026-01-01T10:00:00Z', author: null, subject: null,
  description: null, result: null, business_state: null, importance: null, accepted: false,
  completed_at: null, completed: false, xdto_task_type: null, process_name: null,
  process_ref: null, process_type: null, process_type_label: null, xdto_process_type: null,
  dm_version: null, configuration_fingerprint: null, state_token: null, available_actions: [],
  action_unavailable_reason: null, requires_digital_signature: false, open_in_1c_url: null,
  related_objects: [], files: [], files_incomplete: false,
} satisfies DocflowTaskDetail;

it('formats task state, size and overdue without inferring 1C actions', () => {
  expect(docflowTaskStatus(task)).toBe('Новое');
  expect(isDocflowTaskOverdue(task, new Date('2026-02-01T00:00:00Z').getTime())).toBe(true);
  expect(formatDocflowFileSize(1_536)).toBe('1.5 КБ');
});

it('preserves explicit paragraphs in long 1C descriptions', () => {
  expect(splitDocflowDescription('Первый абзац\n\nВторой абзац')).toEqual(['Первый абзац', 'Второй абзац']);
  expect(splitDocflowDescription('')).toEqual([]);
});

it('builds a valid local assignment due date and rejects impossible values', () => {
  expect(defaultDocflowAssignmentDueFields(new Date(2026, 7, 24, 18, 30))).toEqual({ date: '2026-08-25', time: '12:00' });
  expect(buildDocflowAssignmentDueAt('2026-08-25', '18:30')).toBe('2026-08-25T18:30:00');
  expect(buildDocflowAssignmentDueAt('2026-02-30', '18:30')).toBeNull();
  expect(buildDocflowAssignmentDueAt('2026-08-25', '25:00')).toBeNull();
});
