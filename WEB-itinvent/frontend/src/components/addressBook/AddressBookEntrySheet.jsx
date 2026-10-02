import { Box, Button, IconButton, Stack, SwipeableDrawer } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import PhoneIcon from '@mui/icons-material/Phone';
import { useTheme } from '@mui/material/styles';
import AddressBookEntryDetail from './AddressBookEntryDetail';
import { hideScrollbarSx, pickPrimaryPhone } from './addressBookUtils';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';

const footerButtonSx = { minHeight: 44, flex: 1 };

export default function AddressBookEntrySheet({
  open = false,
  item,
  query = '',
  enableTelLinks = false,
  dismissed = false,
  onClose,
  onCopy,
  onOpenTelegram,
  onOpenMax,
  onComposeEmail,
  canComposeEmail = false,
  onOpenChat,
  showChatAction = false,
  chatBusy = false,
  isFavorite = false,
  onToggleFavorite,
  onSaveContact,
}) {
  const theme = useTheme();
  const ui = buildOfficeUiTokens(theme);
  const primaryPhone = pickPrimaryPhone(item);
  const canCall = enableTelLinks && Boolean(primaryPhone?.telHref);
  const hasFooterActions = Boolean(item) && (canCall || primaryPhone?.value || showChatAction);

  return (
    <SwipeableDrawer
      anchor="bottom"
      open={open}
      onOpen={() => {}}
      onClose={onClose}
      disableSwipeToOpen
      PaperProps={{
        role: 'dialog',
        'aria-modal': true,
        'aria-labelledby': item ? 'address-book-sheet-title' : undefined,
        sx: {
          borderTopLeftRadius: 4,
          borderTopRightRadius: 4,
          maxHeight: '92vh',
          '@supports (height: 100dvh)': { maxHeight: '92dvh' },
          overscrollBehavior: 'contain',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
      data-testid="address-book-entry-sheet"
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{
          flexShrink: 0,
          px: 2,
          pt: 1,
          pb: 0.5,
          bgcolor: 'background.paper',
          borderBottom: `1px solid ${ui.borderSoft}`,
        }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Box
            aria-hidden="true"
            sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: 'text.disabled', mx: 'auto', mb: 0.5 }}
          />
        </Box>
        <IconButton aria-label="Закрыть" onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </Stack>

      <Box
        sx={{
          flex: '1 1 auto',
          minHeight: 0,
          px: 2,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          ...hideScrollbarSx,
        }}
      >
        <AddressBookEntryDetail
          item={item}
          titleId="address-book-sheet-title"
          query={query}
          enableTelLinks={enableTelLinks}
          compact
          dismissed={dismissed}
          onCopy={onCopy}
          onOpenTelegram={onOpenTelegram}
          onOpenMax={onOpenMax}
          onComposeEmail={onComposeEmail}
          canComposeEmail={canComposeEmail}
          onOpenChat={onOpenChat}
          showChatAction={showChatAction}
          chatBusy={chatBusy}
          isFavorite={isFavorite}
          onToggleFavorite={onToggleFavorite}
          onSaveContact={onSaveContact}
          primaryActionsInFooter
        />
      </Box>

      {hasFooterActions ? (
        <Stack
          direction="row"
          spacing={1}
          sx={{
            flexShrink: 0,
            px: 2,
            pt: 1,
            pb: 'max(12px, env(safe-area-inset-bottom))',
            borderTop: `1px solid ${ui.borderSoft}`,
            bgcolor: 'background.paper',
          }}
          data-testid="address-book-sheet-footer"
        >
          {canCall ? (
            <Button
              component="a"
              href={primaryPhone.telHref}
              variant="contained"
              size="small"
              startIcon={<PhoneIcon />}
              aria-label={`Позвонить ${primaryPhone.value}`}
              sx={footerButtonSx}
            >
              Позвонить
            </Button>
          ) : primaryPhone?.value ? (
            <Button
              variant="contained"
              size="small"
              startIcon={<ContentCopyIcon />}
              onClick={() => onCopy?.(primaryPhone.value)}
              aria-label={`Скопировать номер ${primaryPhone.value}`}
              sx={footerButtonSx}
            >
              Скопировать номер
            </Button>
          ) : null}
          {showChatAction ? (
            <Button
              variant="outlined"
              size="small"
              startIcon={<ForumOutlinedIcon />}
              disabled={chatBusy}
              onClick={() => onOpenChat?.(item)}
              aria-label={`Написать в чат ${item?.full_name || ''}`}
              sx={footerButtonSx}
              data-testid="address-book-sheet-footer-chat"
            >
              Написать в чат
            </Button>
          ) : null}
        </Stack>
      ) : (
        <Box sx={{ pb: 'max(12px, env(safe-area-inset-bottom))' }} />
      )}
    </SwipeableDrawer>
  );
}
