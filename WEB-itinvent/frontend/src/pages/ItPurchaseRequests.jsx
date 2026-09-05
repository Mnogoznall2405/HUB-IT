import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  LinearProgress,
  List,
  ListItemButton,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import { warehouse1cItRequestsAPI } from '../api/warehouse1cItRequests';

const AUTO_REFRESH_MS = 5 * 60 * 1000;
const SEARCH_DEBOUNCE_MS = 350;

const STAGES = [
  ['draft', 'Черновик'],
  ['created', 'Заявка создана'],
  ['assigned', 'Назначен закупщик'],
  ['ordered', 'Заказано поставщику'],
  ['reserved', 'Зарезервировано'],
  ['movement_planned', 'Перемещение запланировано'],
  ['fulfilled', 'Доставлено на склад'],
  ['cancelled', 'Отменено'],
  ['needs_review', 'Требует проверки'],
];

const JOURNEY_STEPS = [
  { key: 'created', label: 'Заявка', shortLabel: 'Заявка' },
  { key: 'assigned', label: 'Закупщик', shortLabel: 'Назнач.' },
  { key: 'ordered', label: 'Заказ / резерв', shortLabel: 'Заказ' },
  { key: 'movement_planned', label: 'План', shortLabel: 'План' },
  { key: 'fulfilled', label: 'На складе', shortLabel: 'Склад' },
];

const JOURNEY_STAGE_INDEX = {
  draft: 0,
  created: 0,
  assigned: 1,
  ordered: 2,
  reserved: 2,
  movement_planned: 3,
  received: 4,
  ready: 4,
  fulfilled: 4,
};

const formatDate = (value, withTime = false) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ru-RU', withTime
    ? { dateStyle: 'short', timeStyle: 'short' }
    : { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
};

const formatQuantity = (value) => new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 3,
}).format(Number(value) || 0);

const formatMoney = (value) => new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 2,
}).format(Number(value) || 0);

const formatPositionsCount = (value) => {
  const count = Number(value) || 0;
  const remainder100 = count % 100;
  const remainder10 = count % 10;
  const noun = remainder100 >= 11 && remainder100 <= 14
    ? 'позиций'
    : remainder10 === 1
      ? 'позиция'
      : remainder10 >= 2 && remainder10 <= 4
        ? 'позиции'
        : 'позиций';
  return `${count} ${noun} в заявке`;
};

const errorMessage = (error) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (detail?.message) return String(detail.message);
  return error?.message || 'Не удалось получить данные из 1С';
};

const isCancelledRequest = (error) => (
  error?.code === 'ERR_CANCELED'
  || error?.name === 'CanceledError'
  || error?.name === 'AbortError'
);

function RequestWarnings({ stage, overdue = false, attentionRequired = false }) {
  const stageKey = stage?.key || 'created';
  return (
    <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.75}>
      {overdue ? (
        <Chip
          size="small"
          color="error"
          icon={<WarningAmberRoundedIcon />}
          label="Просрочено"
        />
      ) : null}
      {attentionRequired && stageKey !== 'needs_review' ? (
        <Chip
          size="small"
          color="warning"
          variant="outlined"
          icon={<WarningAmberRoundedIcon />}
          label="Проверить данные"
        />
      ) : null}
    </Stack>
  );
}

function journeyFor(request) {
  if (Array.isArray(request?.journey) && request.journey.length) return request.journey;
  const currentIndex = JOURNEY_STAGE_INDEX[request?.stage?.key] ?? 0;
  return JOURNEY_STEPS.map((step, index) => ({
    ...step,
    reached: index <= currentIndex,
    current: index === currentIndex,
    date: index === 0 ? request?.date : null,
  }));
}

function RequestJourney({ request, compact = false }) {
  const steps = journeyFor(request);

  return (
    <Box
      component="ol"
      aria-label={`Путь заявки. Текущий этап: ${request?.stage?.label || 'не определён'}`}
      sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`,
        m: 0,
        p: 0,
        pt: compact ? 0.25 : 0.5,
      }}
    >
      {steps.map((step, index) => {
        const reached = Boolean(step.reached);
        const current = Boolean(step.current);
        const stateLabel = current
          ? 'текущий этап'
          : step.missing
            ? 'нет подтверждающего документа'
            : reached
              ? 'пройдено'
              : 'впереди';
        const connectorReached = reached && Boolean(steps[index + 1]?.reached);
        const shortLabel = JOURNEY_STEPS.find((item) => item.key === step.key)?.shortLabel || step.label;
        return (
          <Box
            component="li"
            key={step.key}
            aria-current={current ? 'step' : undefined}
            aria-label={`${step.label}: ${stateLabel}${step.date ? `, ${formatDate(step.date)}` : ''}`}
            sx={{
              position: 'relative',
              zIndex: 1,
              minWidth: 0,
              listStyle: 'none',
              textAlign: 'center',
              px: 0.25,
              '&:not(:last-of-type)::after': {
                content: '""',
                position: 'absolute',
                zIndex: 0,
                insetInlineStart: '50%',
                top: compact ? 9 : 11,
                width: '100%',
                height: 2,
                bgcolor: connectorReached ? 'primary.main' : 'divider',
              },
            }}
          >
            <Box
              aria-hidden="true"
              sx={{
                width: compact ? 18 : 22,
                height: compact ? 18 : 22,
                mx: 'auto',
                position: 'relative',
                zIndex: 1,
                display: 'grid',
                placeItems: 'center',
                borderRadius: '50%',
                border: '2px solid',
                borderColor: reached || current ? 'primary.main' : 'divider',
                bgcolor: reached ? 'primary.main' : 'background.paper',
                color: 'primary.contrastText',
                boxShadow: current ? (theme) => `0 0 0 4px ${alpha(theme.palette.primary.main, 0.18)}` : 'none',
              }}
            >
              {reached ? <CheckRoundedIcon sx={{ fontSize: compact ? 13 : 16 }} /> : current ? (
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'primary.main' }} />
              ) : null}
            </Box>
            <Typography
              component="span"
              sx={{
                display: 'block',
                mt: 0.75,
                color: current ? 'text.primary' : reached ? 'text.secondary' : 'text.disabled',
                fontSize: compact ? '0.625rem' : { xs: '0.625rem', sm: '0.75rem' },
                fontWeight: current ? 800 : reached ? 650 : 500,
                lineHeight: 1.15,
                overflowWrap: 'anywhere',
              }}
            >
              {compact ? shortLabel : (
                <>
                  <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>{shortLabel}</Box>
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{step.label}</Box>
                </>
              )}
            </Typography>
            {!compact && step.date ? (
              <Typography
                component="span"
                variant="caption"
                color="text.secondary"
                sx={{ display: { xs: 'none', sm: 'block' }, mt: 0.25 }}
              >
                {formatDate(step.date)}
              </Typography>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}

function RequestListItem({ item, selected, onOpen }) {
  const [expanded, setExpanded] = useState(false);
  const allNomenclature = Array.isArray(item.nomenclature_items)
    ? item.nomenclature_items
    : (item.nomenclature_preview || []);
  const visibleNomenclature = expanded ? allNomenclature : allNomenclature.slice(0, 3);
  const remaining = Math.max(0, allNomenclature.length - 3);
  return (
    <Paper
      variant="outlined"
      sx={{
        mb: 1,
        overflow: 'hidden',
        borderColor: selected ? 'primary.main' : 'divider',
        bgcolor: selected ? (theme) => alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.12 : 0.045) : 'background.paper',
      }}
    >
      <ListItemButton
        selected={selected}
        aria-current={selected ? 'page' : undefined}
        aria-label={`Открыть заявку ${item.request_number}`}
        onClick={() => onOpen(item.request_ref)}
        sx={{
          minHeight: 96,
          alignItems: 'flex-start',
          p: { xs: 1.5, sm: 2 },
          '&.Mui-focusVisible': { outline: '3px solid', outlineColor: 'primary.main', outlineOffset: -3 },
        }}
      >
        <Stack spacing={1} sx={{ minWidth: 0, width: '100%' }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={0.75}>
            <Box sx={{ minWidth: 0 }}>
              <Typography component="h3" variant="subtitle1" fontWeight={800} sx={{ overflowWrap: 'anywhere' }}>
                {item.request_number || 'Без номера'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Требуется к {formatDate(item.required_date)}
              </Typography>
            </Box>
            <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.75} alignItems="flex-start">
              <Chip
                size="small"
                variant="outlined"
                label={item.warehouse_name || 'Склад не указан'}
                sx={{ maxWidth: '100%', '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
              />
              <RequestWarnings
              stage={item.stage}
              overdue={item.overdue}
              attentionRequired={item.attention_required}
              />
            </Stack>
          </Stack>

          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={800} sx={{ overflowWrap: 'anywhere' }}>
              {item.current_state?.label || item.stage?.label || 'Состояние не определено'}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
              {item.current_state?.description || item.progress_label || formatPositionsCount(item.positions_total)}
            </Typography>
          </Box>

          <Box
            sx={{
              px: 0.75,
              py: 0.75,
              borderRadius: 2,
              bgcolor: (theme) => alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.08 : 0.035),
            }}
          >
            <RequestJourney request={item} compact />
          </Box>

          <Typography variant="caption" color="text.secondary" fontWeight={650}>
            {formatPositionsCount(item.positions_total)}
          </Typography>

          <Stack component="ul" spacing={0.25} sx={{ m: 0, pl: 2.25 }}>
            {visibleNomenclature.map((position, index) => (
              <Typography component="li" variant="body2" key={`${position.name}-${index}`}>
                {position.name || 'Номенклатура без наименования'} — {formatQuantity(position.quantity)} {position.unit}
              </Typography>
            ))}
          </Stack>
        </Stack>
      </ListItemButton>
      {remaining > 0 ? (
        <Button
          fullWidth
          size="small"
          startIcon={expanded ? <ExpandLessRoundedIcon /> : <ExpandMoreRoundedIcon />}
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          sx={{ minHeight: 44, borderRadius: 0 }}
        >
          {expanded ? 'Свернуть позиции' : `Показать ещё ${remaining}`}
        </Button>
      ) : null}
    </Paper>
  );
}

function groupRequestsByWarehouse(items) {
  const groups = new Map();
  items.forEach((item) => {
    const ref = item.warehouse_ref || '__unknown__';
    if (!groups.has(ref)) {
      groups.set(ref, {
        ref,
        name: item.warehouse_name || 'Склад не указан',
        items: [],
      });
    }
    groups.get(ref).items.push(item);
  });
  return [...groups.values()];
}

function RequestList({
  items,
  selectedRef,
  loading,
  hasMore,
  onOpen,
  onLoadMore,
  warehouseFacets = [],
}) {
  const warehouseGroups = useMemo(() => groupRequestsByWarehouse(items), [items]);
  const facetsByRef = useMemo(
    () => new Map(warehouseFacets.map((facet) => [facet.ref, facet])),
    [warehouseFacets],
  );
  if (loading && items.length === 0) {
    return (
      <Stack spacing={1} aria-label="Загрузка заявок">
        {[0, 1, 2].map((key) => <Skeleton key={key} variant="rounded" height={150} />)}
      </Stack>
    );
  }
  if (items.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="h6">Заявки не найдены</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Измените поиск, вкладку или фильтры.
        </Typography>
      </Paper>
    );
  }
  return (
    <>
      {warehouseGroups.map((group) => (
        <Box component="section" key={group.ref} aria-labelledby={`warehouse-${group.ref}`} sx={{ mb: 1.5 }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="baseline"
            spacing={1}
            sx={{
              px: 0.5,
              py: 0.5,
              mb: 0.75,
              position: { lg: 'sticky' },
              top: { lg: 0 },
              zIndex: { lg: 2 },
              bgcolor: 'background.default',
            }}
          >
            <Typography id={`warehouse-${group.ref}`} component="h2" variant="subtitle2" fontWeight={850} sx={{ overflowWrap: 'anywhere' }}>
              {group.name}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
              {facetsByRef.get(group.ref)?.count ?? group.items.length}
              {facetsByRef.get(group.ref)?.overdue_count
                ? ` · просрочено ${facetsByRef.get(group.ref).overdue_count}`
                : ''}
            </Typography>
          </Stack>
          <List disablePadding aria-label={`Заявки: ${group.name}`}>
            {group.items.map((item) => (
              <RequestListItem
                key={item.request_ref}
                item={item}
                selected={selectedRef === item.request_ref}
                onOpen={onOpen}
              />
            ))}
          </List>
        </Box>
      ))}
      {hasMore ? (
        <Button fullWidth variant="outlined" onClick={onLoadMore} disabled={loading} sx={{ minHeight: 44 }}>
          {loading ? 'Загрузка…' : 'Показать ещё 25'}
        </Button>
      ) : null}
    </>
  );
}

function MetaValue({ label, children }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" fontWeight={650} sx={{ overflowWrap: 'anywhere' }}>{children || '—'}</Typography>
    </Box>
  );
}

function EventRow({ event }) {
  const route = [event.source_name, event.destination_name].filter(Boolean).join(' → ');
  const nomenclature = Array.isArray(event.nomenclature_names)
    ? event.nomenclature_names.filter(Boolean)
    : [];
  return (
    <Box component="li" sx={{ position: 'relative', pl: 2.5, pb: 2, listStyle: 'none' }}>
      <Box
        aria-hidden="true"
        sx={{ position: 'absolute', left: 2, top: 7, width: 9, height: 9, borderRadius: '50%', bgcolor: 'primary.main' }}
      />
      <Typography variant="body2" fontWeight={750}>{event.label || 'Документ 1С'}</Typography>
      <Typography variant="body2">
        {event.document_number || 'Без номера'} · {formatDate(event.date)}
      </Typography>
      <Typography variant="caption" color="text.secondary" component="div">
        {formatQuantity(event.quantity)}
        {event.manager_name ? ` · закупщик: ${event.manager_name}` : ''}
        {event.supplier_name ? ` · поставщик: ${event.supplier_name}` : ''}
        {route ? ` · ${route}` : ''}
        {Number(event.amount) > 0 ? ` · ${formatMoney(event.amount)}` : ''}
      </Typography>
      {nomenclature.length ? (
        <Typography variant="caption" color="text.secondary" component="div">
          {nomenclature.slice(0, 3).join(', ')}{nomenclature.length > 3 ? ` и ещё ${nomenclature.length - 3}` : ''}
        </Typography>
      ) : null}
    </Box>
  );
}

const EVENT_STEP = {
  assigned: 'assigned',
  ordered: 'ordered',
  reserved: 'ordered',
  movement_planned: 'movement_planned',
  received: 'fulfilled',
  issued: 'fulfilled',
  transferred: 'fulfilled',
};

function JourneyDocuments({ request }) {
  const timeline = Array.isArray(request?.timeline) ? request.timeline : [];
  const steps = journeyFor(request)
    .map((step) => {
      const ownDocuments = Array.isArray(step.documents) ? step.documents : [];
      const documents = ownDocuments.length
        ? ownDocuments
        : timeline.filter((event) => EVENT_STEP[event.type] === step.key);
      return { ...step, documents };
    })
    .filter((step) => step.documents.length);
  if (!steps.length) {
    return <Typography color="text.secondary">Связанные документы пока не найдены.</Typography>;
  }
  return (
    <Stack spacing={0.75} sx={{ mt: 1.5 }}>
      {steps.map((step) => (
        <Box
          component="details"
          key={step.key}
          sx={{
            borderTop: '1px solid',
            borderColor: 'divider',
            '&[open] > summary': { color: 'text.primary' },
          }}
        >
          <Box
            component="summary"
            sx={{
              minHeight: 44,
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              color: 'text.secondary',
              fontWeight: 750,
              '&:focus-visible': { outline: '3px solid', outlineColor: 'primary.main', outlineOffset: 2 },
            }}
          >
            {step.label}: {step.documents.length} док.
          </Box>
          <Box component="ol" sx={{ m: 0, p: 0, pt: 0.5 }}>
            {step.documents.map((event, index) => (
              <EventRow key={`${event.type}-${event.document_ref}-${index}`} event={event} />
            ))}
          </Box>
        </Box>
      ))}
    </Stack>
  );
}

function itemGroupsFor(request) {
  if (Array.isArray(request?.item_groups) && request.item_groups.length) return request.item_groups;
  const groups = new Map();
  (request?.positions || []).forEach((position) => {
    const key = [
      position.nomenclature_ref || position.nomenclature_name,
      position.characteristic_name,
      position.unit_name,
      Boolean(position.cancelled),
    ].join('|');
    const current = groups.get(key) || {
      name: position.nomenclature_name,
      characteristic_name: position.characteristic_name,
      unit: position.unit_name,
      quantity: 0,
      cancelled: Boolean(position.cancelled),
      cancellation_reasons: [],
      source_line_count: 0,
    };
    current.quantity += Number(position.quantity) || 0;
    current.source_line_count += 1;
    if (position.cancellation_reason && !current.cancellation_reasons.includes(position.cancellation_reason)) {
      current.cancellation_reasons.push(position.cancellation_reason);
    }
    groups.set(key, current);
  });
  return [...groups.values()];
}

function RequestItemsList({ request }) {
  const groups = itemGroupsFor(request);
  return (
    <Paper
      component="section"
      variant="outlined"
      aria-labelledby="it-request-items-title"
      sx={{
        overflow: 'hidden',
        borderRadius: 3,
      }}
    >
      <Box sx={{ p: { xs: 1.5, sm: 2 } }}>
        <Typography id="it-request-items-title" component="h2" variant="h6" fontWeight={800}>
          Номенклатура
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {formatPositionsCount(request.positions_total)} · {groups.length} уникальных наименований
        </Typography>
      </Box>
      <Divider />
      {groups.length ? groups.map((item, index) => (
        <Box
          component="article"
          key={`${item.nomenclature_ref || item.name}-${item.characteristic_name}-${item.cancelled}-${index}`}
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 1fr) auto' },
            gap: { xs: 0.75, sm: 2 },
            alignItems: 'center',
            p: { xs: 1.5, sm: 2 },
            borderTop: index ? '1px solid' : 0,
            borderColor: 'divider',
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.75} alignItems="center">
              <Typography component="h3" variant="body1" fontWeight={800} sx={{ overflowWrap: 'anywhere' }}>
                {item.name || 'Номенклатура без наименования'}
              </Typography>
              {item.cancelled ? <Chip size="small" variant="outlined" label="Отменено" /> : null}
            </Stack>
            {item.characteristic_name ? (
              <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                {item.characteristic_name}
              </Typography>
            ) : null}
            {Number(item.source_line_count) > 1 ? (
              <Typography variant="caption" color="text.secondary">
                Объединено строк в 1С: {item.source_line_count}
              </Typography>
            ) : null}
            {item.cancelled && item.cancellation_reasons?.length ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Причина: {item.cancellation_reasons.join('; ')}
              </Typography>
            ) : null}
          </Box>
          <Typography variant="body1" fontWeight={850} sx={{ whiteSpace: 'nowrap' }}>
            {formatQuantity(item.quantity)} {item.unit}
          </Typography>
        </Box>
      )) : (
        <Typography color="text.secondary" sx={{ p: 2 }}>Номенклатура в заявке не найдена.</Typography>
      )}
    </Paper>
  );
}

function RequestDetail({ request, loading, error, onBack, showBack }) {
  if (loading && !request) {
    return <Skeleton variant="rounded" height={420} aria-label="Загрузка заявки" />;
  }
  if (!request) {
    return (
      <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
        {showBack ? (
          <Button startIcon={<ArrowBackRoundedIcon />} onClick={onBack} sx={{ minHeight: 44, mb: 1 }}>
            К списку заявок
          </Button>
        ) : null}
        <Typography variant="h6">Выберите заявку</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>Справа появятся позиции и движение документов.</Typography>
      </Paper>
    );
  }
  const currentState = request.current_state || {
    label: request.stage?.label || 'Состояние не определено',
    description: request.progress_label || formatPositionsCount(request.positions_total),
  };
  return (
    <Stack spacing={2}>
      {showBack ? (
        <Button startIcon={<ArrowBackRoundedIcon />} onClick={onBack} sx={{ minHeight: 44, alignSelf: 'flex-start' }}>
          К списку заявок
        </Button>
      ) : null}
      {error ? <Alert severity="warning">{error}. Показаны ранее загруженные данные.</Alert> : null}
      <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2.5 } }}>
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1}>
            <Box sx={{ minWidth: 0 }}>
              <Typography component={showBack ? 'h1' : 'h2'} variant="h5" fontWeight={850} sx={{ overflowWrap: 'anywhere' }}>
                {request.request_number}
              </Typography>
              <Typography color="text.secondary">{formatPositionsCount(request.positions_total)}</Typography>
            </Box>
            <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.75} alignItems="flex-start">
              <Chip size="small" variant="outlined" label={request.warehouse_name || 'Склад не указан'} />
              <RequestWarnings
                stage={request.stage}
                overdue={request.overdue}
                attentionRequired={request.attention_required}
              />
            </Stack>
          </Stack>
          <Divider />
          <Box
            role="status"
            sx={{
              p: { xs: 1.25, sm: 1.5 },
              borderInlineStart: '4px solid',
              borderColor: request.stage?.key === 'fulfilled' ? 'success.main' : 'primary.main',
              borderRadius: 2,
              bgcolor: (theme) => alpha(
                request.stage?.key === 'fulfilled' ? theme.palette.success.main : theme.palette.primary.main,
                theme.palette.mode === 'dark' ? 0.12 : 0.055,
              ),
            }}
          >
            <Typography variant="subtitle1" fontWeight={850} sx={{ overflowWrap: 'anywhere' }}>
              {currentState.label}
            </Typography>
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{currentState.description}</Typography>
            {currentState.date || currentState.document_number ? (
              <Typography variant="caption" color="text.secondary">
                {[currentState.document_number, formatDate(currentState.date)].filter((value) => value && value !== '—').join(' · ')}
              </Typography>
            ) : null}
          </Box>
          <Box
            component="section"
            aria-labelledby="it-request-journey-title"
            sx={{
              p: { xs: 1.25, sm: 1.75 },
              borderRadius: 3,
              bgcolor: (theme) => alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.09 : 0.045),
            }}
          >
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={0.25} sx={{ mb: 1.5 }}>
              <Typography
                id="it-request-journey-title"
                component={showBack ? 'h2' : 'h3'}
                variant="subtitle2"
                fontWeight={800}
              >
                Путь заявки
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Общий для всей номенклатуры
              </Typography>
            </Stack>
            <RequestJourney request={request} />
            <JourneyDocuments request={request} />
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(170px, 100%), 1fr))', gap: 1.5 }}>
            <MetaValue label="Дата заявки">{formatDate(request.date)}</MetaValue>
            <MetaValue label="Требуется к">{formatDate(request.required_date)}</MetaValue>
            <MetaValue label="Подразделение">{request.department_name}</MetaValue>
            <MetaValue label="Инициатор">{request.initiator_name}</MetaValue>
            <MetaValue label="Ответственный">{request.responsible_name}</MetaValue>
            <MetaValue label="Закупщик">{request.manager_names?.join(', ')}</MetaValue>
            <MetaValue label="Поставщик">{request.supplier_names?.join(', ') || request.supplier_name}</MetaValue>
            {Number(request.ordered_cost) > 0 ? <MetaValue label="Сумма заказов">{formatMoney(request.ordered_cost)}</MetaValue> : null}
            <MetaValue label="Фактическая поставка">{formatDate(request.factual_delivery_date)}</MetaValue>
          </Box>
          {request.comment ? <MetaValue label="Комментарий">{request.comment}</MetaValue> : null}
        </Stack>
      </Paper>
      <RequestItemsList request={request} />
    </Stack>
  );
}

export default function ItPurchaseRequests() {
  const theme = useTheme();
  const isWide = useMediaQuery(theme.breakpoints.up('lg'));
  const navigate = useNavigate();
  const { requestRef = '' } = useParams();
  const [view, setView] = useState('active');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('');
  const [warehouseRef, setWarehouseRef] = useState('');
  const [warehouseFacets, setWarehouseFacets] = useState([]);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [asOf, setAsOf] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [cache, setCache] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const listBusyRef = useRef(false);
  const detailBusyRef = useRef(false);
  const listAbortRef = useRef(null);
  const detailAbortRef = useRef(null);
  const nextCursorRef = useRef('');
  const refreshRef = useRef(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  const loadList = useCallback(async ({
    append = false,
    silent = false,
    cancelPrevious = false,
    forceRefresh = false,
  } = {}) => {
    if (listBusyRef.current && !cancelPrevious) return null;
    if (cancelPrevious) listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;
    listBusyRef.current = true;
    setListError('');
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await warehouse1cItRequestsAPI.getRequests({
        view,
        search,
        stage,
        overdue: overdueOnly ? true : undefined,
        warehouseRef,
        limit: 25,
        cursor: append ? nextCursorRef.current : '',
        refresh: forceRefresh,
        signal: controller.signal,
      });
      const nextItems = Array.isArray(response?.items) ? response.items : [];
      const canAppend = append && !response?.snapshot_changed;
      setItems((current) => {
        if (!canAppend) return nextItems;
        const byRef = new Map(current.map((item) => [item.request_ref, item]));
        nextItems.forEach((item) => byRef.set(item.request_ref, item));
        return [...byRef.values()];
      });
      const cursor = String(response?.next_cursor || '');
      nextCursorRef.current = cursor;
      setHasMore(Boolean(response?.has_more));
      setAsOf(String(response?.as_of || ''));
      setTruncated(Boolean(response?.truncated));
      setWarehouseFacets(Array.isArray(response?.warehouse_facets) ? response.warehouse_facets : []);
      setCache(response?.cache || null);
      return response;
    } catch (error) {
      if (!isCancelledRequest(error)) setListError(errorMessage(error));
      return null;
    } finally {
      if (listAbortRef.current === controller) {
        listBusyRef.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [overdueOnly, search, stage, view, warehouseRef]);

  const loadDetail = useCallback(async (ref, { silent = false, cancelPrevious = false } = {}) => {
    if (!ref || (detailBusyRef.current && !cancelPrevious)) return false;
    if (cancelPrevious) detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;
    detailBusyRef.current = true;
    setDetailError('');
    if (!silent) setDetailLoading(true);
    try {
      const response = await warehouse1cItRequestsAPI.getRequest(ref, { signal: controller.signal });
      setDetail(response || null);
      if (response?.as_of) setAsOf(String(response.as_of));
      return true;
    } catch (error) {
      if (!isCancelledRequest(error)) setDetailError(errorMessage(error));
      return false;
    } finally {
      if (detailAbortRef.current === controller) {
        detailBusyRef.current = false;
        setDetailLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    nextCursorRef.current = '';
    void loadList({ cancelPrevious: true });
  }, [loadList]);

  useEffect(() => {
    if (!requestRef) {
      detailAbortRef.current?.abort();
      setDetail(null);
      setDetailError('');
      return;
    }
    setDetail((current) => (current?.request_ref === requestRef ? current : null));
    void loadDetail(requestRef, { cancelPrevious: true });
  }, [loadDetail, requestRef]);

  useEffect(() => {
    if (isWide && !requestRef && items.length > 0) {
      navigate(`/it/requests/${items[0].request_ref}`, { replace: true });
    }
  }, [isWide, items, navigate, requestRef]);

  const refreshAll = useCallback(async ({ forceRefresh = false } = {}) => {
    if (document.visibilityState !== 'visible') return;
    const response = await loadList({ silent: true, forceRefresh });
    if (
      requestRef
      && response
      && (!detail || response.snapshot_id !== detail.snapshot_id)
    ) {
      await loadDetail(requestRef, { silent: true });
    }
  }, [detail, loadDetail, loadList, requestRef]);

  useEffect(() => {
    refreshRef.current = refreshAll;
  }, [refreshAll]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshRef.current?.();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshRef.current?.();
    }, AUTO_REFRESH_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(interval);
      listAbortRef.current?.abort();
      detailAbortRef.current?.abort();
    };
  }, []);

  const openRequest = useCallback((ref) => navigate(`/it/requests/${ref}`), [navigate]);
  const backToList = useCallback(() => navigate('/it/requests'), [navigate]);
  const selectedSummary = useMemo(
    () => items.find((item) => item.request_ref === requestRef) || null,
    [items, requestRef],
  );
  const currentDetail = detail?.request_ref === requestRef ? detail : null;
  const showMobileDetail = !isWide && Boolean(requestRef);

  return (
    <MainLayout pageTitle="Заявки на МПЗ">
      <PageShell
        fullHeight
        sx={{
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          gap: { xs: 1.5, sm: 2 },
          p: { xs: 1, sm: 2 },
        }}
      >
        {!showMobileDetail ? (
          <Box component="header">
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1.5}>
              <Box>
                <Typography component="h1" variant="h4" fontWeight={850}>Заявки на МПЗ</Typography>
                <Typography color="text.secondary">ИТ-заявки и их движение по документам 1С</Typography>
              </Box>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="caption" color="text.secondary" role="status" aria-live="polite">
                  {asOf ? `Обновлено ${formatDate(asOf, true)}` : 'Данные ещё не загружены'}
                </Typography>
                <Tooltip title="Обновить список и открытую заявку">
                  <span>
                    <IconButton
                      aria-label="Обновить список и открытую заявку"
                      onClick={() => void refreshAll({ forceRefresh: true })}
                      disabled={refreshing || loading}
                      sx={{ minWidth: 44, minHeight: 44 }}
                    >
                      <RefreshRoundedIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            </Stack>

            <Tabs
              value={view}
              onChange={(_, value) => setView(value)}
              aria-label="Состояние заявок"
              variant="scrollable"
              allowScrollButtonsMobile
              sx={{ mt: 1.5, minHeight: 44, '& .MuiTab-root': { minHeight: 44 } }}
            >
              <Tab value="active" label="Активные" />
              <Tab value="history" label="История" />
              <Tab value="all" label="Все" />
            </Tabs>

            <Paper
              component="section"
              variant="outlined"
              aria-label="Поиск и фильтры заявок"
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'minmax(0, 1fr)',
                  sm: 'minmax(0, 1.4fr) minmax(200px, 0.8fr)',
                  lg: 'minmax(260px, 1fr) minmax(190px, 0.55fr) minmax(190px, 0.55fr) minmax(210px, auto)',
                },
                gap: 1.25,
                mt: 1.5,
                p: 1.25,
                alignItems: 'center',
                borderRadius: 3,
                bgcolor: (currentTheme) => alpha(
                  currentTheme.palette.background.paper,
                  currentTheme.palette.mode === 'dark' ? 0.72 : 0.9,
                ),
              }}
            >
              <TextField
                fullWidth
                size="small"
                label="Поиск"
                placeholder="Номер, номенклатура, подразделение, ответственный"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                InputProps={{
                  startAdornment: <InputAdornment position="start"><SearchRoundedIcon /></InputAdornment>,
                }}
                sx={{ '& .MuiInputBase-root': { minHeight: 44, borderRadius: 2 } }}
              />
              <TextField
                select
                fullWidth
                size="small"
                label="Этап заявки"
                value={stage}
                onChange={(event) => setStage(event.target.value)}
                InputLabelProps={{ shrink: true }}
                SelectProps={{
                  displayEmpty: true,
                  renderValue: (selected) => (
                    STAGES.find(([value]) => value === selected)?.[1] || 'Все этапы'
                  ),
                }}
                sx={{ '& .MuiInputBase-root': { minHeight: 44, borderRadius: 2 } }}
              >
                <MenuItem value="">Все этапы</MenuItem>
                {STAGES.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
              </TextField>
              <TextField
                select
                fullWidth
                size="small"
                label="Склад назначения"
                value={warehouseRef}
                onChange={(event) => setWarehouseRef(event.target.value)}
                InputLabelProps={{ shrink: true }}
                SelectProps={{
                  displayEmpty: true,
                  renderValue: (selected) => (
                    warehouseFacets.find((item) => item.ref === selected)?.name || 'Все склады'
                  ),
                }}
                sx={{ '& .MuiInputBase-root': { minHeight: 44, borderRadius: 2 } }}
              >
                <MenuItem value="">Все склады</MenuItem>
                {warehouseFacets.map((warehouse) => (
                  <MenuItem key={warehouse.ref} value={warehouse.ref}>
                    {warehouse.name} · {view === 'active'
                      ? warehouse.active_count
                      : view === 'history'
                        ? warehouse.history_count
                        : warehouse.count}
                  </MenuItem>
                ))}
              </TextField>
              <FormControlLabel
                control={<Switch checked={overdueOnly} onChange={(event) => setOverdueOnly(event.target.checked)} />}
                label="Только просроченные"
                sx={{
                  minHeight: 44,
                  m: 0,
                  px: 1,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 2,
                  gridColumn: { xs: '1', sm: '1 / -1', lg: 'auto' },
                  '& .MuiFormControlLabel-label': { lineHeight: 1.25 },
                }}
              />
            </Paper>
          </Box>
        ) : null}

        {loading || refreshing ? <LinearProgress aria-label={refreshing ? 'Обновление данных' : 'Загрузка данных'} /> : null}
        {listError && !showMobileDetail ? (
          <Alert severity="warning">
            {listError}. {items.length ? 'Показаны данные предыдущей успешной загрузки.' : 'Повторите попытку позже.'}
          </Alert>
        ) : null}
        {cache?.stale && !showMobileDetail ? (
          <Alert severity="warning">
            Новые данные из 1С временно не получены. Показан сохранённый снимок
            {Number.isFinite(Number(cache.age_seconds)) ? ` возрастом ${cache.age_seconds} сек.` : '.'}
          </Alert>
        ) : null}
        {truncated && !showMobileDetail ? (
          <Alert severity="info">Срез 1С достиг защитного лимита. Уточните поиск, чтобы получить полный результат.</Alert>
        ) : null}

        {isWide ? (
          <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(330px, 0.9fr) minmax(460px, 1.4fr)', gap: 2 }}>
            <Box component="section" aria-label="Список заявок" sx={{ minHeight: 0, overflowY: 'auto', pr: 0.5 }}>
              <RequestList
                items={items}
                selectedRef={requestRef}
                loading={loading}
                hasMore={hasMore}
                warehouseFacets={warehouseFacets}
                onOpen={openRequest}
                onLoadMore={() => void loadList({ append: true })}
              />
            </Box>
            <Box component="section" aria-label="Карточка заявки" sx={{ minHeight: 0, overflowY: 'auto', pr: 0.5 }}>
              <RequestDetail
                request={currentDetail || (detailLoading ? null : selectedSummary)}
                loading={detailLoading}
                error={detailError}
              />
            </Box>
          </Box>
        ) : showMobileDetail ? (
          <Box component="section" aria-label="Карточка заявки" sx={{ minWidth: 0 }}>
            <RequestDetail
              request={currentDetail}
              loading={detailLoading}
              error={detailError}
              showBack
              onBack={backToList}
            />
          </Box>
        ) : (
          <Box component="section" aria-label="Список заявок" sx={{ minWidth: 0 }}>
            <RequestList
              items={items}
              selectedRef={requestRef}
              loading={loading}
              hasMore={hasMore}
              warehouseFacets={warehouseFacets}
              onOpen={openRequest}
              onLoadMore={() => void loadList({ append: true })}
            />
          </Box>
        )}
      </PageShell>
    </MainLayout>
  );
}
