import { Box, Checkbox, Chip, LinearProgress, Stack, Typography } from '@mui/material';

export default function TaskChecklist({
  task,
  canUpdate = false,
  updatingItemId = '',
  onToggle,
  ui,
}) {
  const items = Array.isArray(task?.checklist_items) ? task.checklist_items : [];
  if (items.length === 0) return null;

  const doneCount = items.filter((item) => Boolean(item?.done)).length;
  const progress = Math.round((doneCount / items.length) * 100);

  return (
    <Box
      data-testid="task-workspace-checklist"
      sx={{
        p: 1.25,
        borderRadius: '14px',
        border: '1px solid',
        borderColor: ui.borderSoft,
        bgcolor: ui.panelSolid,
      }}
    >
      <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center" sx={{ mb: 0.8 }}>
        <Typography sx={{ fontWeight: 900 }}>Чек-лист</Typography>
        <Chip size="small" label={`${doneCount}/${items.length}`} sx={{ fontWeight: 800 }} />
      </Stack>
      <LinearProgress variant="determinate" value={progress} sx={{ height: 6, borderRadius: 999, mb: 0.8 }} />
      <Stack spacing={0.45}>
        {items.map((item, index) => {
          const itemId = String(item?.id || '');
          return (
            <Stack key={itemId || `${item?.text || 'item'}-${index}`} direction="row" spacing={0.7} alignItems="center">
              <Checkbox
                checked={Boolean(item?.done)}
                disabled={!canUpdate || updatingItemId === itemId}
                onChange={(event) => onToggle?.(itemId, event.target.checked)}
                inputProps={{ 'aria-label': `Отметить пункт ${index + 1}` }}
                sx={{ p: 0.45 }}
              />
              <Typography
                variant="body2"
                sx={{
                  color: item?.done ? ui.subtleText : ui.textPrimary,
                  textDecoration: item?.done ? 'line-through' : 'none',
                  overflowWrap: 'anywhere',
                }}
              >
                {item?.text || `Пункт ${index + 1}`}
              </Typography>
            </Stack>
          );
        })}
      </Stack>
    </Box>
  );
}
