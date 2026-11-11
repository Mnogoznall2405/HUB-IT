import { taskAttachmentPath } from './nativeTaskFiles';

it('builds an encoded task attachment path', () => {
  expect(taskAttachmentPath('task/1', 'file 2')).toBe('/hub/tasks/task%2F1/attachments/file%202/file');
});

it('rejects an incomplete attachment address', () => {
  expect(() => taskAttachmentPath('', 'file-1')).toThrow('Не выбран файл задачи');
});
