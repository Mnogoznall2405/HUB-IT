import { useState } from 'react';
import {
  Box,
  Checkbox,
  Chip,
  Collapse,
  FormControlLabel,
  Grid,
  IconButton,
  Paper,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { getOfficeSubtlePanelSx } from '../../../theme/officeUiTokens';

// Группа инструментов агента: заголовок, счётчик «включено N из M», общий выключатель группы
// и сворачиваемый список инструментов. Включённая группа раскрыта, но её можно свернуть вручную.
export default function AiToolGroup({
  title,
  caption,
  switchLabel,
  enabled,
  onToggleGroup,
  sections = [],
  enabledTools = [],
  onToggleTool,
  extra = null,
  ui,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const allOptions = sections.flatMap((section) => section.options);
  const selectedCount = allOptions.filter((tool) => enabledTools.includes(tool.id)).length;
  const open = enabled && !collapsed;
  return (
    <Paper variant="outlined" sx={getOfficeSubtlePanelSx(ui, { p: 1.2, borderRadius: '12px' })}>
      <Stack spacing={1.1}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{title}</Typography>
              <Chip
                size="small"
                variant={enabled ? 'filled' : 'outlined'}
                color={enabled ? 'primary' : 'default'}
                label={enabled ? `включено ${selectedCount} из ${allOptions.length}` : 'выключено'}
              />
            </Stack>
            <Typography variant="caption" color="text.secondary">{caption}</Typography>
          </Box>
          <FormControlLabel
            sx={{ m: 0 }}
            control={<Switch checked={enabled} onChange={(event) => onToggleGroup(event.target.checked)} />}
            label={switchLabel}
          />
          <IconButton
            size="small"
            aria-label={open ? "Свернуть список инструментов" : "Развернуть список инструментов"}
            aria-expanded={open}
            disabled={!enabled}
            onClick={() => setCollapsed((value) => !value)}
          >
            <ExpandMoreRoundedIcon sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 140ms ease' }} />
          </IconButton>
        </Stack>
        <Collapse in={open} unmountOnExit>
          <Stack spacing={1.1}>
            {sections.map((section) => (
              <Box key={section.label || 'main'}>
                {section.label ? (
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800 }}>
                    {section.label}
                  </Typography>
                ) : null}
                <Grid container spacing={0.5}>
                  {section.options.map((tool) => (
                    <Grid item xs={12} md={6} key={tool.id}>
                      <FormControlLabel
                        control={(
                          <Checkbox
                            size="small"
                            checked={enabledTools.includes(tool.id)}
                            onChange={(event) => onToggleTool(tool.id, event.target.checked)}
                          />
                        )}
                        label={tool.label}
                      />
                    </Grid>
                  ))}
                </Grid>
              </Box>
            ))}
            {extra}
          </Stack>
        </Collapse>
      </Stack>
    </Paper>
  );
}
