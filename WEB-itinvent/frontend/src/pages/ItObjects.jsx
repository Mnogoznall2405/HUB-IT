import { useCallback, useEffect, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  InputAdornment,
  LinearProgress,
  Paper,
  Skeleton,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded';
import PersonOutlineRoundedIcon from '@mui/icons-material/PersonOutlineRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import PageTopBar from '../components/layout/PageTopBar';
import { itObjectsAPI } from '../api/itObjects';
import {
  LEVEL_LABELS,
  SECTION_LABELS,
  getItObjectsErrorMessage,
  isItObjectsRequestCancelled,
} from '../components/itObjects/itObjectsShared';


const SEARCH_DEBOUNCE_MS = 350;

function ObjectCard({ item }) {
  const theme = useTheme();
  const accent = item.owner ? theme.palette.primary.main : theme.palette.warning.main;
  const sections = Object.entries(item.my_access?.sections || {});

  return (
    <Paper
      component="article"
      variant="outlined"
      sx={{
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: 2,
        borderColor: alpha(accent, theme.palette.mode === 'dark' ? 0.44 : 0.28),
      }}
    >
      <Box sx={{ height: 3, bgcolor: accent }} />
      <Stack spacing={1.25} sx={{ p: 1.5, flex: 1 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Typography component="h2" variant="h6" fontWeight={750} sx={{ overflowWrap: 'anywhere', lineHeight: 1.3, fontSize: 18 }}>
            {item.name}
          </Typography>
          <ApartmentRoundedIcon sx={{ color: accent, flexShrink: 0 }} aria-hidden="true" />
        </Stack>

        <Stack direction="row" spacing={0.75} alignItems="center">
          <PersonOutlineRoundedIcon fontSize="small" color="action" />
          {item.owner ? (
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
              <Typography component="span" variant="caption" color="text.secondary" sx={{ mr: 0.75 }}>Айтишник:</Typography>
              <Typography component="span" variant="body2" fontWeight={700}>{item.owner.user_name}</Typography>
            </Typography>
          ) : (
            <Typography variant="body2" color="warning.main" fontWeight={650}>Айтишник не назначен</Typography>
          )}
        </Stack>

        <Box sx={{ flex: 1 }}>
          {item.my_access?.is_owner ? (
            <Chip size="small" color="primary" label="Вы — айтишник объекта" sx={{ fontWeight: 700 }} />
          ) : sections.length ? (
            <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.65} aria-label="Ваш доступ">
              {sections.map(([section, level]) => (
                <Chip key={section} size="small" variant="outlined" label={`${SECTION_LABELS[section] || section}: ${LEVEL_LABELS[level] || level}`} />
              ))}
            </Stack>
          ) : (
            <Typography variant="caption" color="text.secondary">Разделы объекта вам не выданы</Typography>
          )}
        </Box>

        <Button
          component={RouterLink}
          to={`/it/objects/${encodeURIComponent(item.object_ref)}`}
          fullWidth
          variant="contained"
          aria-label={`Открыть объект ${item.name}`}
          sx={{ minHeight: { xs: 44, sm: 36 }, borderRadius: 1.5, textTransform: 'none', fontWeight: 600 }}
        >
          Открыть
        </Button>
      </Stack>
    </Paper>
  );
}

export default function ItObjects() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [mine, setMine] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const abortRef = useRef(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const response = await itObjectsAPI.list({ search, mine, signal: controller.signal });
      if (abortRef.current !== controller) return;
      setItems(Array.isArray(response?.items) ? response.items : []);
    } catch (requestError) {
      if (abortRef.current === controller && !isItObjectsRequestCancelled(requestError)) {
        setError(getItObjectsErrorMessage(requestError, 'Не удалось загрузить объекты'));
      }
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }, [mine, search]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  return (
    <MainLayout headerMode="integrated" pageTitle="Объекты ИТ">
      <PageShell sx={{ minWidth: 0, p: { xs: 1, sm: 2, lg: 2.5 } }}>
        <Stack spacing={{ xs: 1.5, sm: 2 }}>
          <PageTopBar
            title="Объекты ИТ"
            sx={{ mb: 0 }}
            actions={(
              <Button
                size="small"
                variant="outlined"
                startIcon={<RefreshRoundedIcon />}
                onClick={() => void load()}
                disabled={loading}
                sx={{ flexShrink: 0, textTransform: 'none' }}
              >
                Обновить
              </Button>
            )}
          />

          <Paper
            component="section"
            aria-label="Поиск объектов"
            variant="outlined"
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 1fr) auto' },
              alignItems: 'center',
              gap: 1.25,
              p: 1.25,
              borderRadius: 3,
            }}
          >
            <TextField
              fullWidth
              size="small"
              label="Поиск"
              placeholder="Название объекта"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon /></InputAdornment> }}
              sx={{ '& .MuiInputBase-root': { minHeight: 44, borderRadius: 2 }, '& input': { fontSize: { xs: 16, sm: 14 } } }}
            />
            <FormControlLabel
              control={<Switch checked={mine} onChange={(event) => setMine(event.target.checked)} />}
              label="Только мои"
              sx={{ mx: 0.5 }}
            />
          </Paper>

          {loading ? <LinearProgress aria-label="Загрузка объектов" /> : null}
          {error ? (
            <Alert severity="warning" action={<Button disabled={loading} onClick={() => void load()}>Повторить</Button>}>
              {error}
            </Alert>
          ) : null}

          {loading && !items.length && !error ? (
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 1.5 }}>
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} variant="rounded" height={190} sx={{ borderRadius: 2 }} />
              ))}
            </Box>
          ) : items.length ? (
            <Box
              component="section"
              aria-label="Карточки объектов"
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
                gap: { xs: 1.25, sm: 1.75 },
                alignItems: 'stretch',
              }}
            >
              {items.map((item) => <ObjectCard key={item.object_ref} item={item} />)}
            </Box>
          ) : !loading && !error ? (
            <Paper variant="outlined" sx={{ p: { xs: 2, sm: 4 }, borderRadius: 3, textAlign: 'center' }}>
              <ApartmentRoundedIcon color="disabled" sx={{ fontSize: 44 }} />
              <Typography variant="h6" fontWeight={800} sx={{ mt: 1 }}>Объекты не найдены</Typography>
              <Typography color="text.secondary">
                {mine ? 'За вами пока не закреплено ни одного объекта.' : 'Измените поиск.'}
              </Typography>
            </Paper>
          ) : null}
        </Stack>
      </PageShell>
    </MainLayout>
  );
}
