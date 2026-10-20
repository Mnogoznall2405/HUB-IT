import { Autocomplete, Stack, TextField } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { dedupeNamedOptions, normalizeText } from './addressBookUtils';
import { useMemo } from 'react';

const FILTER_FIELD_SX = { minWidth: 0 };

// R6: the department field used to stretch across the whole row on desktop.
const DEPARTMENT_MAX_WIDTH = 320;

const FILTER_POPUP_SLOT_PROPS = {
  popper: {
    sx: { maxWidth: 'calc(100vw - 32px)' },
  },
};

const FILTER_LISTBOX_PROPS = {
  sx: {
    maxHeight: 320,
    '& .MuiAutocomplete-option': {
      whiteSpace: 'normal',
      overflowWrap: 'anywhere',
      height: 'auto',
    },
  },
};

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
      slotProps={FILTER_POPUP_SLOT_PROPS}
      ListboxProps={FILTER_LISTBOX_PROPS}
      sx={inline
        ? { ...FILTER_FIELD_SX, flex: '0 1 240px', minWidth: 160, maxWidth: DEPARTMENT_MAX_WIDTH }
        : { ...FILTER_FIELD_SX, width: '100%' }}
      renderOption={(props, option) => (
        <li {...props} key={option.name}>
          {option.name}
          {option.count ? (
            <span style={{ marginLeft: 'auto', paddingLeft: 8, flexShrink: 0, color: alpha(theme.palette.text.secondary, 0.9), fontSize: '0.75rem' }}>
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
    <Autocomplete
      size="small"
      options={cityOptions}
      value={city || null}
      onChange={(_event, name) => onCityChange?.(name || '')}
      onOpen={onOpen}
      loading={loading}
      loadingText="Загружаем список…"
      noOptionsText="Нет вариантов"
      clearText="Очистить"
      openText="Открыть"
      closeText="Закрыть"
      fullWidth={!inline}
      slotProps={FILTER_POPUP_SLOT_PROPS}
      ListboxProps={FILTER_LISTBOX_PROPS}
      sx={inline
        ? { ...FILTER_FIELD_SX, flex: '0 1 180px', minWidth: 120 }
        : { ...FILTER_FIELD_SX, width: '100%' }}
      renderOption={(props, name) => (
        <li {...props} key={name}>
          {name}
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder="Все города"
          inputProps={{
            ...params.inputProps,
            'aria-label': 'Фильтр по городу',
            'data-testid': 'address-book-filter-city',
            // R1: lazy-load on the Select's own open and on focus — not on a
            // wrapper click, which keyboard/touch open does not always produce.
            onFocus: (event) => {
              params.inputProps.onFocus?.(event);
              onOpen?.(event);
            },
          }}
        />
      )}
    />
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
