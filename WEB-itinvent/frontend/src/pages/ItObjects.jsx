import { useCallback, useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Alert,
  Avatar,
  Box,
  Button,
  FormControlLabel,
  IconButton,
  InputAdornment,
  LinearProgress,
  Paper,
  Skeleton,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import PersonOutlineRoundedIcon from '@mui/icons-material/PersonOutlineRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import RestoreRoundedIcon from '@mui/icons-material/RestoreRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import PageTopBar from '../components/layout/PageTopBar';
import { itObjectsAPI } from '../api/itObjects';
import ObjectCreateDialog from '../components/itObjects/ObjectCreateDialog';
import ObjectDeleteDialog from '../components/itObjects/ObjectDeleteDialog';
import { getItObjectsErrorMessage, isItObjectsRequestCancelled } from '../components/itObjects/itObjectsShared';


const SEARCH_DEBOUNCE_MS = 350;

const initials = (name) => String(name || '')
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0].toUpperCase())
  .join('');

function ObjectCard({ item, canManage, busy, onDelete, onRestore }) {
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  const accent = item.hidden ? theme.palette.text.disabled : item.owner ? theme.palette.primary.main : theme.palette.warning.main;

  return (
    <Paper
      component="article"
      variant="outlined"
      sx={{
        position: 'relative',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        p: 2,
        borderRadius: 3,
        opacity: item.hidden ? 0.72 : 1,
        transition: 'transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease',
        '&:hover, &:focus-within': {
          transform: 'translateY(-2px)',
          borderColor: alpha(accent, 0.6),
          boxShadow: `0 8px 24px ${alpha(theme.palette.common.black, dark ? 0.4 : 0.1)}`,
        },
        '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover, &:focus-within': { transform: 'none' } },
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="flex-start">
        <Box
          aria-hidden="true"
          sx={{
            width: 44,
            height: 44,
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 2.5,
            color: accent,
            bgcolor: alpha(accent, dark ? 0.18 : 0.1),
          }}
        >
          <ApartmentRoundedIcon />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1, pr: canManage ? 4 : 0 }}>
          <Typography
            component={RouterLink}
            to={`/it/objects/${encodeURIComponent(item.object_ref)}`}
            aria-label={`Открыть объект ${item.name}`}
            variant="h6"
            sx={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              overflowWrap: 'anywhere',
              color: 'text.primary',
              textDecoration: 'none',
              fontSize: 17,
              fontWeight: 750,
              lineHeight: 1.3,
              // растягиваем ссылку на всю карточку: клик по любому месту открывает объект
              '&::after': { content: '""', position: 'absolute', inset: 0, borderRadius: 'inherit' },
              '&:focus-visible': { outline: 'none' },
              '&:focus-visible::after': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
            }}
          >
            {item.name}
          </Typography>
          {item.hidden || (item.custom && !item.linked) ? (
            <Typography variant="caption" color="text.secondary">
              {item.hidden ? 'Удалён' : 'Без привязки к ITINVENT'}
            </Typography>
          ) : null}
        </Box>
      </Stack>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
        <Avatar
          sx={{
            width: 28,
            height: 28,
            fontSize: 12,
            fontWeight: 700,
            color: item.owner ? 'primary.main' : 'text.disabled',
            bgcolor: item.owner ? alpha(theme.palette.primary.main, dark ? 0.2 : 0.12) : 'action.hover',
          }}
        >
          {item.owner ? initials(item.owner.user_name) : <PersonOutlineRoundedIcon sx={{ fontSize: 16 }} />}
        </Avatar>
        <Typography
          variant="body2"
          noWrap
          fontWeight={item.owner ? 600 : 500}
          color={item.owner ? 'text.primary' : 'warning.main'}
        >
          {item.owner ? item.owner.user_name : 'Айтишник не назначен'}
        </Typography>
      </Stack>

      {canManage ? (
        <Box sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}>
          {item.hidden ? (
            <Tooltip title="Вернуть объект">
              <span>
                <IconButton size="small" disabled={busy} onClick={() => onRestore(item)} aria-label={`Вернуть объект ${item.name}`}>
                  <RestoreRoundedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          ) : (
            <Tooltip title="Удалить объект">
              <span>
                <IconButton
                  size="small"
                  disabled={busy}
                  onClick={() => onDelete(item)}
                  aria-label={`Удалить объект ${item.name}`}
                  sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}
                >
                  <DeleteOutlineRoundedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Box>
      ) : null}
    </Paper>
  );
}

export default function ItObjects() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [mine, setMine] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [actionError, setActionError] = useState('');
  const navigate = useNavigate();
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
      const response = await itObjectsAPI.list({ search, mine, hidden: showHidden, signal: controller.signal });
      if (abortRef.current !== controller) return;
      setItems(Array.isArray(response?.items) ? response.items : []);
      setCanManage(Boolean(response?.can_manage));
    } catch (requestError) {
      if (abortRef.current === controller && !isItObjectsRequestCancelled(requestError)) {
        setError(getItObjectsErrorMessage(requestError, 'Не удалось загрузить объекты'));
      }
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }, [mine, search, showHidden]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const change = async (action, fallback) => {
    setBusy(true);
    setActionError('');
    try {
      await action();
      await load();
      return true;
    } catch (requestError) {
      setActionError(getItObjectsErrorMessage(requestError, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <MainLayout headerMode="integrated" pageTitle="Объекты ИТ">
      <PageShell sx={{ minWidth: 0, p: { xs: 1, sm: 2, lg: 2.5 } }}>
        <Stack spacing={{ xs: 1.5, sm: 2 }}>
          <PageTopBar
            title="Объекты ИТ"
            sx={{ mb: 0 }}
            actions={(
              <>
                {canManage ? (
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<AddRoundedIcon />}
                    onClick={() => setCreating(true)}
                    sx={{ flexShrink: 0, textTransform: 'none' }}
                  >
                    Добавить объект
                  </Button>
                ) : null}
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
              </>
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
            <Stack direction="row" alignItems="center" spacing={0.5} useFlexGap flexWrap="wrap">
              <FormControlLabel
                control={<Switch checked={mine} onChange={(event) => setMine(event.target.checked)} />}
                label="Только мои"
                sx={{ mx: 0.5 }}
              />
              {canManage ? (
                <FormControlLabel
                  control={<Switch checked={showHidden} onChange={(event) => setShowHidden(event.target.checked)} />}
                  label="Удалённые"
                  sx={{ mx: 0.5 }}
                />
              ) : null}
            </Stack>
          </Paper>

          {loading ? <LinearProgress aria-label="Загрузка объектов" /> : null}
          {actionError ? <Alert severity="error" onClose={() => setActionError('')}>{actionError}</Alert> : null}
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
              {items.map((item) => (
                <ObjectCard
                  key={item.object_ref}
                  item={item}
                  canManage={canManage}
                  busy={busy}
                  onDelete={setToDelete}
                  onRestore={(target) => void change(() => itObjectsAPI.restore(target.object_ref), 'Не удалось вернуть объект')}
                />
              ))}
            </Box>
          ) : !loading && !error ? (
            <Paper variant="outlined" sx={{ p: { xs: 2, sm: 4 }, borderRadius: 3, textAlign: 'center' }}>
              <ApartmentRoundedIcon color="disabled" sx={{ fontSize: 44 }} />
              <Typography variant="h6" fontWeight={800} sx={{ mt: 1 }}>Объекты не найдены</Typography>
              <Typography color="text.secondary">
                {showHidden ? 'Удалённых объектов нет.' : mine ? 'За вами пока не закреплено ни одного объекта.' : 'Измените поиск.'}
              </Typography>
            </Paper>
          ) : null}
        </Stack>
        <ObjectCreateDialog
          open={creating}
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            if (created?.object_ref) navigate(`/it/objects/${encodeURIComponent(created.object_ref)}`);
            else void load();
          }}
        />
        <ObjectDeleteDialog
          name={toDelete?.name || ''}
          open={Boolean(toDelete)}
          busy={busy}
          onCancel={() => setToDelete(null)}
          onConfirm={async () => {
            if (await change(() => itObjectsAPI.hide(toDelete.object_ref), 'Не удалось удалить объект')) setToDelete(null);
          }}
        />
      </PageShell>
    </MainLayout>
  );
}
