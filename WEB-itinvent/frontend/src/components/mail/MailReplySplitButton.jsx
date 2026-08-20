import { useState } from 'react';
import { Button, ButtonGroup, Menu } from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import ReplyAllRoundedIcon from '@mui/icons-material/ReplyAllRounded';
import ReplyRoundedIcon from '@mui/icons-material/ReplyRounded';
import { MailCompactMenuItem } from './MailMoveToMenu';
import { getMailMenuPaperSx } from './mailUiTokens';
import { getMailReplyActionLabel } from './mailReplyIntent';

export default function MailReplySplitButton({
  mode = 'reply',
  disabled = false,
  tokens,
  onReply,
  testId = 'mail-preview-reply-split',
}) {
  const [menuAnchorEl, setMenuAnchorEl] = useState(null);
  const primaryMode = mode === 'reply_all' ? 'reply_all' : 'reply';
  const primaryLabel = getMailReplyActionLabel(primaryMode);
  const PrimaryIcon = primaryMode === 'reply_all' ? ReplyAllRoundedIcon : ReplyRoundedIcon;
  const menuOpen = Boolean(menuAnchorEl);

  const closeMenu = () => setMenuAnchorEl(null);

  const handleSelect = (nextMode) => {
    closeMenu();
    onReply?.(nextMode);
  };

  return (
    <>
      <ButtonGroup
        variant="contained"
        size="small"
        disabled={disabled}
        data-testid={testId}
        sx={{
          boxShadow: 'none',
          borderRadius: tokens?.radiusSm,
        }}
      >
        <Button
          startIcon={<PrimaryIcon fontSize="small" />}
          onClick={() => onReply?.(primaryMode)}
          aria-label={primaryLabel}
          sx={{
            minHeight: 32,
            textTransform: 'none',
            fontWeight: 700,
            boxShadow: 'none',
            px: 1.15,
          }}
        >
          {primaryLabel}
        </Button>
        <Button
          size="small"
          aria-label="Выбрать тип ответа"
          aria-haspopup="menu"
          aria-expanded={menuOpen ? 'true' : undefined}
          data-testid={`${testId}-menu-button`}
          onClick={(event) => {
            event.stopPropagation();
            setMenuAnchorEl(event.currentTarget);
          }}
          sx={{
            minWidth: 32,
            minHeight: 32,
            px: 0.35,
            boxShadow: 'none',
          }}
        >
          <ArrowDropDownIcon fontSize="small" />
        </Button>
      </ButtonGroup>
      <Menu
        anchorEl={menuAnchorEl}
        open={menuOpen}
        onClose={closeMenu}
        MenuListProps={{
          dense: true,
          'data-testid': `${testId}-menu`,
        }}
        PaperProps={{
          sx: getMailMenuPaperSx(tokens, {
            mt: 0.5,
            minWidth: 196,
          }),
        }}
      >
        <MailCompactMenuItem
          icon={<ReplyRoundedIcon fontSize="small" />}
          label="Ответить"
          selected={primaryMode === 'reply'}
          onClick={() => handleSelect('reply')}
        />
        <MailCompactMenuItem
          icon={<ReplyAllRoundedIcon fontSize="small" />}
          label="Ответить всем"
          selected={primaryMode === 'reply_all'}
          onClick={() => handleSelect('reply_all')}
        />
      </Menu>
    </>
  );
}
