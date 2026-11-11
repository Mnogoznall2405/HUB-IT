import { memo } from 'react';
import { Autocomplete, Box, Grid, TextField, Typography } from '@mui/material';

import { formatConsumableSourceLabel, toConsumableSourceOption } from './consumableModel';
import { toNumberOrNull } from './databaseRecordModel';

export const formatActionConsumableSourceSummary = (source) => {
  if (!source) return 'Источник не выбран';
  return `Источник: ${source.branch_name || '-'} / ${source.location_name || '-'} | Остаток: ${source.qty}`;
};

const ActionConsumableSelect = memo(function ActionConsumableSelect({
  options = [],
  loading = false,
  value = null,
  onChange,
  label,
  noOptionsText = 'Расходники не найдены',
  isMobile = false,
}) {
  return (
    <Grid container spacing={2}>
      <Grid item xs={12}>
        <Autocomplete
          options={options}
          loading={loading}
          value={value}
          onChange={(_, nextValue) => onChange?.(nextValue || null)}
          isOptionEqualToValue={(option, selectedValue) =>
            toNumberOrNull(option?.id) === toNumberOrNull(selectedValue?.id)
          }
          getOptionLabel={(option) => formatConsumableSourceLabel(option)}
          renderOption={(props, option) => {
            const { key, ...restProps } = props;
            const normalized = toConsumableSourceOption(option);
            return (
              <li key={key} {...restProps}>
                <Box sx={{ display: 'grid' }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {normalized.model_name || '-'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {normalized.type_name || '-'} | {normalized.branch_name || '-'} / {normalized.location_name || '-'} | Остаток: {normalized.qty}
                  </Typography>
                </Box>
              </li>
            );
          }}
          noOptionsText={noOptionsText}
          renderInput={(params) => (
            <TextField
              {...params}
              label={label}
              placeholder="Выберите расходник из таблицы"
              size={isMobile ? 'medium' : 'small'}
              helperText="В списке виден источник: филиал и местоположение"
            />
          )}
        />
      </Grid>
      <Grid item xs={12}>
        <Typography variant="body2" color="text.secondary">
          {formatActionConsumableSourceSummary(value)}
        </Typography>
      </Grid>
    </Grid>
  );
});

export default ActionConsumableSelect;
