import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import SearchIcon from '@mui/icons-material/Search';
import useDebounce from '../../../hooks/useDebounce';
import { TASK_ASSIGNEE_SEARCH_MIN_CHARS } from '../../../hooks/useTaskAssigneeDirectory';
import { hideMobileScrollbarSx } from '../../../pages/tasks/taskFormatters';
import { getTaskUserLabel, getTaskUserSearchText } from '../../../pages/tasks/taskUserUtils';
import TaskUserPickerRow from './TaskUserPickerRow';

const MobileCreateUserPicker = memo(function MobileCreateUserPicker({
  options = [],
  selectedIds = [],
  onChange,
  onClear,
  onDone,
  multiple = true,
  searchPlaceholder = 'Фамилия или логин',
  searchAriaLabel = 'Поиск пользователей',
  testIdPrefix = 'create-assignees-mobile',
  optionTestIdPrefix = 'create-assignee-mobile-option',
  loading = false,
  loadError = '',
  onRetry,
  onSearchUsers,
  resolveUsers,
  minSearchChars = TASK_ASSIGNEE_SEARCH_MIN_CHARS,
  emptySearchHint = 'Введите фамилию или логин (минимум 2 символа)',
  ui,
  theme,
}) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);
  const [serverOptions, setServerOptions] = useState([]);
  const [resolvedOptions, setResolvedOptions] = useState([]);
  const [serverLoading, setServerLoading] = useState(false);
  const [serverError, setServerError] = useState('');
  const searchRequestRef = useRef(0);
  const selectedSet = useMemo(() => new Set((Array.isArray(selectedIds) ? selectedIds : []).map((item) => String(item || ''))), [selectedIds]);
  const serverSearchEnabled = typeof onSearchUsers === 'function';

  useEffect(() => {
    if (!serverSearchEnabled || typeof resolveUsers !== 'function') return;
    const ids = [...selectedSet];
    if (!ids.length) {
      setResolvedOptions([]);
      return;
    }
    let cancelled = false;
    void resolveUsers(ids)
      .then((items) => {
        if (!cancelled) setResolvedOptions(Array.isArray(items) ? items : []);
      })
      .catch(() => {
        if (!cancelled) setResolvedOptions([]);
      });
    return () => { cancelled = true; };
  }, [resolveUsers, selectedSet, serverSearchEnabled]);

  useEffect(() => {
    if (!serverSearchEnabled) return;
    const normalizedQuery = String(debouncedQuery || '').trim();
    if (normalizedQuery.length < minSearchChars) {
      setServerOptions([]);
      setServerError('');
      setServerLoading(false);
      return undefined;
    }

    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    setServerLoading(true);
    setServerError('');

    let cancelled = false;
    void onSearchUsers(normalizedQuery)
      .then((items) => {
        if (cancelled || searchRequestRef.current !== requestId) return;
        setServerOptions(Array.isArray(items) ? items : []);
      })
      .catch((error) => {
        if (cancelled || searchRequestRef.current !== requestId) return;
        setServerOptions([]);
        setServerError(String(error?.response?.data?.detail || error?.message || 'Не удалось найти пользователей'));
      })
      .finally(() => {
        if (!cancelled && searchRequestRef.current === requestId) {
          setServerLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [debouncedQuery, minSearchChars, onSearchUsers, serverSearchEnabled]);

  const filteredOptions = useMemo(() => {
    if (serverSearchEnabled) {
      const byId = new Map();
      resolvedOptions.forEach((item) => {
        const id = String(item?.id || '').trim();
        if (id && selectedSet.has(id)) byId.set(id, item);
      });
      serverOptions.forEach((item) => {
        const id = String(item?.id || '').trim();
        if (id) byId.set(id, item);
      });
      return [...byId.values()];
    }
    const normalizedQuery = String(query || '').trim().toLowerCase();
    const source = Array.isArray(options) ? options : [];
    if (!normalizedQuery) return source;
    return source.filter((item) => getTaskUserSearchText(item).includes(normalizedQuery));
  }, [options, query, resolvedOptions, selectedSet, serverOptions, serverSearchEnabled]);

  const effectiveLoading = serverSearchEnabled ? serverLoading : loading;
  const effectiveError = serverSearchEnabled ? serverError : loadError;
  const trimmedQuery = String(query || '').trim();
  const showSearchHint = serverSearchEnabled && trimmedQuery.length < minSearchChars;

  const handleToggle = useCallback((userItem) => {
    const id = String(userItem?.id || '');
    if (!id) return;
    if (!multiple) {
      onChange?.(selectedSet.has(id) ? [] : [id]);
      return;
    }
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange?.([...next]);
  }, [multiple, onChange, selectedSet]);

  return (
    <Stack spacing={0.75} sx={{ height: '100%', minHeight: 0 }}>
      <TextField
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoFocus
        fullWidth
        size="small"
        placeholder={searchPlaceholder}
        inputProps={{ 'data-testid': `${testIdPrefix}-search`, 'aria-label': searchAriaLabel }}
        InputProps={{
          startAdornment: <SearchIcon sx={{ fontSize: 17, color: ui.subtleText, mr: 0.6 }} />,
        }}
        sx={{
          flexShrink: 0,
          '& .MuiOutlinedInput-root': {
            minHeight: 40,
            borderRadius: '12px',
            bgcolor: ui.actionBg,
            fontSize: '0.88rem',
            '& fieldset': { borderColor: 'transparent' },
            '&:hover fieldset': { borderColor: 'transparent' },
            '&.Mui-focused fieldset': { borderColor: 'transparent' },
          },
        }}
      />

      <Box sx={{ flex: '1 1 auto', minHeight: '45dvh', maxHeight: '62dvh', overflowY: 'auto', ...hideMobileScrollbarSx }}>
        <Stack spacing={0.1}>
          {filteredOptions.map((item) => {
            const id = String(item?.id || '');
            const selected = selectedSet.has(id);
            const label = getTaskUserLabel(item);
            return (
              <Button
                key={id || label}
                type="button"
                data-testid={`${optionTestIdPrefix}-${id}`}
                onClick={() => handleToggle(item)}
                sx={{
                  minHeight: 44,
                  py: 0.35,
                  justifyContent: 'stretch',
                  textTransform: 'none',
                  borderRadius: '10px',
                  px: 0.55,
                  color: ui.text,
                  bgcolor: selected ? alpha(theme.palette.primary.main, 0.13) : 'transparent',
                  '&:hover': { bgcolor: selected ? alpha(theme.palette.primary.main, 0.17) : ui.actionHover },
                }}
              >
                <TaskUserPickerRow
                  userItem={item}
                  selected={selected}
                  ui={ui}
                  theme={theme}
                  trailing={(
                    <Checkbox
                      checked={selected}
                      tabIndex={-1}
                      size="small"
                      sx={{ p: 0.15, flexShrink: 0, '& .MuiSvgIcon-root': { fontSize: 20 } }}
                    />
                  )}
                />
              </Button>
            );
          })}
          {filteredOptions.length === 0 ? (
            effectiveLoading ? (
              <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ py: 3 }}>
                <CircularProgress size={26} />
                <Typography variant="body2" sx={{ color: ui.mutedText, fontSize: '0.86rem' }}>
                  Поиск...
                </Typography>
              </Stack>
            ) : showSearchHint ? (
              <Typography variant="body2" sx={{ color: ui.mutedText, py: 1.5, textAlign: 'center', fontSize: '0.86rem' }}>
                {emptySearchHint}
              </Typography>
            ) : effectiveError ? (
              <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ py: 2.5, px: 1 }}>
                <Typography variant="body2" sx={{ color: theme.palette.error.main, textAlign: 'center', fontSize: '0.86rem' }}>
                  {effectiveError}
                </Typography>
                {onRetry || (serverSearchEnabled && trimmedQuery.length >= minSearchChars) ? (
                  <Button
                    size="small"
                    variant="outlined"
                    data-testid={`${testIdPrefix}-retry`}
                    onClick={() => {
                      if (serverSearchEnabled && trimmedQuery.length >= minSearchChars) {
                        void onSearchUsers(trimmedQuery);
                        return;
                      }
                      onRetry?.();
                    }}
                    sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px' }}
                  >
                    Повторить
                  </Button>
                ) : null}
              </Stack>
            ) : (
              <Typography variant="body2" sx={{ color: ui.mutedText, py: 1.5, textAlign: 'center', fontSize: '0.86rem' }}>
                {trimmedQuery.length >= minSearchChars ? `По запросу «${trimmedQuery}» ничего не найдено` : 'Ничего не найдено'}
              </Typography>
            )
          ) : null}
        </Stack>
      </Box>

      <Stack direction="row" spacing={0.75} sx={{ flexShrink: 0, pt: 0.5, pb: 'calc(0.35rem + env(safe-area-inset-bottom, 0px))' }}>
        <Button
          fullWidth
          variant="outlined"
          data-testid={`${testIdPrefix}-clear`}
          onClick={onClear}
          disabled={selectedSet.size === 0}
          sx={{ textTransform: 'none', fontWeight: 850, borderRadius: '10px', minHeight: 40, fontSize: '0.88rem' }}
        >
          Очистить
        </Button>
        <Button
          fullWidth
          variant="contained"
          data-testid={`${testIdPrefix}-done`}
          onClick={onDone}
          sx={{ textTransform: 'none', fontWeight: 900, borderRadius: '10px', boxShadow: 'none', minHeight: 40, fontSize: '0.88rem' }}
        >
          Готово
        </Button>
      </Stack>
    </Stack>
  );
});

export default MobileCreateUserPicker;
