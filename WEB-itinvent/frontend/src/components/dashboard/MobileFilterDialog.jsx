import React from 'react';
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Typography,
} from '@mui/material';

const MobileFilterDialog = React.memo(({
  open,
  onClose,
  filters,
  setFilters,
  onReset,
}) => {
  const { priority, unreadOnly, ackOnly, pinnedOnly, hasAttachments, myTargetedOnly } = filters;

  const handleSetFilter = React.useCallback((key, value) => {
    if (setFilters) {
      setFilters(prev => ({ ...prev, [key]: value }));
    }
  }, [setFilters]);

  const activeFilterCount = React.useMemo(() => {
    return [priority, unreadOnly, ackOnly, pinnedOnly, hasAttachments, myTargetedOnly].filter(Boolean).length;
  }, [priority, unreadOnly, ackOnly, pinnedOnly, hasAttachments, myTargetedOnly]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      PaperProps={{
        sx: {
          borderRadius: 0,
        },
      }}
    >
      <DialogTitle sx={{ borderBottom: '1px solid rgba(0,0,0,0.12)' }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          Фильтры{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: 3 }}>
        <Stack spacing={3}>
          {/* Priority Filter */}
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
              Приоритет
            </Typography>
            <Stack spacing={1}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={!priority}
                    onChange={() => handleSetFilter('priority', '')}
                    size="small"
                  />
                }
                label={<Typography variant="body2">Все приоритеты</Typography>}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={priority === 'high'}
                    onChange={() => handleSetFilter('priority', 'high')}
                    size="small"
                  />
                }
                label={<Typography variant="body2">Высокий</Typography>}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={priority === 'normal'}
                    onChange={() => handleSetFilter('priority', 'normal')}
                    size="small"
                  />
                }
                label={<Typography variant="body2">Обычный</Typography>}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={priority === 'low'}
                    onChange={() => handleSetFilter('priority', 'low')}
                    size="small"
                  />
                }
                label={<Typography variant="body2">Низкий</Typography>}
              />
            </Stack>
          </Box>

          {/* Status Filters */}
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
              Статус
            </Typography>
            <Stack spacing={1}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={unreadOnly || false}
                    onChange={(e) => handleSetFilter('unreadOnly', e.target.checked)}
                    size="small"
                  />
                }
                label={<Typography variant="body2">Только непрочитанные</Typography>}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={ackOnly || false}
                    onChange={(e) => handleSetFilter('ackOnly', e.target.checked)}
                    size="small"
                  />
                }
                label={<Typography variant="body2">Требуют подтверждения</Typography>}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={pinnedOnly || false}
                    onChange={(e) => handleSetFilter('pinnedOnly', e.target.checked)}
                    size="small"
                  />
                }
                label={<Typography variant="body2">Закреплённые</Typography>}
              />
            </Stack>
          </Box>

          {/* Content Filters */}
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
              Содержимое
            </Typography>
            <Stack spacing={1}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={hasAttachments || false}
                    onChange={(e) => handleSetFilter('hasAttachments', e.target.checked)}
                    size="small"
                  />
                }
                label={<Typography variant="body2">С вложениями</Typography>}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={myTargetedOnly || false}
                    onChange={(e) => handleSetFilter('myTargetedOnly', e.target.checked)}
                    size="small"
                  />
                }
                label={<Typography variant="body2">Адресные мне</Typography>}
              />
            </Stack>
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ p: 2, borderTop: '1px solid rgba(0,0,0,0.12)' }}>
        <Button
          onClick={onReset}
          color="secondary"
          disabled={activeFilterCount === 0}
        >
          Сбросить
        </Button>
        <Button
          onClick={onClose}
          variant="contained"
        >
          Применить
        </Button>
      </DialogActions>
    </Dialog>
  );
});

MobileFilterDialog.displayName = 'MobileFilterDialog';

export default MobileFilterDialog;
