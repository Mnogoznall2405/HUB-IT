import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Box } from '@mui/material';

import MyFilesEditorShell from '../components/myFiles/MyFilesEditorShell';
import { useNotification } from '../contexts/NotificationContext';
import { useMyFilesDownload } from './myFiles/useMyFilesDownload';

/** The online editor on a page of its own: it opens in a new browser tab, so the list stays where it was. */
export default function MyFilesEditor() {
  const { fileId = '' } = useParams();
  const navigate = useNavigate();
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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100dvh', bgcolor: 'background.paper' }}>
      <MyFilesEditorShell
        fileId={fileId}
        fileName={title || 'Документ'}
        onTitle={setTitle}
        onClose={handleClose}
        closeLabel="Закрыть редактор"
        onDownload={() => downloadFile({ id: fileId })}
      />
    </Box>
  );
}
