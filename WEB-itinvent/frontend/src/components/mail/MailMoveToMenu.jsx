import { useMemo, useState } from 'react';
import {
  Box,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DraftsOutlinedIcon from '@mui/icons-material/DraftsOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import OutboxOutlinedIcon from '@mui/icons-material/OutboxOutlined';
import ReportGmailerrorredOutlinedIcon from '@mui/icons-material/ReportGmailerrorredOutlined';
import RssFeedOutlinedIcon from '@mui/icons-material/RssFeedOutlined';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import { filterMailMoveTargets } from './mailMoveTargets';

export const MAIL_MOVE_SEARCH_THRESHOLD = 12;

export const MAIL_MOVE_MENU_ITEM_SX = {
  minHeight: 32,
  py: 0.25,
  px: 1.25,
};

const FOLDER_ICON_BY_KEY = {
  inbox: InboxOutlinedIcon,
  sent: SendOutlinedIcon,
  drafts: DraftsOutlinedIcon,
  trash: DeleteOutlineIcon,
  deleted: DeleteOutlineIcon,
  junk: ReportGmailerrorredOutlinedIcon,
  spam: ReportGmailerrorredOutlinedIcon,
  archive: ArchiveOutlinedIcon,
  outbox: OutboxOutlinedIcon,
  rss: RssFeedOutlinedIcon,
  journal: ForumOutlinedIcon,
  conversations: ForumOutlinedIcon,
  folder: FolderOutlinedIcon,
};

function matchFolderIconKey(option) {
  const id = String(option?.value || option?.id || '').trim().toLowerCase();
  const iconKey = String(option?.icon_key || '').trim().toLowerCase();
  const wellKnown = String(option?.well_known_key || '').trim().toLowerCase();
  const label = String(option?.label || option?.name || '').trim().toLowerCase();

  if (FOLDER_ICON_BY_KEY[iconKey]) return iconKey;
  if (FOLDER_ICON_BY_KEY[wellKnown]) return wellKnown;
  if (FOLDER_ICON_BY_KEY[id]) return id;
  if (label.includes('входящ') || label.includes('inbox')) return 'inbox';
  if (label.includes('отправлен') || label.includes('sent')) return 'sent';
  if (label.includes('черновик') || label.includes('draft')) return 'drafts';
  if (label.includes('удален') || label.includes('trash') || label.includes('deleted')) return 'trash';
  if (label.includes('нежелатель') || label.includes('спам') || label.includes('junk')) return 'junk';
  if (label.includes('архив') || label.includes('archive')) return 'archive';
  return 'folder';
}

export function getMailFolderMenuIcon(option, fontSize = 'small') {
  const Icon = FOLDER_ICON_BY_KEY[matchFolderIconKey(option)] || FolderOutlinedIcon;
  return <Icon fontSize={fontSize} />;
}

export function MailCompactMenuItem({
  icon,
  label,
  onClick,
  danger = false,
  disabled = false,
  selected = false,
  trailing = null,
  testId,
}) {
  return (
    <MenuItem
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      selected={selected}
      sx={MAIL_MOVE_MENU_ITEM_SX}
    >
      {icon ? (
        <ListItemIcon sx={{ minWidth: 32, color: danger ? 'error.main' : 'inherit' }}>
          {icon}
        </ListItemIcon>
      ) : null}
      <ListItemText
        primary={label}
        primaryTypographyProps={{
          fontWeight: 600,
          fontSize: '0.875rem',
          color: danger ? 'error.main' : 'inherit',
          noWrap: true,
        }}
      />
      {trailing}
    </MenuItem>
  );
}

export function MailMoveSection({
  targets,
  onSelect,
  disabled = false,
  tokens,
  currentFolder = '',
}) {
  const [query, setQuery] = useState('');
  const items = useMemo(
    () => filterMailMoveTargets(targets, currentFolder),
    [currentFolder, targets],
  );
  const showSearch = items.length >= MAIL_MOVE_SEARCH_THRESHOLD;
  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((option) => {
      const label = String(option?.label || option?.name || option?.value || '').toLowerCase();
      return label.includes(needle);
    });
  }, [items, query]);

  if (!items.length) return null;

  return (
    <>
      <ListSubheader
        data-testid="mail-move-to-heading"
        disableSticky
        sx={{
          lineHeight: '28px',
          fontSize: '0.72rem',
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: tokens?.textSecondary || 'text.secondary',
          bgcolor: 'transparent',
        }}
      >
        Переместить в
      </ListSubheader>
      {showSearch ? (
        <Box
          sx={{ px: 1.25, pb: 0.6 }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <TextField
            size="small"
            fullWidth
            autoComplete="off"
            placeholder="Найти папку"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            inputProps={{ 'data-testid': 'mail-move-to-search' }}
          />
        </Box>
      ) : null}
      {visibleItems.length > 0 ? visibleItems.map((option) => {
        const value = String(option?.value || option?.id || '');
        return (
          <MailCompactMenuItem
            key={value || option?.label}
            testId={`mail-move-to-option-${value}`}
            icon={getMailFolderMenuIcon(option)}
            label={String(option?.label || option?.name || value || 'Папка')}
            disabled={disabled}
            onClick={() => onSelect?.(value)}
          />
        );
      }) : (
        <Box sx={{ px: 1.5, py: 1 }}>
          <Typography sx={{ color: tokens?.textSecondary || 'text.secondary', fontSize: '0.82rem' }}>
            Папки не найдены
          </Typography>
        </Box>
      )}
    </>
  );
}
