import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';

import MyFilesVersionHistory from './MyFilesVersionHistory';

export default function MyFilesVersionsDialog({ open, file, onClose, canRestore = true }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const fileId = String(file?.id || '');
  const fileName = String(file?.original_file_name || 'файл');

  return (
    <Dialog open={Boolean(open)} onClose={() => onClose?.(false)} maxWidth="xs" fullWidth fullScreen={isMobile}>
      <DialogTitle sx={{ pb: 1 }}>
        <Typography component="div" variant="h6" sx={{ fontWeight: 700 }}>История версий</Typography>
        <Typography variant="body2" color="text.secondary" noWrap>{fileName}</Typography>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {open && fileId ? (
          <MyFilesVersionHistory
            fileId={fileId}
            fileName={fileName}
            canRestore={canRestore}
            onRestored={() => onClose?.(true)}
          />
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose?.(false)}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}
