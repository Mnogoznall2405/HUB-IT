import React, { useState } from 'react';
import { myFilesAPI } from '../../src/api/myFiles';
import { useMyFilesUpload } from '../../src/pages/myFiles/useMyFilesUpload';
import { useAuth } from '../../src/contexts/AuthContext';
import { useNotification } from '../../src/contexts/NotificationContext';

const loadData = async () => {};
const allFolders = [];

export function UploadResumeHarness() {
  const [result, setResult] = useState('idle');
  const [view, setView] = useState('files');
  const [folderId, setFolderId] = useState(null);
  const { user } = useAuth();
  const notification = useNotification();
  const queue = useMyFilesUpload({ canWrite: Boolean(user), currentFolderId: folderId, isSpecialView: view !== 'files', allFolders, loadData, ...notification });
  return <section>
    <output aria-label="Представление файлов">{view}</output>
    <output aria-label="Диалог загрузки">{queue.uploadDialogOpen ? 'open' : 'closed'}</output>
    <output aria-label="Чтение drop">{String(queue.readingDrop)}</output>
    <output aria-label="Подсветка drop">{String(queue.dragActive)}</output>
    <output aria-label="Подготовленные файлы">{[...queue.pendingUploadFiles, ...queue.pendingFolderFiles].map((file) => file.name).join('|') || 'empty'}</output>
    <input aria-label="Файлы для загрузки" type="file" ref={queue.fileInputRef} onChange={queue.handleInputChange} />
    <button onClick={() => setView('files')}>Мой диск</button>
    <button onClick={() => setView('trash')}>Корзина</button>
    <button onClick={() => setView('recent')}>Недавние</button>
    <button onClick={() => setView('favorites')}>Избранное</button>
    <button onClick={() => setFolderId('folder-b')}>Папка B</button>
    <output aria-label="Очередь загрузки">{queue.uploading ? 'busy' : 'idle'}</output>
    <button onClick={() => queue.openUploadDialog([1, 2, 3].map((index) => new File(['queue'], `private-queue-${index}.bin`, { lastModified: 1000 })))}>Очередь трёх файлов</button>
    <button onClick={queue.confirmUpload}>Подтвердить очередь</button>
    <button onClick={() => {
      const file = new File(['folder'], 'nested.bin');
      Object.defineProperty(file, 'webkitRelativePath', { value: 'root/child/nested.bin' });
      queue.openUploadDialog([file], { asFolder: true });
    }}>Очередь папки</button>
    <output aria-label="Результат загрузки">{result}</output>
    <button onClick={() => {
      const file = new File([new Uint8Array(24).map((_, index) => index)], 'audit-upload.bin', { lastModified: 1000 });
      setResult('uploading');
      void myFilesAPI.uploadFile({ file, parallelChunks: 1 })
        .then(() => setResult('completed')).catch((error) => setResult(`error:${error.code || error.message}`));
    }}>Загрузить тестовый файл</button>
  </section>;
}
