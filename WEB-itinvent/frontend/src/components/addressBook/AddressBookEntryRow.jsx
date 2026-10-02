import { Avatar, Box, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import PhoneIcon from '@mui/icons-material/Phone';
import { memo, useCallback, useMemo } from 'react';
import { alpha, useTheme } from '@mui/material/styles';
import { TelegramBrandIcon } from '../icons/MessengerBrandIcon';
import { isValidEmailRecipient } from '../mail/mailComposeState';
import { isPhoneDeepLinkReady } from '../../lib/messengerLinks';
import HighlightText from './HighlightText';
import {
  absenceChipColor,
  buildEmployeeSubtitle,
  formatDate,
  formatAbsenceLabel,
  getInitials,
  pickPrimaryEmail,
  pickQuickActionPhone,
} from './addressBookUtils';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';

const NAVIGATION_KEYS = {
  ArrowDown: 'next',
  ArrowUp: 'prev',
  Home: 'first',
  End: 'last',
};

// Row action icons: 44px on touch, 36px on desktop per design system targets.
const rowActionButtonSx = { p: 1.25, width: { xs: 44, sm: 36 }, height: { xs: 44, sm: 36 } };

function AddressBookEntryRow({
  item,
  index = 0,
  entryKey,
  selected = false,
  active = false,
  dismissed = false,
  showOnlyPrimaryAction = false,
  compactActions = false,
  query = '',
  enableTelLinks = false,
  onSelect,
  onNavigate,
  onOpenTelegram,
  onComposeEmail,
  canComposeEmail = true,
  onOpenChat,
  showChatAction = false,
  chatBusy = false,
  rowRef,
}) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const primaryPhone = pickQuickActionPhone(item);
  const primaryEmail = pickPrimaryEmail(item);
  const subtitle = buildEmployeeSubtitle(item);
  const absenceLabel = formatAbsenceLabel(item?.absence);
  const dismissalDateLabel = formatDate(item?.dismissal_date);
  const dismissedLabel = dismissed
    ? `Уволен${dismissalDateLabel ? ` ${dismissalDateLabel}` : ''}`
    : '';
  const canCall = enableTelLinks && Boolean(primaryPhone?.telHref);
  const canTelegram = primaryPhone?.digits && isPhoneDeepLinkReady(primaryPhone.digits);
  const canMail = !dismissed && canComposeEmail && primaryEmail?.value
    && isValidEmailRecipient(primaryEmail.value);
  const actionTabIndex = active ? 0 : -1;

  const registerRef = useCallback(
    (node) => { rowRef?.(index, node); },
    [index, rowRef],
  );

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect?.(item, index);
      return;
    }
    const direction = NAVIGATION_KEYS[event.key];
    if (!direction) return;
    event.preventDefault();
    onNavigate?.(index, direction);
  };

  return (
    <Box
      role="listitem"
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 1,
        px: 1.25,
        py: 1,
        minHeight: 72,
        borderBottom: `1px solid ${ui.borderSoft}`,
        bgcolor: selected ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
        '&:last-child': { borderBottom: 'none' },
        '&:hover': {
          bgcolor: selected
            ? alpha(theme.palette.primary.main, 0.12)
            : alpha(theme.palette.action.hover, 0.04),
        },
      }}
    >
      <Box
        role="button"
        ref={registerRef}
        tabIndex={active ? 0 : -1}
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect?.(item, index)}
        onKeyDown={handleKeyDown}
        data-testid={`address-book-entry-row-${entryKey}`}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          flex: '1 1 0',
          // 40px avatar + 8px gap + 110px text column
          minWidth: 158,
          cursor: 'pointer',
        }}
      >
        <Avatar
          sx={{
            width: 40,
            height: 40,
            fontSize: '0.875rem',
            fontWeight: 700,
            bgcolor: alpha(theme.palette.primary.main, 0.12),
            color: 'primary.main',
            flexShrink: 0,
          }}
        >
          {getInitials(item?.full_name)}
        </Avatar>

        <Box sx={{ flex: '1 1 110px', minWidth: 110 }}>
          <Tooltip title={item.full_name}>
            <Typography
              variant="body2"
              fontWeight={700}
              sx={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              <HighlightText value={item.full_name} query={query} />
            </Typography>
          </Tooltip>
          {subtitle ? (
            <Tooltip title={subtitle}>
              <Typography variant="caption" color="text.secondary" noWrap display="block">
                <HighlightText value={subtitle} query={query} />
              </Typography>
            </Tooltip>
          ) : null}
          {absenceLabel ? (
            <Chip
              size="small"
              color={absenceChipColor(item.absence)}
              label={absenceLabel}
              sx={{ mt: 0.35, maxWidth: '100%', height: 22, '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem', fontWeight: 700 } }}
            />
          ) : null}
          {dismissedLabel ? (
            <Chip
              size="small"
              label={dismissedLabel}
              sx={{ mt: 0.35, maxWidth: '100%', height: 22, '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem', fontWeight: 700 } }}
              data-testid={`address-book-dismissed-chip-${entryKey}`}
            />
          ) : null}
          {primaryPhone?.value ? (
            <Typography variant="caption" color="text.secondary" noWrap display="block">
              <HighlightText value={primaryPhone.value} query={query} />
            </Typography>
          ) : null}
        </Box>
      </Box>

      <Stack direction="row" spacing={0.25} alignItems="center" sx={{ flexShrink: 0, marginLeft: 'auto' }}>
        {primaryPhone && canCall ? (
          <Tooltip title="Позвонить">
            <span>
              <IconButton
                component="a"
                href={primaryPhone.telHref}
                size="medium"
                tabIndex={actionTabIndex}
                aria-label={`Позвонить ${primaryPhone.value}`}
                sx={rowActionButtonSx}
              >
                <PhoneIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        ) : null}
        {primaryPhone && !compactActions ? (
          <Tooltip title={canTelegram ? 'Telegram' : 'Номер не подходит для Telegram'}>
            <span>
              <IconButton
                size="medium"
                tabIndex={actionTabIndex}
                aria-label={`Открыть Telegram ${primaryPhone.value}`}
                disabled={!canTelegram}
                onClick={() => onOpenTelegram(primaryPhone.digits)}
                sx={rowActionButtonSx}
              >
                <TelegramBrandIcon size={20} />
              </IconButton>
            </span>
          </Tooltip>
        ) : null}
        {primaryEmail && !dismissed && canComposeEmail && !compactActions && !showOnlyPrimaryAction ? (
          <Tooltip title={canMail ? 'Новое письмо в HUB' : 'Некорректный e-mail'}>
            <span>
              <IconButton
                size="medium"
                tabIndex={actionTabIndex}
                aria-label={`Новое письмо в HUB ${primaryEmail.value}`}
                disabled={!canMail}
                onClick={() => onComposeEmail(primaryEmail.value)}
                sx={rowActionButtonSx}
              >
                <MailOutlineIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        ) : null}
        {showChatAction && !dismissed && (compactActions || !showOnlyPrimaryAction) ? (
          <Tooltip title="Написать в корпоративный чат">
            <span>
              <IconButton
                size="medium"
                tabIndex={actionTabIndex}
                aria-label={`Написать в чат ${item.full_name}`}
                disabled={chatBusy}
                onClick={() => onOpenChat?.(item, index)}
                sx={rowActionButtonSx}
                data-testid={`address-book-chat-${entryKey}`}
              >
                <ForumOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        ) : null}
      </Stack>
    </Box>
  );
}

// A22: rows re-render only when their own props change (selection, query,
// chat busy state). All callbacks are index-based and stable in the parent.
export default memo(AddressBookEntryRow);
