import { Fragment } from 'react';
import {
  Box,
  Card,
  Chip,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { KANBAN_COLUMNS } from '../../../pages/tasks/taskConstants';
import { getOfficeEmptyStateSx, getOfficeHeaderBandSx, getOfficePanelSx } from '../../../theme/officeUiTokens';
import { buildMobileTaskScrollSx } from '../../../pages/tasks/taskMobileLayout';

function TasksMobileBoardView({
  ui,
  loading = false,
  taskItems = [],
  columnData = {},
  mobileBoardItems = [],
  renderTaskCard,
}) {
  return (
    <Box data-testid="tasks-mobile-board" sx={buildMobileTaskScrollSx()}>
      <Stack direction="row" spacing={0.6} sx={{ overflowX: 'auto', px: 1.35, py: 0.75, borderBottom: '1px solid', borderColor: ui.borderSoft }}>
        {KANBAN_COLUMNS.map((column) => (
          <Chip
            key={column.key}
            label={`${column.label}: ${(columnData[column.key] || []).length}`}
            sx={{ flexShrink: 0, height: 28, fontWeight: 900, bgcolor: alpha(column.color, 0.12), color: column.color }}
          />
        ))}
      </Stack>
      {loading && taskItems.length === 0 ? (
        <Stack spacing={0.8}>
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} variant="rounded" height={118} sx={{ borderRadius: '14px' }} />
          ))}
        </Stack>
      ) : mobileBoardItems.length === 0 ? (
        <Box sx={{ mx: 1.35, mt: 1, ...getOfficeEmptyStateSx(ui, { p: 1.4 }) }}>
          <Typography sx={{ fontWeight: 800, mb: 0.4 }}>Задачи по текущим фильтрам не найдены.</Typography>
          <Typography variant="body2" sx={{ color: ui.mutedText }}>
            Смените быстрый статус, фокус или расширенные фильтры.
          </Typography>
        </Box>
      ) : (
        <Stack spacing={0}>
          {KANBAN_COLUMNS.map((column) => {
            const items = columnData[column.key] || [];
            if (items.length === 0) return null;
            return (
              <Box key={column.key} sx={{ borderBottom: '1px solid', borderColor: ui.borderSoft, py: 0.85 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.55, px: 1.35 }}>
                  <Typography sx={{ fontWeight: 900, color: column.color, fontSize: '0.88rem' }}>{column.label}</Typography>
                  <Chip size="small" label={items.length} sx={{ height: 22, fontWeight: 900, bgcolor: alpha(column.color, 0.12), color: column.color }} />
                </Stack>
                <Stack spacing={0}>
                  {items.map((task) => (
                    <Fragment key={task.id}>{renderTaskCard(task, column)}</Fragment>
                  ))}
                </Stack>
              </Box>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}

function TasksDesktopBoardView({
  ui,
  theme,
  loading = false,
  taskItems = [],
  columnData = {},
  focusMode = 'all',
  renderTaskCard,
}) {
  return (
    <Box
      data-testid="tasks-desktop-kanban"
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
        gap: 1.2,
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {KANBAN_COLUMNS.map((column) => {
        const items = columnData[column.key] || [];
        return (
          <Card
            key={column.key}
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
            <Box sx={{ ...getOfficeHeaderBandSx(ui, { px: 1.2, py: 0.9, bgcolor: alpha(column.color, theme.palette.mode === 'dark' ? 0.12 : 0.08), borderColor: alpha(column.color, 0.14) }) }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography sx={{ fontWeight: 900, fontSize: '0.84rem', color: column.color }}>
                  {column.label}
                </Typography>
                <Chip size="small" label={items.length} sx={{ height: 22, minWidth: 30, fontWeight: 900, bgcolor: alpha(column.color, 0.12), color: column.color, border: 'none' }} />
              </Stack>
            </Box>

            <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', p: 1, pr: 0.8 }}>
              {loading && taskItems.length === 0 ? (
                <Stack spacing={0.8}>
                  {[0, 1, 2].map((item) => (
                    <Skeleton key={item} variant="rounded" height={110} sx={{ borderRadius: '14px' }} />
                  ))}
                </Stack>
              ) : items.length === 0 ? (
                <Box sx={{ ...getOfficeEmptyStateSx(ui, { p: 1.4 }) }}>
                  <Typography sx={{ fontWeight: 800, mb: 0.4 }}>Нет задач в колонке.</Typography>
                  <Typography variant="body2" sx={{ color: ui.mutedText }}>
                    {focusMode !== 'all'
                      ? 'Попробуйте переключить быстрый вид или ослабить фильтры.'
                      : 'Когда появятся подходящие задачи, они окажутся здесь.'}
                  </Typography>
                </Box>
              ) : (
                <Stack spacing={0.85}>
                  {items.map((task) => (
                    <Fragment key={task.id}>{renderTaskCard(task, column)}</Fragment>
                  ))}
                </Stack>
              )}
            </Box>
          </Card>
        );
      })}
    </Box>
  );
}

export default function TasksBoardView({
  isMobile = false,
  ui,
  theme,
  loading = false,
  taskItems = [],
  columnData = {},
  mobileBoardItems = [],
  focusMode = 'all',
  renderTaskCard,
}) {
  if (isMobile) {
    return (
      <TasksMobileBoardView
        ui={ui}
        loading={loading}
        taskItems={taskItems}
        columnData={columnData}
        mobileBoardItems={mobileBoardItems}
        renderTaskCard={renderTaskCard}
      />
    );
  }

  return (
    <TasksDesktopBoardView
      ui={ui}
      theme={theme}
      loading={loading}
      taskItems={taskItems}
      columnData={columnData}
      focusMode={focusMode}
      renderTaskCard={renderTaskCard}
    />
  );
}
