import { Box, CircularProgress, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AddressBookEntryRow from './AddressBookEntryRow';
import { getEntryKey } from './addressBookUtils';

export default function AddressBookEntryList({
  items = [],
  selectedEntryKey = '',
  loading = false,
  query = '',
  enableTelLinks = false,
  onSelect,
  onOpenTelegram,
  onComposeEmail,
  onOpenChat,
  showChatAction = false,
  chatBusyEntryKey = '',
}) {
  const theme = useTheme();

  if (loading && items.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (!items.length) {
    return (
      <Box
        sx={{
          py: 6,
          px: 2,
          textAlign: 'center',
          border: `1px dashed ${theme.palette.divider}`,
          bgcolor: alpha(theme.palette.background.paper, 0.6),
        }}
        data-testid="address-book-entry-list-empty"
      >
        <Typography variant="body2" color="text.secondary">
          Сотрудники не найдены. Измените ФИО, подразделение, должность, город, номер телефона или e-mail.
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      data-testid="address-book-entry-list"
      sx={{
        border: `1px solid ${theme.palette.divider}`,
        overflow: 'hidden',
        bgcolor: alpha(theme.palette.background.paper, 0.72),
      }}
    >
      {items.map((item, index) => {
        const entryKey = getEntryKey(item, index);
        return (
          <AddressBookEntryRow
            key={entryKey}
            item={item}
            entryKey={entryKey}
            selected={entryKey === selectedEntryKey}
            query={query}
            enableTelLinks={enableTelLinks}
            onSelect={() => onSelect?.(item, index)}
            onOpenTelegram={onOpenTelegram}
            onComposeEmail={onComposeEmail}
            onOpenChat={() => onOpenChat?.(item, index)}
            showChatAction={showChatAction}
            chatBusy={chatBusyEntryKey === entryKey}
          />
        );
      })}
    </Box>
  );
}
