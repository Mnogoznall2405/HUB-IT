import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import {
  buildMailUiTokens,
  getMailBottomSheetPaperSx,
  getMailIconButtonSx,
  getMailMenuPaperSx,
  getMailMetaTextSx,
  getMailSurfaceButtonSx,
} from './mailUiTokens';

const iconButtonSx = (tokens, overrides = {}) => ({
  ...getMailIconButtonSx(tokens, {
    width: 40,
    height: 40,
    ...overrides,
  }),
});

function MailboxListContent({
  activeMailboxId,
  normalizedMailboxes,
  onSelectMailbox,
  onManageMailboxes,
  onClose,
  tokens,
}) {
  return (
    <Box className="mail-scroll-hidden" sx={{ maxHeight: '80dvh', overflowY: 'auto' }}>
      <Box sx={{ px: 2, pt: 1.2, pb: 0.9 }}>
        <Typography sx={{ fontWeight: 700, fontSize: '1rem', color: tokens.textPrimary }}>
          Подключенные ящики
        </Typography>
      </Box>
      {normalizedMailboxes.map((mailbox) => {
        const mailboxId = String(mailbox?.id || '').trim();
        const unreadCount = Number(mailbox?.unread_count || 0);
        const selected = activeMailboxId === mailboxId;
        return (
          <Button
            key={mailboxId || mailbox?.mailbox_email || mailbox?.label}
            fullWidth
            onClick={() => {
              onClose?.();
              onSelectMailbox?.(mailboxId, mailbox);
            }}
            sx={{
              minHeight: 62,
              px: 2,
              py: 1.15,
              justifyContent: 'space-between',
              borderRadius: 0,
              textTransform: 'none',
              color: selected ? 'primary.main' : tokens.textPrimary,
              bgcolor: selected ? tokens.selectedBg : 'transparent',
            }}
          >
            <Stack direction="row" spacing={1.1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  bgcolor: mailbox?.is_primary ? 'primary.main' : tokens.textSecondary,
                  flexShrink: 0,
                }}
              />
              <Box sx={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                <Typography noWrap sx={{ fontWeight: 700, fontSize: '0.96rem' }}>
                  {mailbox?.label || mailbox?.mailbox_email || 'Без названия'}
                </Typography>
                <Typography noWrap sx={getMailMetaTextSx(tokens)}>
                  {mailbox?.mailbox_email || mailbox?.effective_mailbox_login || ''}
                </Typography>
              </Box>
            </Stack>
            {unreadCount > 0 ? (
              <Box
                sx={{
                  minWidth: 24,
                  height: 24,
                  px: 0.75,
                  borderRadius: tokens.badgeRadius,
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  fontWeight: 700,
                  fontSize: tokens.fontSizeFine,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </Box>
            ) : null}
          </Button>
        );
      })}
      <Divider />
      <Button
        data-testid="mail-toolbar-manage-mailboxes"
        fullWidth
        onClick={() => {
          onClose?.();
          onManageMailboxes?.();
        }}
        sx={{
          minHeight: 56,
          borderRadius: 0,
          justifyContent: 'flex-start',
          px: 2,
          textTransform: 'none',
          color: 'primary.main',
          fontWeight: 700,
        }}
      >
        + Подключить ящик
      </Button>
    </Box>
  );
}

export default function MailToolbar({
  mailboxEmail,
  activeMailbox = null,
  mailboxes = [],
  onOpenMailboxList,
  onSelectMailbox,
  onManageMailboxes,
  search,
  onSearchChange,
  onRefresh,
  onOpenAdvancedSearch,
  onOpenToolsMenu,
  onOpenNavigation,
  currentFolderLabel = '',
  hasActiveFilters = false,
  mobile = false,
  loading = false,
  searchPlaceholder = 'Поиск по теме, отправителю или письму',
  searchInputRef,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const [mailboxMenuAnchorEl, setMailboxMenuAnchorEl] = useState(null);
  const [mobileMailboxSheetOpen, setMobileMailboxSheetOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  const normalizedMailboxes = Array.isArray(mailboxes) ? mailboxes : [];
  const activeMailboxId = String(activeMailbox?.id || '').trim();
  const activeMailboxLabel = String(
    activeMailbox?.label
      || activeMailbox?.mailbox_email
      || mailboxEmail
      || 'Ящик'
  ).trim();
  const activeUnreadCount = Number(activeMailbox?.unread_count || 0);

  useEffect(() => {
    if (!mobile) return;
    if (String(search || '').trim() || hasActiveFilters) {
      setMobileSearchOpen(true);
    }
  }, [hasActiveFilters, mobile, search]);

  const searchField = (
    <TextField
      data-testid={mobile ? 'mail-toolbar-mobile-search' : undefined}
      inputRef={searchInputRef}
      size="small"
      value={search}
      placeholder={searchPlaceholder}
      onChange={(event) => onSearchChange?.(event.target.value)}
      fullWidth
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchRoundedIcon fontSize="small" sx={{ color: tokens.textSecondary }} />
          </InputAdornment>
        ),
        sx: {
          minHeight: mobile ? 46 : 44,
          borderRadius: tokens.inputRadius,
          bgcolor: tokens.surfaceBg,
          color: tokens.textPrimary,
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: tokens.surfaceBorder,
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: tokens.panelBorder,
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: theme.palette.primary.main,
          },
        },
      }}
    />
  );

  if (mobile) {
    return (
      <>
        <Box
          className="mail-safe-top"
          sx={{
            px: 1,
            py: 0.75,
            bgcolor: tokens.panelBg,
            borderBottom: '1px solid',
            borderColor: tokens.panelBorder,
          }}
        >
          <Stack spacing={mobileSearchOpen ? 0.75 : 0}>
            <Stack direction="row" spacing={0.65} alignItems="center">
              <IconButton
                aria-label="Открыть навигацию"
                data-testid="mail-toolbar-open-navigation"
                onClick={onOpenNavigation}
                sx={iconButtonSx(tokens, { width: 38, height: 38 })}
              >
                <MenuRoundedIcon fontSize="small" />
              </IconButton>

              <Button
                data-testid="mail-toolbar-mobile-mailbox-switcher"
                onClick={() => {
                  onOpenMailboxList?.();
                  setMobileMailboxSheetOpen(true);
                }}
                sx={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: 38,
                  px: 1,
                  justifyContent: 'space-between',
                  ...getMailSurfaceButtonSx(tokens, {
                    borderRadius: tokens.controlRadius,
                  }),
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                  <Badge color="primary" badgeContent={activeUnreadCount || null}>
                    <Box
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        bgcolor: activeMailbox?.is_primary ? 'primary.main' : tokens.textSecondary,
                      }}
                    />
                  </Badge>
                  <Box sx={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                    <Typography noWrap sx={{ fontWeight: 700, fontSize: '0.9rem' }}>
                      {activeMailboxLabel}
                    </Typography>
                  </Box>
                </Stack>
                <ExpandMoreRoundedIcon fontSize="small" />
              </Button>

              <IconButton
                aria-label="Открыть поиск"
                data-testid="mail-toolbar-toggle-search"
                onClick={() => setMobileSearchOpen((prev) => !prev)}
                sx={iconButtonSx(tokens, {
                  width: 38,
                  height: 38,
                  bgcolor: mobileSearchOpen ? tokens.selectedBg : tokens.actionBg,
                  color: mobileSearchOpen ? 'primary.main' : tokens.textPrimary,
                })}
              >
                <SearchRoundedIcon fontSize="small" />
              </IconButton>

              <IconButton
                aria-label="Открыть действия"
                data-testid="mail-toolbar-open-tools"
                onClick={onOpenToolsMenu}
                sx={iconButtonSx(tokens, { width: 38, height: 38 })}
              >
                <MoreHorizRoundedIcon fontSize="small" />
              </IconButton>
            </Stack>

            {mobileSearchOpen ? searchField : null}

            {hasActiveFilters ? (
              <Chip
                size="small"
                icon={<TuneRoundedIcon />}
                label="Есть фильтры"
                sx={{
                  alignSelf: 'flex-start',
                  bgcolor: tokens.selectedBg,
                  color: 'primary.main',
                  fontWeight: 700,
                }}
              />
            ) : null}
          </Stack>
        </Box>

        <Drawer
          anchor="bottom"
          open={mobileMailboxSheetOpen}
          onClose={() => setMobileMailboxSheetOpen(false)}
          ModalProps={{ keepMounted: true }}
          PaperProps={{
            sx: getMailBottomSheetPaperSx(tokens),
          }}
        >
          <MailboxListContent
            activeMailboxId={activeMailboxId}
            normalizedMailboxes={normalizedMailboxes}
            onSelectMailbox={onSelectMailbox}
            onManageMailboxes={onManageMailboxes}
            onClose={() => setMobileMailboxSheetOpen(false)}
            tokens={tokens}
          />
        </Drawer>
      </>
    );
  }

  return (
    <Box
      sx={{
        px: { xs: 1.25, md: 1.8 },
        py: 1.1,
        borderBottom: '1px solid',
        borderColor: tokens.panelBorder,
        bgcolor: tokens.panelBg,
      }}
    >
      <Stack spacing={1.1}>
        <Stack direction="row" spacing={1.2} alignItems="center" justifyContent="space-between">
          <Stack direction="row" spacing={1.1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '1.08rem', color: tokens.textPrimary, whiteSpace: 'nowrap' }}>
              Почта
            </Typography>

            <Button
              data-testid="mail-toolbar-mailbox-switcher"
              onClick={(event) => {
                onOpenMailboxList?.();
                setMailboxMenuAnchorEl(event.currentTarget);
              }}
              sx={{
                minWidth: 0,
                maxWidth: 320,
                minHeight: 40,
                px: 1.25,
                justifyContent: 'space-between',
                  ...getMailSurfaceButtonSx(tokens, {
                    borderRadius: tokens.controlRadius,
                  }),
                }}
              >
              <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                <Badge color="primary" badgeContent={activeUnreadCount || null}>
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      bgcolor: activeMailbox?.is_primary ? 'primary.main' : tokens.textSecondary,
                    }}
                  />
                </Badge>
                <Box sx={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                  <Typography noWrap sx={{ fontWeight: 700, fontSize: '0.9rem' }}>
                    {activeMailboxLabel}
                  </Typography>
                </Box>
              </Stack>
              <ExpandMoreRoundedIcon fontSize="small" />
            </Button>

            {currentFolderLabel ? (
              <Chip
                size="small"
                label={currentFolderLabel}
                sx={{
                  bgcolor: hasActiveFilters ? tokens.selectedBg : tokens.surfaceBg,
                  color: hasActiveFilters ? 'primary.main' : tokens.textPrimary,
                  fontWeight: 700,
                }}
              />
            ) : null}
          </Stack>

          <Stack direction="row" spacing={0.75} alignItems="center">
            <IconButton aria-label="Обновить" onClick={onRefresh} disabled={loading} sx={iconButtonSx(tokens)}>
              <RefreshRoundedIcon fontSize="small" />
            </IconButton>
            <IconButton aria-label="Фильтры" onClick={onOpenAdvancedSearch} sx={iconButtonSx(tokens)}>
              <TuneRoundedIcon fontSize="small" />
            </IconButton>
            <IconButton aria-label="Ещё" onClick={onOpenToolsMenu} sx={iconButtonSx(tokens)}>
              <MoreHorizRoundedIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Stack>

        {searchField}
      </Stack>

      <Menu
        anchorEl={mailboxMenuAnchorEl}
        open={Boolean(mailboxMenuAnchorEl)}
        onClose={() => setMailboxMenuAnchorEl(null)}
        PaperProps={{
          sx: getMailMenuPaperSx(tokens, {
            mt: 0.8,
            minWidth: 320,
            maxWidth: 360,
          }),
        }}
      >
        {normalizedMailboxes.map((mailbox) => {
          const mailboxId = String(mailbox?.id || '').trim();
          const unreadCount = Number(mailbox?.unread_count || 0);
          return (
            <MenuItem
              key={mailboxId || mailbox?.mailbox_email || mailbox?.label}
              selected={activeMailboxId === mailboxId}
              onClick={() => {
                setMailboxMenuAnchorEl(null);
                onSelectMailbox?.(mailboxId, mailbox);
              }}
              sx={{ minHeight: 54, gap: 1 }}
            >
              <Badge color="primary" badgeContent={unreadCount || null}>
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    bgcolor: mailbox?.is_primary ? 'primary.main' : tokens.textSecondary,
                  }}
                />
              </Badge>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography noWrap sx={{ fontWeight: 700, fontSize: '0.95rem' }}>
                  {mailbox?.label || mailbox?.mailbox_email || 'Без названия'}
                </Typography>
                <Typography noWrap sx={getMailMetaTextSx(tokens)}>
                  {mailbox?.mailbox_email || mailbox?.effective_mailbox_login || ''}
                </Typography>
              </Box>
            </MenuItem>
          );
        })}
        <Divider />
        <MenuItem
          data-testid="mail-toolbar-manage-mailboxes"
          onClick={() => {
            setMailboxMenuAnchorEl(null);
            onManageMailboxes?.();
          }}
          sx={{ minHeight: 50, fontWeight: 700, color: 'primary.main' }}
        >
          + Подключить ящик
        </MenuItem>
      </Menu>
    </Box>
  );
}
