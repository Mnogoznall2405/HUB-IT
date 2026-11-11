import { useRef } from 'react';
import { Dialog } from '@mui/material';

import MyFilesEditorShell from './MyFilesEditorShell';

export default function MyFilesOfficeEditorDialog({ open, file, onClose, onDownload }) {
  const fileId = String(file?.id || '');
  const fileName = String(file?.original_file_name || file?.file_name || 'документ');
  const editorRef = useRef(null);
  const requestClose = () => {
    if (editorRef.current) editorRef.current.requestClose();
    else onClose?.();
  };

  return (
    <Dialog open={Boolean(open && fileId)} onClose={requestClose} fullScreen PaperProps={{ sx: { display: 'flex', flexDirection: 'column' } }}>
      {open && fileId ? (
        <MyFilesEditorShell
          ref={editorRef}
          fileId={fileId}
          fileName={fileName}
          onClose={onClose}
          onDownload={onDownload ? () => onDownload(file) : undefined}
        />
      ) : null}
    </Dialog>
  );
}
