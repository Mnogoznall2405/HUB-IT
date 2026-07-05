import {
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  analyticsDateBasisOptions,
  analyticsPresetOptions,
  buildAnalyticsRangeFromPreset,
} from '../../../pages/tasks/taskAnalyticsModel';
import { areSameTaskUsers, getTaskUserLabel } from '../../../pages/tasks/taskUserUtils';
import { getOfficeSubtlePanelSx } from '../../../theme/officeUiTokens';

export default function TasksAnalyticsFiltersPanel({
  ui,
  analyticsAccentColor = '#2563eb',
  analyticsFilters,
  onFiltersChange,
  analyticsFilterFieldSx,
  activeTaskProjects = [],
  analyticsObjectOptions = [],
  activeTaskObjects = [],
  analyticsFocusMeta,
  selectedAnalyticsParticipant = null,
  getAssigneePickerOptions,
  selectedAnalyticsParticipantOption = null,
  onParticipantChange,
  handleSingleAssigneeAutocompleteChange,
  renderTaskUserOption,
  taskUserAutocompleteSlotProps,
  assigneeAutocompleteProps,
  getAssigneeAutocompleteInputValue,
}) {
  const setAnalyticsFilters = (updater) => {
    if (typeof updater === 'function') {
      onFiltersChange?.(updater(analyticsFilters));
      return;
    }
    onFiltersChange?.(updater);
  };

  return (
    <Stack spacing={0.8}>
      <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.85, borderRadius: '13px' }) }}>
        <Typography sx={{ fontWeight: 800, mb: 0.65 }}>Период отчёта</Typography>
        <Grid container spacing={1}>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth size="small" sx={analyticsFilterFieldSx}>
              <InputLabel id="analytics-preset-label">Период</InputLabel>
              <Select
                labelId="analytics-preset-label"
                label="Период"
                value={analyticsFilters.preset}
                onChange={(event) => {
                  const preset = event.target.value;
                  const range = buildAnalyticsRangeFromPreset(preset);
                  setAnalyticsFilters((prev) => ({ ...prev, preset, ...range }));
                }}
              >
                {analyticsPresetOptions.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth size="small" sx={analyticsFilterFieldSx}>
              <InputLabel id="analytics-date-basis-label">База дат</InputLabel>
              <Select
                labelId="analytics-date-basis-label"
                label="База дат"
                value={analyticsFilters.date_basis}
                onChange={(event) => setAnalyticsFilters((prev) => ({ ...prev, date_basis: event.target.value }))}
              >
                {analyticsDateBasisOptions.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              size="small"
              type="date"
              label="Дата с"
              value={analyticsFilters.start_date}
              onChange={(event) => setAnalyticsFilters((prev) => ({ ...prev, preset: 'custom', start_date: event.target.value }))}
              InputLabelProps={{ shrink: true }}
              sx={analyticsFilterFieldSx}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              size="small"
              type="date"
              label="Дата по"
              value={analyticsFilters.end_date}
              onChange={(event) => setAnalyticsFilters((prev) => ({ ...prev, preset: 'custom', end_date: event.target.value }))}
              InputLabelProps={{ shrink: true }}
              sx={analyticsFilterFieldSx}
            />
          </Grid>
        </Grid>
      </Box>

      <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.85, borderRadius: '13px' }) }}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={0.8} sx={{ mb: 0.75 }}>
          <Box>
            <Typography sx={{ fontWeight: 800 }}>Срез отчёта</Typography>
            <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mt: 0.2 }}>
              Выберите проект, затем при необходимости объект. Участник дополнительно сузит отчёт до конкретного исполнителя.
            </Typography>
          </Box>
          <Button
            size="small"
            variant="outlined"
            onClick={() => setAnalyticsFilters((prev) => ({ ...prev, project_ids: [], object_ids: [], participant_user_id: '' }))}
            sx={{ alignSelf: { xs: 'stretch', md: 'flex-start' }, textTransform: 'none', fontWeight: 800 }}
          >
            Сбросить срез
          </Button>
        </Stack>

        <Grid container spacing={1}>
          <Grid item xs={12} lg={5}>
            <FormControl fullWidth size="small" sx={analyticsFilterFieldSx}>
              <InputLabel id="analytics-projects-label">Проекты</InputLabel>
              <Select
                multiple
                labelId="analytics-projects-label"
                label="Проекты"
                value={analyticsFilters.project_ids}
                onChange={(event) => setAnalyticsFilters((prev) => ({
                  ...prev,
                  project_ids: Array.isArray(event.target.value) ? event.target.value : [],
                  object_ids: [],
                }))}
                renderValue={(selected) => {
                  const ids = Array.isArray(selected) ? selected : [];
                  if (ids.length === 0) return 'Все проекты';
                  return ids
                    .map((value) => activeTaskProjects.find((item) => String(item.id) === String(value))?.name)
                    .filter(Boolean)
                    .join(', ');
                }}
              >
                {activeTaskProjects.map((item) => (
                  <MenuItem key={item.id} value={String(item.id)}>
                    <Checkbox checked={analyticsFilters.project_ids.includes(String(item.id))} />
                    <Typography>{item.name}</Typography>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} lg={4}>
            <FormControl fullWidth size="small" sx={analyticsFilterFieldSx}>
              <InputLabel id="analytics-objects-label">Объекты</InputLabel>
              <Select
                multiple
                labelId="analytics-objects-label"
                label="Объекты"
                value={analyticsFilters.object_ids}
                onChange={(event) => setAnalyticsFilters((prev) => ({
                  ...prev,
                  object_ids: Array.isArray(event.target.value) ? event.target.value : [],
                }))}
                renderValue={(selected) => {
                  const ids = Array.isArray(selected) ? selected : [];
                  if (ids.length === 0) return 'Все объекты';
                  return ids
                    .map((value) => activeTaskObjects.find((item) => String(item.id) === String(value))?.name)
                    .filter(Boolean)
                    .join(', ');
                }}
              >
                {analyticsObjectOptions.map((item) => (
                  <MenuItem key={item.id} value={String(item.id)}>
                    <Checkbox checked={analyticsFilters.object_ids.includes(String(item.id))} />
                    <Typography>{item.name}</Typography>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} lg={3}>
            <Autocomplete
              fullWidth
              size="small"
              options={getAssigneePickerOptions(selectedAnalyticsParticipantOption)}
              value={selectedAnalyticsParticipantOption}
              onChange={handleSingleAssigneeAutocompleteChange((value) => {
                onParticipantChange?.(String(value?.id || ''));
              })}
              getOptionLabel={getTaskUserLabel}
              isOptionEqualToValue={areSameTaskUsers}
              clearOnEscape
              renderOption={renderTaskUserOption}
              slotProps={taskUserAutocompleteSlotProps}
              {...assigneeAutocompleteProps}
              inputValue={getAssigneeAutocompleteInputValue(selectedAnalyticsParticipantOption)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Участник"
                  placeholder="Фамилия или логин"
                  sx={analyticsFilterFieldSx}
                  inputProps={{
                    ...params.inputProps,
                    'data-testid': 'analytics-participant-select',
                  }}
                />
              )}
            />
          </Grid>
        </Grid>
      </Box>

      <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.8, borderRadius: '13px' }) }}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={0.8}>
          <Box>
            <Typography sx={{ fontWeight: 800 }}>{analyticsFocusMeta.title}</Typography>
            <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mt: 0.2 }}>
              {analyticsFocusMeta.description}
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.6} flexWrap="wrap" sx={{ gap: 0.6 }}>
            {analyticsFocusMeta.chips.length > 0 ? analyticsFocusMeta.chips.map((item) => (
              <Chip
                key={item.key}
                size="small"
                label={item.label}
                sx={{ height: 24, fontWeight: 800, bgcolor: item.bg, color: item.color }}
              />
            )) : (
              <Chip
                size="small"
                label="Все проекты и объекты"
                sx={{ height: 24, fontWeight: 800, bgcolor: alpha(analyticsAccentColor, 0.12), color: analyticsAccentColor }}
              />
            )}
            {selectedAnalyticsParticipant ? (
              <Chip
                size="small"
                label={`Участник: ${selectedAnalyticsParticipant.participant_name || 'Не назначен'}`}
                sx={{ height: 24, fontWeight: 800, bgcolor: alpha('#7c3aed', 0.12), color: '#7c3aed' }}
              />
            ) : null}
          </Stack>
        </Stack>
      </Box>
    </Stack>
  );
}
