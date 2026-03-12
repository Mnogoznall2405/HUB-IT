import {
  Dialog,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';

export default function MailHeadersDialog({ open, onClose, headers }) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Заголовки письма</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={0.8}>
          {(headers?.items || []).map((item, index) => (
            <Stack key={`${item?.name || 'header'}_${index}`} spacing={0.2}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                {item?.name || '-'}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  fontFamily: 'Consolas, "Courier New", monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {item?.value || '-'}
              </Typography>
            </Stack>
          ))}
          {(!headers?.items || headers.items.length === 0) ? (
            <Typography variant="body2" color="text.secondary">Заголовки недоступны.</Typography>
          ) : null}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
