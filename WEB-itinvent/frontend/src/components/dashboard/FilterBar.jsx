import React from 'react';
import {
  Box,
  Card,
  Checkbox,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import FilterListIcon from '@mui/icons-material/FilterList';
import RefreshIcon from '@mui/icons-material/Refresh';
import CloseIcon from '@mui/icons-material/Close';

const FilterBar = React.memo(({
  filters,
  setFilters,
  onReset,
  onRefresh,
  ui,
  isMobile,
}) => {
  const { q, priority, unreadOnly, ackOnly, pinnedOnly, hasAttachments, myTargetedOnly } = filters;

  const activeFilterCount = React.useMemo(() => {
    return [priority, unreadOnly, ackOnly, pinnedOnly, hasAttachments, myTargetedOnly].filter(Boolean).length;
  }, [priority, unreadOnly, ackOnly, pinnedOnly, hasAttachments, myTargetedOnly]);

  const handleSetFilter = React.useCallback((key, value) => {
    if (setFilters) {
      setFilters(prev => ({ ...prev, [key]: value }));
    }
  }, [setFilters]);

  return (
    <Card
      sx={{
        ...ui.panelSolid,
        p: isMobile ? 1.5 : 2,
        mb: 2,
      }}
    >
      <Stack spacing={2}>
        {/* Search and Actions Row */}
        <Grid container spacing={1.5} alignItems="center">
          {/* Search Field */}
          <Grid item xs={12} sm>
            <TextField
              fullWidth
              size="small"
              placeholder="Поиск по заметкам..."
              value={q || ''}
              onChange={(e) => handleSetFilter('q', e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: ui.mutedFg, fontSize: 20 }} />
                  </InputAdornment>
                ),
                sx: {
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2,
                  },
                },
              }}
            />
          </Grid>

          {/* Priority Filter */}
          <Grid item xs={6} sm="auto">
            <Select
              fullWidth
              size="small"
              value={priority || ''}
              onChange={(e) => handleSetFilter('priority', e.target.value)}
              displayEmpty
              sx={{
                borderRadius: 2,
                minWidth: 140,
              }}
            >
              <MenuItem value="">Все приоритеты</MenuItem>
              <MenuItem value="high">Высокий</MenuItem>
              <MenuItem value="normal">Обычный</MenuItem>
              <MenuItem value="low">Низкий</MenuItem>
            </Select>
          </Grid>

          {/* Filter Toggle Icon (Mobile) */}
          {isMobile && (
            <Grid item xs={6}>
              <Stack direction="row" spacing={1} justifyContent="flex-end">
                <Tooltip title={`Фильтры${activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}`}>
                  <IconButton
                    onClick={() => handleSetFilter('filtersOpen', true)}
                    sx={{
                      backgroundColor: activeFilterCount > 0 ? ui.accentBg : 'transparent',
                      color: activeFilterCount > 0 ? ui.accentFg : ui.panelFg,
                      '&:hover': {
                        backgroundColor: activeFilterCount > 0 ? `${ui.accentBg}dd` : ui.borderSoft,
                      },
                    }}
                  >
                    <FilterListIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Обновить">
                  <IconButton
                    onClick={onRefresh}
                    sx={{
                      '&:hover': {
                        backgroundColor: ui.borderSoft,
                      },
                    }}
                  >
                    <RefreshIcon />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Grid>
          )}
        </Grid>

        {/* Desktop Filters */}
        {!isMobile && (
          <Box>
            <Grid container spacing={2}>
              {/* Checkboxes */}
              <Grid item xs={12} md={8}>
                <Stack direction="row" spacing={2} flexWrap="wrap">
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
              </Grid>

              {/* Actions */}
              <Grid item xs={12} md={4}>
                <Stack direction="row" spacing={1} justifyContent="flex-end">
                  {(priority || unreadOnly || ackOnly || pinnedOnly || hasAttachments || myTargetedOnly) && (
                    <Tooltip title="Сбросить фильтры">
                      <IconButton
                        onClick={onReset}
                        size="small"
                        sx={{
                          color: ui.accentFg,
                          '&:hover': {
                            backgroundColor: ui.accentBg,
                          },
                        }}
                      >
                        <CloseIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                  <Tooltip title="Обновить">
                    <IconButton
                      onClick={onRefresh}
                      size="small"
                      sx={{
                        '&:hover': {
                          backgroundColor: ui.borderSoft,
                        },
                      }}
                    >
                      <RefreshIcon />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Grid>
            </Grid>
          </Box>
        )}
      </Stack>
    </Card>
  );
});

FilterBar.displayName = 'FilterBar';

export default FilterBar;
