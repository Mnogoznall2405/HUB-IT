import { Box, IconButton, Typography } from '@mui/material';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';

export default function TaskListSectionHeader({
  label,
  count = 0,
  collapsible = false,
  expanded = true,
  onToggle,
  ui,
}) {
  const content = (
    <>
      <Typography component="span" sx={{ fontWeight: 900, fontSize: '0.72rem', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {label}
      </Typography>
      <Typography component="span" sx={{ ml: 0.6, color: ui?.subtleText, fontWeight: 800, fontSize: '0.72rem' }}>
        {count}
      </Typography>
    </>
  );

  if (!collapsible) {
    return (
      <Box
        data-testid="task-section-active"
        sx={{
          display: 'flex',
          alignItems: 'center',
          px: { xs: 1.35, md: 1.5 },
          pt: { xs: 1.1, md: 1.25 },
          pb: { xs: 0.45, md: 0.55 },
        }}
      >
        {content}
      </Box>
    );
  }

  return (
    <Box
      component="button"
      type="button"
      data-testid="task-section-completed-toggle"
      aria-expanded={expanded}
      onClick={onToggle}
      sx={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        px: { xs: 1.35, md: 1.5 },
        pt: { xs: 1.1, md: 1.25 },
        pb: { xs: 0.45, md: 0.55 },
        border: 'none',
        bgcolor: 'transparent',
        color: ui?.text,
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
        {content}
      </Box>
      <IconButton
        component="span"
        size="small"
        tabIndex={-1}
        sx={{
          transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
          transition: 'transform 140ms ease',
          color: ui?.subtleText,
        }}
      >
        <KeyboardArrowDownRoundedIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}
