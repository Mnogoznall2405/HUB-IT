import { Box, IconButton, Stack, Typography } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';

export default function ChatRightPanelHeader({
  title,
  onClose,
  closeLabel = 'Закрыть',
  actions = null,
  dense = false,
}) {
  return (
    <Box
      data-testid="chat-right-panel-header"
      sx={{
        minHeight: dense ? 52 : 56,
        px: 1.5,
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        borderBottom: 1,
        borderColor: 'divider',
        flexShrink: 0,
      }}
    >
      <Typography
        variant="subtitle1"
        sx={{
          flex: 1,
          minWidth: 0,
          fontWeight: 800,
          fontSize: '1rem',
          letterSpacing: '-0.01em',
        }}
        noWrap
      >
        {title}
      </Typography>
      <Stack direction="row" spacing={0.15} alignItems="center" sx={{ flexShrink: 0 }}>
        {actions}
        {typeof onClose === 'function' ? (
          <IconButton
            aria-label={closeLabel}
            onClick={onClose}
            sx={{ width: 44, height: 44 }}
          >
            <CloseRoundedIcon />
          </IconButton>
        ) : null}
      </Stack>
    </Box>
  );
}
