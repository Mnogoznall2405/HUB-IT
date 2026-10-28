import { useEffect, useState } from 'react';
import { Autocomplete, CircularProgress, TextField } from '@mui/material';
import { itObjectsAPI } from '../../api/itObjects';
import { isItObjectsRequestCancelled, userOptionLabel } from './itObjectsShared';


const SEARCH_DEBOUNCE_MS = 300;

export default function ItObjectUserPicker({ label, value, onChange, disabled = false }) {
  const [inputValue, setInputValue] = useState('');
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (disabled) return undefined;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setFailed(false);
      try {
        const response = await itObjectsAPI.userOptions(inputValue.trim(), { signal: controller.signal });
        if (!controller.signal.aborted) setOptions(Array.isArray(response?.items) ? response.items : []);
      } catch (error) {
        if (!isItObjectsRequestCancelled(error)) {
          setOptions([]);
          setFailed(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [disabled, inputValue]);

  return (
    <Autocomplete
      fullWidth
      size="small"
      disabled={disabled}
      options={options}
      value={value}
      loading={loading}
      filterOptions={(items) => items}
      isOptionEqualToValue={(option, selected) => option.id === selected.id}
      getOptionLabel={userOptionLabel}
      onChange={(_, next) => onChange(next)}
      onInputChange={(_, next, reason) => {
        if (reason !== 'reset') setInputValue(next);
      }}
      noOptionsText={failed ? 'Не удалось загрузить список' : 'Никого не найдено'}
      loadingText="Загрузка…"
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {loading ? <CircularProgress color="inherit" size={16} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
          sx={{ '& .MuiInputBase-root': { minHeight: 44 }, '& input': { fontSize: { xs: 16, sm: 14 } } }}
        />
      )}
    />
  );
}
