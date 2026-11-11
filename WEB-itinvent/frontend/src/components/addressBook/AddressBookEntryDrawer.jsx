import { Box, Drawer, IconButton, Stack } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useTheme } from '@mui/material/styles';
import AddressBookEntryDetail from './AddressBookEntryDetail';
import { thinScrollbarSx } from './addressBookUtils';

export default function AddressBookEntryDrawer({
  open = false,
  item,
  onClose,
  ...detailProps
}) {
  const theme = useTheme();
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        role: 'dialog',
        'aria-modal': true,
        'aria-labelledby': item ? 'address-book-drawer-title' : undefined,
        sx: { width: 'min(420px, 92vw)', maxWidth: '100%', overflow: 'hidden' },
      }}
      data-testid="address-book-entry-drawer"
    >
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          justifyContent="flex-end"
          sx={{ px: 2, py: 0.5, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}
        >
          <IconButton aria-label="Закрыть" onClick={onClose} sx={{ width: { xs: 44, sm: 36 }, height: { xs: 44, sm: 36 } }}>
            <CloseIcon />
          </IconButton>
        </Stack>
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', ...thinScrollbarSx(theme) }}>
          <AddressBookEntryDetail item={item} titleId="address-book-drawer-title" {...detailProps} />
        </Box>
      </Box>
    </Drawer>
  );
}
