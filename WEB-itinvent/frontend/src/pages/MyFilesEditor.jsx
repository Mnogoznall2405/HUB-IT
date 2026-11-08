import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import MyFilesEditorWorkspace from '../components/myFiles/MyFilesEditorWorkspace';
import { buildEditorRoute } from '../lib/myFilesEditorLink';
import { useNotification } from '../contexts/NotificationContext';
import { useMyFilesDownload } from './myFiles/useMyFilesDownload';

/** Desktop route messages add documents to this workspace without replacing live editors. */
export default function MyFilesEditor() {
  const { fileId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { notifySuccess, notifyWarning, notifyApiError } = useNotification();
  const { downloadFile } = useMyFilesDownload({ notifyApiError, notifySuccess, notifyWarning });
  const [title, setTitle] = useState('');

  useEffect(() => {
    const previous = document.title;
    if (title) document.title = `${title} — Мои файлы`;
    return () => { document.title = previous; };
  }, [title]);

  const handleClose = useCallback(() => {
    // A tab opened from the list closes itself; a tab opened from a link goes back to the files.
    if (window.opener) window.close();
    if (!window.closed) navigate('/my-files', { replace: true });
  }, [navigate]);

  return <MyFilesEditorWorkspace fileId={fileId} requestKey={location.key} onTitle={setTitle} onCloseLast={handleClose}
    onActiveDocumentChange={id => { if (id !== fileId) navigate(buildEditorRoute(id), { replace: true }); }}
    onDownload={id => downloadFile({ id })} />;
}
