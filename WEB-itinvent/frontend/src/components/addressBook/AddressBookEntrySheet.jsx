import { Box, Drawer, IconButton, Stack, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddressBookEntryDetail from './AddressBookEntryDetail';
import { hideScrollbarSx } from './addressBookUtils';

export default function AddressBookEntrySheet({
  open = false,
  item,
  query = '',
  enableTelLinks = false,
  onClose,
  onCopy,
  onOpenTelegram,
  onOpenMax,
  onComposeEmail,
  onOpenChat,
  showChatAction = false,
  chatBusy = false,
}) {
  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          borderTopLeftRadius: 4,
          borderTopRightRadius: 4,
          maxHeight: '88vh',
        },
      }}
      data-testid="address-book-entry-sheet"
    >
      <Box sx={{ px: 2, pt: 1.5, pb: 3, overflowY: 'auto', ...hideScrollbarSx }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={800}>
            Контакт
          </Typography>
          <IconButton aria-label="Закрыть" onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Stack>
        <AddressBookEntryDetail
          item={item}
          query={query}
          enableTelLinks={enableTelLinks}
          compact
          onCopy={onCopy}
          onOpenTelegram={onOpenTelegram}
          onOpenMax={onOpenMax}
          onComposeEmail={onComposeEmail}
          onOpenChat={onOpenChat}
          showChatAction={showChatAction}
          chatBusy={chatBusy}
        />
      </Box>
    </Drawer>
  );
}
