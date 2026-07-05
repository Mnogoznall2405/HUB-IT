import { memo } from 'react';
import { Avatar, Box, Stack, Typography } from '@mui/material';
import { getInitials } from '../../../pages/tasks/taskFormatters';
import { getTaskUserLabel } from '../../../pages/tasks/taskUserUtils';

const TaskUserPickerRow = memo(function TaskUserPickerRow({
  userItem,
  selected = false,
  ui,
  theme,
  trailing = null,
}) {
  const label = getTaskUserLabel(userItem);
  return (
    <Stack direction="row" alignItems="center" spacing={0.75} sx={{ width: '100%', minWidth: 0 }}>
      <Avatar
        sx={{
          width: 28,
          height: 28,
          flexShrink: 0,
          bgcolor: selected ? theme.palette.primary.main : ui.actionBg,
          color: selected ? theme.palette.primary.contrastText : ui.text,
          fontSize: '0.68rem',
          fontWeight: 900,
        }}
      >
        {getInitials(label)}
      </Avatar>
      <Box sx={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
        <Typography sx={{ fontWeight: 850, fontSize: '0.86rem', lineHeight: 1.15 }} noWrap>
          {label}
        </Typography>
        {userItem?.username ? (
          <Typography variant="caption" sx={{ color: ui.subtleText, fontSize: '0.68rem', lineHeight: 1.1 }} noWrap>
            @{userItem.username}
          </Typography>
        ) : null}
      </Box>
      {trailing}
    </Stack>
  );
});

export default TaskUserPickerRow;
