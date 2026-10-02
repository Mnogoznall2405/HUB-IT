import { Autocomplete, MenuItem, Stack, TextField } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { dedupeNamedOptions, normalizeText } from './addressBookUtils';
import { useMemo } from 'react';

const FILTER_FIELD_SX = { minWidth: 0 };

// R6: the department field used to stretch across the whole row on desktop.
const DEPARTMENT_MAX_WIDTH = 420;

// Controlled pair of filter controls shared by the desktop toolbar and the
// mobile filter dialog. Options come from GET /address-book/filters.
// `inline` (T2): fields render as bare flex items so the parent row can place
// them on one line with the search field; the dialog keeps `column`.
export default function AddressBookFilters({
  departments = [],
  cities = [],
  department = '',
  city = '',
  loading = false,
  direction = 'row',
  inline = false,
  onDepartmentChange,
  onCityChange,
  onOpen,
}) {
  const theme = useTheme();
  const departmentOptions = useMemo(() => dedupeNamedOptions(departments), [departments]);
  const cityOptions = useMemo(
    () => dedupeNamedOptions(cities).map((entry) => normalizeText(entry.name)),
    [cities],
  );

  const departmentValue = departmentOptions.find((option) => option?.name === department) || null;

  const departmentField = (
    <Autocomplete
      size="small"
      options={departmentOptions}
      value={departmentValue}
      onChange={(_event, option) => onDepartmentChange?.(option?.name || '')}
      onOpen={onOpen}
      getOptionLabel={(option) => option?.name || ''}
      isOptionEqualToValue={(option, value) => option?.name === value?.name}
      loading={loading}
      loadingText="Загружаем список…"
      noOptionsText="Нет вариантов"
      clearText="Очистить"
      openText="Открыть"
      closeText="Закрыть"
      fullWidth={!inline}
      sx={inline
        ? { ...FILTER_FIELD_SX, flex: '0 1 320px', minWidth: 160 }
        : { ...FILTER_FIELD_SX, flex: { sm: '0 1 auto' }, width: { sm: DEPARTMENT_MAX_WIDTH } }}
      renderOption={(props, option) => (
        <li {...props} key={option.name}>
          {option.name}
          {option.count ? (
            <span style={{ marginLeft: 'auto', color: alpha(theme.palette.text.secondary, 0.9), fontSize: '0.75rem' }}>
              {option.count}
            </span>
          ) : null}
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder="Подразделение"
          inputProps={{
            ...params.inputProps,
            'aria-label': 'Фильтр по подразделению',
            'data-testid': 'address-book-filter-department',
          }}
        />
      )}
    />
  );

  const cityField = (
    <TextField
      select
      size="small"
      value={city}
      onChange={(event) => onCityChange?.(event.target.value)}
      // R1: lazy-load on the Select's own open and on focus — not on a
      // wrapper click, which keyboard/touch open does not always produce.
      onFocus={onOpen}
      placeholder="Город"
      sx={inline
        ? { ...FILTER_FIELD_SX, flex: '0 1 160px', minWidth: 120 }
        : { ...FILTER_FIELD_SX, minWidth: { sm: 160 }, flexShrink: 0 }}
      SelectProps={{
        displayEmpty: true,
        renderValue: (value) => (value ? value : 'Все города'),
        MenuProps: { sx: { maxHeight: 320 } },
        onOpen: onOpen,
      }}
      inputProps={{
        'aria-label': 'Фильтр по городу',
        'data-testid': 'address-book-filter-city',
      }}
    >
      <MenuItem value="">
        <em>Все города</em>
      </MenuItem>
      {cityOptions.map((name) => (
        <MenuItem key={name} value={name}>{name}</MenuItem>
      ))}
    </TextField>
  );

  if (inline) {
    return (
      <>
        {departmentField}
        {cityField}
      </>
    );
  }

  return (
    <Stack
      direction={{ xs: 'column', sm: direction }}
      spacing={1}
      sx={{ minWidth: 0 }}
      data-testid="address-book-filters"
    >
      {departmentField}
      {cityField}
    </Stack>
  );
}
