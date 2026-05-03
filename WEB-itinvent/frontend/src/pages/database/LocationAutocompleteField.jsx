import { Children, forwardRef, memo, useMemo, useState } from 'react';
import { Autocomplete, Box, TextField } from '@mui/material';
import {
  filterLocationOptions,
  formatLocationOptionLabel,
} from './databaseOptionModel';

export {
  filterLocationOptions,
  formatLocationOptionLabel,
  normalizeLocationOption,
} from './databaseOptionModel';

const LOCATION_LIST_ITEM_HEIGHT = 40;
const LOCATION_LIST_MAX_VISIBLE = 8;
const LOCATION_LIST_OVERSCAN = 4;

const VirtualizedAutocompleteListbox = forwardRef(function VirtualizedAutocompleteListbox(props, ref) {
  const { children, ...other } = props;
  const items = Children.toArray(children);
  const [scrollTop, setScrollTop] = useState(0);
  const itemCount = items.length;
  const viewportHeight = Math.min(LOCATION_LIST_MAX_VISIBLE, Math.max(1, itemCount)) * LOCATION_LIST_ITEM_HEIGHT;

  const startIndex = Math.max(0, Math.floor(scrollTop / LOCATION_LIST_ITEM_HEIGHT) - LOCATION_LIST_OVERSCAN);
  const endIndex = Math.min(
    itemCount,
    Math.ceil((scrollTop + viewportHeight) / LOCATION_LIST_ITEM_HEIGHT) + LOCATION_LIST_OVERSCAN
  );

  const topSpacerHeight = startIndex * LOCATION_LIST_ITEM_HEIGHT;
  const bottomSpacerHeight = Math.max(0, (itemCount - endIndex) * LOCATION_LIST_ITEM_HEIGHT);

  return (
    <Box
      ref={ref}
      component="ul"
      {...other}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      sx={{
        m: 0,
        p: 0,
        listStyle: 'none',
        maxHeight: viewportHeight,
        overflowY: 'auto',
        overflowX: 'hidden',
        scrollbarGutter: 'stable',
        '& li': {
          minHeight: LOCATION_LIST_ITEM_HEIGHT,
          boxSizing: 'border-box',
        },
      }}
    >
      {topSpacerHeight > 0 && <li aria-hidden="true" style={{ height: topSpacerHeight }} />}
      {items.slice(startIndex, endIndex)}
      {bottomSpacerHeight > 0 && <li aria-hidden="true" style={{ height: bottomSpacerHeight }} />}
    </Box>
  );
});

const LocationAutocompleteField = memo(function LocationAutocompleteField({
  label,
  value,
  options,
  onChange,
  disabled = false,
  loading = false,
  required = false,
  size = 'small',
}) {
  const selectedOption = useMemo(
    () => (Array.isArray(options) ? options.find((option) => option.loc_no === value) || null : null),
    [options, value]
  );

  return (
    <Autocomplete
      options={options}
      value={selectedOption}
      onChange={(_, next) => onChange(next?.loc_no || '')}
      disabled={disabled}
      loading={loading}
      ListboxComponent={VirtualizedAutocompleteListbox}
      filterOptions={filterLocationOptions}
      getOptionLabel={formatLocationOptionLabel}
      isOptionEqualToValue={(option, selected) => option.loc_no === selected.loc_no}
      noOptionsText="Ничего не найдено"
      renderOption={(props, option) => (
        <li {...props} key={option.loc_no || formatLocationOptionLabel(option)}>
          {formatLocationOptionLabel(option)}
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          required={required}
          size={size}
          placeholder="Начните вводить название или код"
        />
      )}
    />
  );
});

export default LocationAutocompleteField;
