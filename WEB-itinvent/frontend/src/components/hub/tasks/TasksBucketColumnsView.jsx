import { Fragment } from 'react';
import {
  Box,
  Card,
  Chip,
  IconButton,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import { getOfficeEmptyStateSx, getOfficeHeaderBandSx, getOfficePanelSx } from '../../../theme/officeUiTokens';
import { buildMobileTaskScrollSx } from '../../../pages/tasks/taskMobileLayout';

export default function TasksBucketColumnsView({
  isMobile = false,
  ui,
  buckets = [],
  testId,
  showCreateButtons = false,
  loading = false,
  taskItems = [],
  canCreateTasks = false,
  onCreateWithPreset,
  renderTaskCard,
}) {
  const theme = useTheme();

  if (isMobile) {
    return (
      <Box data-testid={testId} sx={buildMobileTaskScrollSx()}>
        <Stack spacing={0}>
          {buckets.map((bucket) => (
            <Box
              key={bucket.key}
              sx={{
                py: 0.9,
                borderBottom: '1px solid',
                borderColor: ui.borderSoft,
              }}
            >
              <Stack spacing={0.7}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={0.75} sx={{ px: 1.35 }}>
                  <Stack direction="row" spacing={0.65} alignItems="center" sx={{ minWidth: 0 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '999px', bgcolor: bucket.color, flexShrink: 0 }} />
                    <Typography sx={{ fontWeight: 900, color: bucket.color, minWidth: 0 }}>
                      {bucket.label}
                    </Typography>
                    <Chip size="small" label={bucket.items.length} sx={{ height: 22, fontWeight: 900, bgcolor: alpha(bucket.color, 0.12), color: bucket.color }} />
                  </Stack>
                  {showCreateButtons && canCreateTasks ? (
                    <IconButton
                      size="small"
                      aria-label={`Создать задачу: ${bucket.label}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onCreateWithPreset?.({ due_at: bucket.createDueAt });
                      }}
                      sx={{ width: 30, height: 30, color: bucket.color }}
                    >
                      <AddIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                  ) : null}
                </Stack>
                {bucket.items.length === 0 ? (
                  <Box sx={{ mx: 1.35, ...getOfficeEmptyStateSx(ui, { p: 1 }) }}>
                    <Typography sx={{ fontWeight: 800 }}>Нет задач.</Typography>
                  </Box>
                ) : (
                  <Stack spacing={0}>
                    {bucket.items.map((task) => (
                      <Fragment key={task.id}>{renderTaskCard(task, bucket)}</Fragment>
                    ))}
                  </Stack>
                )}
              </Stack>
            </Box>
          ))}
        </Stack>
      </Box>
    );
  }

  return (
    <Box
      data-testid={testId}
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: '1fr',
          md: 'repeat(2, minmax(0, 1fr))',
          xl: `repeat(${Math.min(buckets.length, 7)}, minmax(0, 1fr))`,
        },
        gap: 1,
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {buckets.map((bucket) => (
        <Card
          key={bucket.key}
          sx={{
            ...getOfficePanelSx(ui),
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            height: '100%',
            borderRadius: '16px',
            overflow: 'hidden',
          }}
        >
          <Box sx={{ ...getOfficeHeaderBandSx(ui, { px: 1, py: 0.85, bgcolor: alpha(bucket.color, theme.palette.mode === 'dark' ? 0.12 : 0.08), borderColor: alpha(bucket.color, 0.14) }) }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={0.6}>
              <Typography sx={{ fontWeight: 900, fontSize: '0.8rem', color: bucket.color, minWidth: 0 }}>
                {bucket.label}
              </Typography>
              <Stack direction="row" spacing={0.35} alignItems="center" sx={{ flexShrink: 0 }}>
                <Chip size="small" label={bucket.items.length} sx={{ height: 22, minWidth: 30, fontWeight: 900, bgcolor: alpha(bucket.color, 0.12), color: bucket.color, border: 'none' }} />
                {showCreateButtons && canCreateTasks ? (
                  <Tooltip title="Создать задачу">
                    <IconButton
                      size="small"
                      aria-label={`Создать задачу: ${bucket.label}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onCreateWithPreset?.({ due_at: bucket.createDueAt });
                      }}
                      sx={{ width: 24, height: 24, color: bucket.color }}
                    >
                      <AddIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                ) : null}
              </Stack>
            </Stack>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', p: 0.85 }}>
            {loading && taskItems.length === 0 ? (
              <Stack spacing={0.8}>
                {[0, 1, 2].map((item) => (
                  <Skeleton key={item} variant="rounded" height={94} sx={{ borderRadius: '14px' }} />
                ))}
              </Stack>
            ) : bucket.items.length === 0 ? (
              <Box sx={{ ...getOfficeEmptyStateSx(ui, { p: 1.1 }) }}>
                <Typography sx={{ fontWeight: 800 }}>Нет задач.</Typography>
              </Box>
            ) : (
              <Stack spacing={0.8}>
                {bucket.items.map((task) => (
                  <Fragment key={task.id}>{renderTaskCard(task, bucket)}</Fragment>
                ))}
              </Stack>
            )}
          </Box>
        </Card>
      ))}
    </Box>
  );
}
