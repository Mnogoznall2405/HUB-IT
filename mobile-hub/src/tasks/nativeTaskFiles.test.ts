import { TASK_FILE_MAX_BYTES, taskAttachmentPath } from './nativeTaskFiles';

it('builds an encoded task attachment path', () => {
  expect(taskAttachmentPath('task/1', 'file 2')).toBe('/hub/tasks/task%2F1/attachments/file%202/file');
});

it('keeps the mobile limit aligned with the backend task file contract', () => {
  expect(TASK_FILE_MAX_BYTES).toBe(20 * 1024 * 1024);
});

it('rejects an incomplete attachment address', () => {
  expect(() => taskAttachmentPath('', 'file-1')).toThrow('Не выбран файл задачи');
});
