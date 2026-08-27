import { nativeDocflowFilePath, nativeDocflowPreviewPath } from './nativeDocflowFiles';

it('builds only an encoded authenticated Docflow content path', () => {
  expect(nativeDocflowFilePath('task/1', 'file 2'))
    .toBe('/docflow/tasks/task%2F1/files/file%202/content?disposition=attachment');
  expect(() => nativeDocflowFilePath('', 'file-1')).toThrow('Не выбран файл');
});

it('builds only an encoded authenticated Docflow preview path', () => {
  expect(nativeDocflowPreviewPath('task/1', 'file 2'))
    .toBe('/docflow/tasks/task%2F1/files/file%202/preview/pdf');
  expect(() => nativeDocflowPreviewPath('task-1', '')).toThrow('Не выбран файл');
});
