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
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CreateOutlinedIcon from '@mui/icons-material/CreateOutlined';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import DrawOutlinedIcon from '@mui/icons-material/DrawOutlined';
import {
  buildMailUiTokens,
  getMailBottomSheetPaperSx,
  getMailIconButtonSx,
  getMailMenuPaperSx,
  getMailMetaTextSx,
  getMailSurfaceButtonSx,
} from './mailUiTokens';
import ShellNotificationsButton from '../layout/ShellNotificationsButton';

const iconButtonSx = (tokens, overrides = {}) => ({
  ...getMailIconButtonSx(tokens, {
    width: 36,
    height: 36,
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
  extraItems = [],
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
              minHeight: 56,
              px: 2,
              py: 1,
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
          minHeight: 48,
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
      {extraItems.length > 0 ? (
        <>
          <Divider />
          {extraItems.map((item) => (
            <Button
              key={item.id}
              data-testid={item.testId}
              fullWidth
              onClick={() => {
                onClose?.();
                item.onClick?.();
              }}
              sx={{
                minHeight: 48,
                borderRadius: 0,
                justifyContent: 'flex-start',
                px: 2,
                textTransform: 'none',
                color: tokens.textPrimary,
                fontWeight: 600,
              }}
              startIcon={item.icon}
            >
              {item.label}
            </Button>
          ))}
        </>
      ) : null}
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
  onCompose,
  onOpenAdvancedSearch,
  onOpenToolsMenu,
  onOpenNavigation,
  onOpenStorage,
  onBackFromStorage,
  onOpenSignatures,
  onOpenMailSettings,
  canOpenStorage = false,
  storageActive = false,
  hasActiveFilters = false,
  mobile = false,
  embedded = false,
  showNavigationButton = false,
  loading = false,
  refreshTooltip = 'Обновить',
  searchPlaceholder = 'Поиск по теме, адресу и тексту…',
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
  const showNavButton = Boolean(mobile || showNavigationButton);

  const mailboxExtraItems = [
    storageActive ? {
      id: 'back-to-mail',
      testId: 'mail-toolbar-menu-back-to-mail',
      label: 'К письмам',
      icon: <ArrowBackRoundedIcon fontSize="small" />,
      onClick: onBackFromStorage,
    } : canOpenStorage ? {
      id: 'storage',
      testId: 'mail-toolbar-open-storage',
      label: 'Хранилище',
      icon: <StorageOutlinedIcon fontSize="small" />,
      onClick: onOpenStorage,
    } : null,
    {
      id: 'signatures',
      testId: 'mail-toolbar-open-signatures',
      label: 'Управление подписями',
      icon: <DrawOutlinedIcon fontSize="small" />,
      onClick: onOpenSignatures,
    },
    {
      id: 'settings',
      testId: 'mail-toolbar-open-mail-settings',
      label: 'Настройки почты',
      icon: <TuneRoundedIcon fontSize="small" />,
      onClick: onOpenMailSettings,
    },
  ].filter(Boolean);

  useEffect(() => {
    if (!mobile) return;
    if (String(search || '').trim() || hasActiveFilters) {
      setMobileSearchOpen(true);
    }
  }, [hasActiveFilters, mobile, search]);

  const searchField = (
    <TextField
      data-testid={mobile ? 'mail-toolbar-mobile-search' : 'mail-toolbar-search'}
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
          minHeight: mobile ? 40 : (embedded ? 32 : 36),
          borderRadius: tokens.inputRadius,
          bgcolor: tokens.surfaceBg,
          color: tokens.textPrimary,
          fontSize: '0.875rem',
          '& input::placeholder': {
            color: tokens.textSecondary,
            opacity: 1,
          },
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

  const mailboxSwitcherButton = (
    <Button
      data-testid={mobile ? 'mail-toolbar-mobile-mailbox-switcher' : 'mail-toolbar-mailbox-switcher'}
      aria-label="Выбрать почтовый ящик"
      aria-expanded={Boolean(mailboxMenuAnchorEl || mobileMailboxSheetOpen)}
      onClick={(event) => {
        onOpenMailboxList?.();
        if (mobile) {
          setMobileMailboxSheetOpen(true);
          return;
        }
        setMailboxMenuAnchorEl(event.currentTarget);
      }}
      sx={{
        minWidth: 0,
        maxWidth: mobile ? '100%' : (embedded ? 200 : 220),
        flex: mobile ? 1 : (embedded ? '0 1 200px' : '0 1 220px'),
        minHeight: embedded ? 32 : 36,
        px: 1,
        justifyContent: 'space-between',
        ...getMailSurfaceButtonSx(tokens, {
          borderRadius: tokens.controlRadius,
          fontWeight: 600,
        }),
      }}
    >
      <Stack direction="row" spacing={0.8} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
        <Badge color="primary" badgeContent={activeUnreadCount || null}>
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              bgcolor: activeMailbox?.is_primary ? 'primary.main' : tokens.textSecondary,
            }}
          />
        </Badge>
        <Typography noWrap sx={{ fontWeight: 600, fontSize: '0.84rem', minWidth: 0, flex: 1, textAlign: 'left' }}>
          {activeMailboxLabel}
        </Typography>
      </Stack>
      <ExpandMoreRoundedIcon fontSize="small" />
    </Button>
  );

  if (mobile) {
    return (
      <>
        <Box
          data-testid="mail-toolbar-mobile-header"
          className="mail-safe-top"
          sx={{
            px: 1,
            pt: 'calc(8px + env(safe-area-inset-top, 0px))',
            pb: 0.75,
            minHeight: 52,
            bgcolor: tokens.shellBg || tokens.panelBg,
            borderBottom: '1px solid',
            borderColor: tokens.panelBorder,
          }}
        >
          <Stack spacing={mobileSearchOpen ? 0.75 : 0.5}>
            <Stack direction="row" spacing={0.65} alignItems="center">
              {showNavButton ? (
                <IconButton
                  aria-label="Открыть навигацию"
                  data-testid="mail-toolbar-open-navigation"
                  onClick={onOpenNavigation}
                  sx={iconButtonSx(tokens)}
                >
                  <MenuRoundedIcon fontSize="small" />
                </IconButton>
              ) : null}

              {mailboxSwitcherButton}

              {onCompose ? (
                <Tooltip title="Написать письмо">
                  <IconButton
                    aria-label="Написать письмо"
                    data-testid="mail-compose-button"
                    onClick={onCompose}
                    sx={iconButtonSx(tokens, {
                      bgcolor: theme.palette.primary.main,
                      color: theme.palette.primary.contrastText,
                      borderColor: 'transparent',
                      '&:hover': {
                        bgcolor: theme.palette.primary.dark,
                      },
                    })}
                  >
                    <CreateOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              ) : null}

              <IconButton
                aria-label="Открыть поиск"
                data-testid="mail-toolbar-toggle-search"
                onClick={() => setMobileSearchOpen((prev) => !prev)}
                sx={iconButtonSx(tokens, {
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
                sx={iconButtonSx(tokens)}
              >
                <MoreHorizRoundedIcon fontSize="small" />
              </IconButton>

              <ShellNotificationsButton
                size="small"
                sx={iconButtonSx(tokens)}
              />
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
            extraItems={mailboxExtraItems}
          />
        </Drawer>
      </>
    );
  }

  return (
    <Box
      data-testid="mail-toolbar-desktop"
      data-embedded={embedded ? 'true' : 'false'}
      sx={{
        px: embedded ? 0 : { xs: 1, md: 1.25 },
        py: embedded ? 0 : 0.5,
        minHeight: embedded ? 0 : 52,
        height: embedded ? 36 : 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: embedded ? 0.75 : 1,
        flex: embedded ? 1 : undefined,
        minWidth: 0,
        borderBottom: embedded ? 'none' : '1px solid',
        borderColor: tokens.panelBorder,
        bgcolor: embedded ? 'transparent' : (tokens.shellBg || tokens.panelBg),
      }}
    >
      {showNavButton ? (
        <IconButton
          aria-label="Открыть папки"
          data-testid="mail-toolbar-open-navigation"
          onClick={onOpenNavigation}
          sx={iconButtonSx(tokens)}
        >
          <MenuRoundedIcon fontSize="small" />
        </IconButton>
      ) : null}

      {mailboxSwitcherButton}

      <Box sx={{ flex: 1, minWidth: embedded ? 120 : 160, maxWidth: embedded ? 720 : 640 }}>
        {searchField}
      </Box>

      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
        <Tooltip title="Фильтры">
          <IconButton
            aria-label="Фильтры"
            data-testid="mail-toolbar-open-filters"
            onClick={onOpenAdvancedSearch}
            sx={iconButtonSx(tokens, {
              width: embedded ? 32 : 36,
              height: embedded ? 32 : 36,
              bgcolor: hasActiveFilters ? tokens.selectedBg : tokens.actionBg,
              color: hasActiveFilters ? 'primary.main' : tokens.textPrimary,
            })}
          >
            <TuneRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={refreshTooltip}>
          <IconButton
            aria-label="Обновить"
            onClick={onRefresh}
            disabled={loading}
            sx={iconButtonSx(tokens, embedded ? { width: 32, height: 32 } : {})}
          >
            <RefreshRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Ещё">
          <IconButton
            aria-label="Ещё"
            data-testid="mail-toolbar-open-tools"
            onClick={onOpenToolsMenu}
            sx={iconButtonSx(tokens, embedded ? { width: 32, height: 32 } : {})}
          >
            <MoreHorizRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
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
          sx={{ minHeight: 44, fontWeight: 700, color: 'primary.main' }}
        >
          + Подключить ящик
        </MenuItem>
        {mailboxExtraItems.length > 0 ? <Divider /> : null}
        {mailboxExtraItems.map((item) => (
          <MenuItem
            key={item.id}
            data-testid={item.testId}
            onClick={() => {
              setMailboxMenuAnchorEl(null);
              item.onClick?.();
            }}
            sx={{ minHeight: 44, gap: 1 }}
          >
            {item.icon}
            {item.label}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
