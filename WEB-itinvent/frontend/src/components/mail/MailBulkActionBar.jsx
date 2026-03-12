import { useMemo } from 'react';
import {
  Box,
  Button,
  FormControl,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { buildMailUiTokens, getMailSoftActionStyles } from './mailUiTokens';

export default function MailBulkActionBar({
  count,
  moveTarget,
  moveTargets,
  loading,
  onMoveTargetChange,
  onMarkRead,
  onMarkUnread,
  onArchive,
  onMove,
  onDelete,
  onClear,
}) {
  const theme = useTheme();
  const tokens = useMemo(() => buildMailUiTokens(theme), [theme]);
  const neutralActionSx = getMailSoftActionStyles(theme, tokens);
  const dangerActionSx = getMailSoftActionStyles(theme, tokens, 'error');

  return (
    <Box
      sx={{
        px: 1.2,
        py: 1,
        borderBottom: '1px solid',
        borderColor: tokens.panelBorder,
        bgcolor: tokens.surfaceBg,
      }}
    >
      <Stack
        direction={{ xs: 'column', lg: 'row' }}
        spacing={0.9}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', lg: 'center' }}
      >
        <Stack direction="row" spacing={0.7} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {`Выбрано: ${count}`}
          </Typography>
          <Button size="small" onClick={onMarkRead} disabled={loading} sx={neutralActionSx}>Прочитано</Button>
          <Button size="small" onClick={onMarkUnread} disabled={loading} sx={neutralActionSx}>Непрочитано</Button>
          <Button size="small" onClick={onArchive} disabled={loading} sx={neutralActionSx}>Архив</Button>
          <Button size="small" color="error" onClick={onDelete} disabled={loading} sx={dangerActionSx}>Удалить</Button>
          <Button size="small" onClick={onClear} disabled={loading} sx={neutralActionSx}>Снять выбор</Button>
        </Stack>
        <Stack direction="row" spacing={0.7} alignItems="center">
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <Select
              value={moveTarget}
              displayEmpty
              onChange={(event) => onMoveTargetChange(String(event.target.value || ''))}
            >
              <MenuItem value="">Куда переместить</MenuItem>
              {moveTargets.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button size="small" variant="outlined" onClick={onMove} disabled={loading || !moveTarget} sx={neutralActionSx}>
            Переместить
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
