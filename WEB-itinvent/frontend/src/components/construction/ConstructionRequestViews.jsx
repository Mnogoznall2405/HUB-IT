import {
  Box,
  Button,
  ButtonBase,
  Chip,
  Divider,
  Paper,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';


export const REQUEST_STAGES = [
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
  { key: 'created', label: 'Заявка' },
  { key: 'assigned', label: 'Закупщик' },
  { key: 'ordered', label: 'Заказ / резерв' },
  { key: 'movement_planned', label: 'План перемещения' },
  { key: 'fulfilled', label: 'На складе' },
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

const EVENT_STEP = {
  assigned: 'assigned',
  ordered: 'ordered',
  reserved: 'ordered',
  movement_planned: 'movement_planned',
  received: 'fulfilled',
  issued: 'fulfilled',
  transferred: 'fulfilled',
};

const JOURNEY_STEP_EXPLANATIONS = {
  created: 'Заявка зарегистрирована в 1С: зафиксированы состав и требуемая дата.',
  assigned: 'Назначен закупщик, который ведёт заказ и отвечает за связь по закупке.',
  ordered: 'Материал заказан поставщику или зарезервирован на складе.',
  movement_planned: 'Создан план перемещения материала на склад назначения.',
  fulfilled: 'Материал поступил на склад назначения. Доставка по заявке завершена.',
};

export const formatConstructionDate = (value, withTime = false) => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat('ru-RU', withTime
    ? { dateStyle: 'short', timeStyle: 'short' }
    : { day: '2-digit', month: '2-digit', year: 'numeric' }).format(parsed);
};

const formatQuantity = (value) => new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 3,
}).format(Number(value) || 0);

const positionsLabel = (value) => {
  const count = Number(value) || 0;
  const mod100 = count % 100;
  const mod10 = count % 10;
  const noun = mod100 >= 11 && mod100 <= 14
    ? 'позиций'
    : mod10 === 1
      ? 'позиция'
      : mod10 >= 2 && mod10 <= 4
        ? 'позиции'
        : 'позиций';
  return `${count} ${noun}`;
};

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

function journeyStepState(step) {
  if (step.current) return 'Сейчас заявка находится на этом этапе.';
  if (step.missing) return 'Нет подтверждающего документа — требуется проверка.';
  if (step.reached) return 'Этап пройден.';
  return 'Этап ещё не начат.';
}

function JourneyStepTooltip({ step }) {
  const details = [
    step.document_number ? `Документ: ${step.document_number}` : '',
    step.date ? `Дата: ${formatConstructionDate(step.date)}` : '',
    step.manager_name ? `Закупщик: ${step.manager_name}` : '',
    step.supplier_name ? `Поставщик: ${step.supplier_name}` : '',
  ].filter(Boolean);
  return (
    <Box sx={{ maxWidth: 300, py: 0.25 }}>
      <Typography variant="subtitle2" fontWeight={850} color="inherit">{step.label}</Typography>
      <Typography variant="body2" color="inherit" sx={{ mt: 0.35, lineHeight: 1.35 }}>
        {JOURNEY_STEP_EXPLANATIONS[step.key] || 'Этап движения заявки и связанных документов.'}
      </Typography>
      <Typography variant="caption" color="inherit" sx={{ display: 'block', mt: 0.65, opacity: 0.82 }}>
        {journeyStepState(step)}
      </Typography>
      {details.length ? (
        <Typography variant="caption" color="inherit" sx={{ display: 'block', mt: 0.25, opacity: 0.82 }}>
          {details.join(' · ')}
        </Typography>
      ) : null}
    </Box>
  );
}

export function ConstructionRequestJourney({ request, compact = false }) {
  const steps = journeyFor(request);
  const attention = request?.stage?.key === 'needs_review';
  const cancelled = request?.stage?.key === 'cancelled';
  return (
    <Box
      component="ol"
      aria-label="Путь заявки"
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(5, minmax(0, 1fr))' },
        gap: { xs: compact ? 0.55 : 0.85, sm: 0.65 },
        m: 0,
        p: 0,
        listStyle: 'none',
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
              : 'ещё не начат';
        return (
          <Tooltip
            key={step.key}
            title={<JourneyStepTooltip step={step} />}
            describeChild
            arrow
            enterDelay={150}
            enterTouchDelay={450}
          >
            <Box
              component="li"
              aria-current={current ? 'step' : undefined}
              aria-label={`${step.label}: ${stateLabel}`}
              tabIndex={compact ? undefined : 0}
              sx={{
                position: 'relative',
                display: 'grid',
                minWidth: 0,
                gridTemplateColumns: { xs: '22px minmax(0, 1fr)', sm: 'minmax(0, 1fr)' },
                gap: { xs: 1, sm: 0.35 },
                alignItems: { xs: 'start', sm: 'center' },
                textAlign: { xs: 'start', sm: 'center' },
                pb: { xs: index < steps.length - 1 ? 0.45 : 0, sm: 0 },
                borderRadius: 1.5,
                cursor: 'help',
                '&:focus-visible': {
                  outline: '3px solid',
                  outlineColor: 'primary.main',
                  outlineOffset: 2,
                },
                '&::after': index < steps.length - 1 ? {
                  content: '""',
                  position: 'absolute',
                  zIndex: 0,
                  bgcolor: reached && steps[index + 1]?.reached ? 'primary.main' : 'divider',
                  left: { xs: '9px', sm: 'calc(50% + 11px)' },
                  top: { xs: '20px', sm: '9px' },
                  bottom: { xs: '-8px', sm: 'auto' },
                  right: { xs: 'auto', sm: 'calc(-50% + 11px)' },
                  width: { xs: '2px', sm: 'auto' },
                  height: { xs: 'auto', sm: '2px' },
                } : undefined,
              }}
            >
              <Box
                aria-hidden="true"
                sx={{
                  position: 'relative',
                  zIndex: 1,
                  justifySelf: { xs: 'start', sm: 'center' },
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: reached ? (cancelled ? 'text.disabled' : 'primary.main') : 'background.paper',
                  color: reached ? 'primary.contrastText' : 'text.disabled',
                  border: '2px solid',
                  borderColor: attention && current
                    ? 'warning.main'
                    : reached
                      ? (cancelled ? 'text.disabled' : 'primary.main')
                      : 'divider',
                  boxShadow: current ? (theme) => `0 0 0 4px ${alpha(
                    attention ? theme.palette.warning.main : theme.palette.primary.main,
                    0.16,
                  )}` : 'none',
                }}
              >
                {reached ? <CheckRoundedIcon sx={{ fontSize: 13 }} /> : null}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  variant="caption"
                  fontWeight={current ? 850 : reached ? 700 : 600}
                  color={reached ? 'text.primary' : 'text.secondary'}
                  sx={{ display: 'block', lineHeight: 1.2, overflowWrap: 'anywhere' }}
                >
                  {step.label}
                </Typography>
                {!compact && (step.date || step.document_number) ? (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>
                    {[step.document_number, formatConstructionDate(step.date)]
                      .filter((value) => value && value !== '—').join(' · ')}
                  </Typography>
                ) : null}
              </Box>
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
}

function RequestBadges({ request }) {
  return (
    <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.65}>
      <Chip
        size="small"
        label={request?.stage?.label || 'Этап не определён'}
        color={request?.stage?.key === 'fulfilled'
          ? 'success'
          : request?.stage?.key === 'needs_review'
            ? 'warning'
            : 'primary'}
        variant={request?.stage?.key === 'fulfilled' ? 'filled' : 'outlined'}
      />
      {request?.overdue ? <Chip size="small" color="error" label="Просрочено" /> : null}
      {request?.attention_required && request?.stage?.key !== 'needs_review' ? (
        <Chip size="small" color="warning" icon={<WarningAmberRoundedIcon />} label="Проверить данные" />
      ) : null}
    </Stack>
  );
}

export function ConstructionRequestCard({ item, selected = false, onOpen }) {
  const nomenclature = Array.isArray(item?.nomenclature_items) ? item.nomenclature_items : [];
  return (
    <Paper
      component="article"
      variant="outlined"
      sx={{
        mb: 1,
        overflow: 'hidden',
        borderRadius: 3,
        borderColor: selected ? 'primary.main' : 'divider',
        boxShadow: selected ? (theme) => `0 8px 24px ${alpha(theme.palette.primary.main, 0.1)}` : 'none',
      }}
    >
      <ButtonBase
        onClick={() => onOpen(item.request_ref)}
        aria-label={`Открыть заявку ${item.request_number}`}
        sx={{
          display: 'block',
          width: '100%',
          minHeight: 44,
          p: { xs: 1.25, sm: 1.5 },
          textAlign: 'start',
          borderRadius: 3,
          '&:focus-visible': {
            outline: '3px solid',
            outlineColor: 'primary.main',
            outlineOffset: -3,
          },
        }}
      >
        <Stack spacing={1.25}>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={0.75}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" fontWeight={850} sx={{ overflowWrap: 'anywhere' }}>
                {item.request_number || 'Заявка без входящего номера'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {formatConstructionDate(item.date)} · требуется {formatConstructionDate(item.required_date)}
              </Typography>
            </Box>
            <RequestBadges request={item} />
          </Stack>
          <Box
            sx={{
              p: 1,
              borderRadius: 2.5,
              bgcolor: (theme) => alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.1 : 0.045),
            }}
          >
            <Typography variant="body2" fontWeight={800} sx={{ overflowWrap: 'anywhere' }}>
              {item.current_state?.description || item.progress_label || positionsLabel(item.positions_total)}
            </Typography>
            <Box sx={{ mt: 1 }}><ConstructionRequestJourney request={item} compact /></Box>
          </Box>
          <Stack direction="row" spacing={0.75} alignItems="flex-start">
            <Inventory2OutlinedIcon fontSize="small" color="action" sx={{ mt: 0.15, flexShrink: 0 }} />
            <Box sx={{ minWidth: 0 }}>
              {nomenclature.slice(0, 3).map((position, index) => (
                <Typography key={`${position.name}-${index}`} variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                  {position.name || 'Номенклатура без наименования'} — {formatQuantity(position.quantity)} {position.unit}
                </Typography>
              ))}
              {nomenclature.length > 3 ? (
                <Typography variant="caption" color="text.secondary">Ещё {nomenclature.length - 3} наимен.</Typography>
              ) : null}
            </Box>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {[item.warehouse_name || 'Склад не указан', positionsLabel(item.positions_total)]
              .filter(Boolean).join(' · ')}
          </Typography>
        </Stack>
      </ButtonBase>
    </Paper>
  );
}

function MetaValue({ label, children }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{label}</Typography>
      <Typography variant="body2" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{children || '—'}</Typography>
    </Box>
  );
}

function itemGroupsFor(request) {
  if (Array.isArray(request?.item_groups) && request.item_groups.length) return request.item_groups;
  return Array.isArray(request?.nomenclature_items) ? request.nomenclature_items : [];
}

function JourneyDocuments({ request }) {
  const timeline = Array.isArray(request?.timeline) ? request.timeline : [];
  const steps = journeyFor(request)
    .map((step) => {
      const ownDocuments = Array.isArray(step.documents) ? step.documents : [];
      return {
        ...step,
        documents: ownDocuments.length
          ? ownDocuments
          : timeline.filter((event) => EVENT_STEP[event.type] === step.key),
      };
    })
    .filter((step) => step.documents.length);
  if (!steps.length) {
    return <Typography color="text.secondary">Связанные документы пока не найдены.</Typography>;
  }
  return (
    <Stack spacing={0.75} sx={{ mt: 1.5 }}>
      {steps.map((step) => (
        <Box component="details" key={step.key} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
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
            {step.documents.map((event, index) => {
              const route = [event.source_name, event.destination_name].filter(Boolean).join(' → ');
              return (
                <Box
                  component="li"
                  key={`${event.type}-${event.document_ref}-${index}`}
                  sx={{ position: 'relative', pl: 2.5, pb: 1.75, listStyle: 'none' }}
                >
                  <Box
                    aria-hidden="true"
                    sx={{ position: 'absolute', insetInlineStart: 2, top: 7, width: 9, height: 9, borderRadius: '50%', bgcolor: 'primary.main' }}
                  />
                  <Typography variant="body2" fontWeight={750}>{event.label || 'Документ 1С'}</Typography>
                  <Typography variant="body2">
                    {event.document_number || 'Без номера'} · {formatConstructionDate(event.date)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" component="div" sx={{ overflowWrap: 'anywhere' }}>
                    {formatQuantity(event.quantity)}
                    {event.manager_name ? ` · закупщик: ${event.manager_name}` : ''}
                    {event.supplier_name ? ` · поставщик: ${event.supplier_name}` : ''}
                    {route ? ` · ${route}` : ''}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </Box>
      ))}
    </Stack>
  );
}

export function ConstructionRequestDetail({ request, loading, error, showBack = false, onBack }) {
  if (loading && !request) return <Skeleton variant="rounded" height={460} aria-label="Загрузка заявки" />;
  if (!request) {
    return (
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, textAlign: 'center', borderRadius: 3 }}>
        {showBack ? (
          <Button startIcon={<ArrowBackRoundedIcon />} onClick={onBack} sx={{ minHeight: 44, mb: 1 }}>
            К заявкам объекта
          </Button>
        ) : null}
        <Typography variant="h6" fontWeight={800}>Выберите заявку</Typography>
        <Typography color="text.secondary">Здесь появятся номенклатура и движение документов.</Typography>
      </Paper>
    );
  }
  const items = itemGroupsFor(request);
  const state = request.current_state || {
    label: request.stage?.label || 'Состояние не определено',
    description: request.progress_label || positionsLabel(request.positions_total),
  };
  return (
    <Stack spacing={1.5}>
      {showBack ? (
        <Button startIcon={<ArrowBackRoundedIcon />} onClick={onBack} sx={{ minHeight: 44, alignSelf: 'flex-start' }}>
          К заявкам объекта
        </Button>
      ) : null}
      {error ? <Paper role="alert" sx={{ p: 1.5, bgcolor: 'warning.main', color: 'warning.contrastText' }}>{error}</Paper> : null}
      <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2.25 }, borderRadius: 3.5 }}>
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
            <Box sx={{ minWidth: 0 }}>
              <Typography component={showBack ? 'h1' : 'h2'} variant="h5" fontWeight={900} sx={{ overflowWrap: 'anywhere' }}>
                {request.request_number || 'Заявка без входящего номера'}
              </Typography>
              <Typography color="text.secondary">{positionsLabel(request.positions_total)}</Typography>
            </Box>
            <RequestBadges request={request} />
          </Stack>
          <Box
            role="status"
            sx={{
              p: { xs: 1.25, sm: 1.5 },
              borderInlineStart: '4px solid',
              borderColor: request.stage?.key === 'fulfilled' ? 'success.main' : 'primary.main',
              borderRadius: 2.5,
              bgcolor: (theme) => alpha(
                request.stage?.key === 'fulfilled' ? theme.palette.success.main : theme.palette.primary.main,
                theme.palette.mode === 'dark' ? 0.13 : 0.055,
              ),
            }}
          >
            <Typography variant="subtitle1" fontWeight={900}>{state.label}</Typography>
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{state.description}</Typography>
            {state.date || state.document_number ? (
              <Typography variant="caption" color="text.secondary">
                {[state.document_number, formatConstructionDate(state.date)]
                  .filter((value) => value && value !== '—').join(' · ')}
              </Typography>
            ) : null}
          </Box>
          <Box
            component="section"
            aria-labelledby="construction-request-journey-title"
            sx={{
              p: { xs: 1.25, sm: 1.75 },
              borderRadius: 3,
              bgcolor: (theme) => alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.1 : 0.045),
            }}
          >
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={0.25} sx={{ mb: 1.5 }}>
              <Typography id="construction-request-journey-title" component="h3" variant="subtitle1" fontWeight={850}>
                Путь заявки
              </Typography>
              <Typography variant="caption" color="text.secondary">Общий для всей номенклатуры</Typography>
            </Stack>
            <ConstructionRequestJourney request={request} />
            <JourneyDocuments request={request} />
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(170px, 100%), 1fr))', gap: 1.5 }}>
            <MetaValue label="Склад назначения">{request.warehouse_name}</MetaValue>
            <MetaValue label="Дата заявки">{formatConstructionDate(request.date)}</MetaValue>
            <MetaValue label="Требуется к">{formatConstructionDate(request.required_date)}</MetaValue>
            <MetaValue label="Подразделение">{request.department_name}</MetaValue>
            <MetaValue label="Инициатор">{request.initiator_name}</MetaValue>
            <MetaValue label="Ответственный">{request.responsible_name}</MetaValue>
            <MetaValue label="Закупщик">{request.manager_names?.join(', ')}</MetaValue>
            <MetaValue label="Поставщик">{request.supplier_names?.join(', ') || request.supplier_name}</MetaValue>
            <MetaValue label="Фактическая поставка">{formatConstructionDate(request.factual_delivery_date)}</MetaValue>
          </Box>
        </Stack>
      </Paper>

      <Paper component="section" variant="outlined" aria-labelledby="construction-request-items-title" sx={{ overflow: 'hidden', borderRadius: 3.5 }}>
        <Box sx={{ p: { xs: 1.5, sm: 2 } }}>
          <Typography id="construction-request-items-title" component="h2" variant="h6" fontWeight={850}>Номенклатура</Typography>
          <Typography variant="body2" color="text.secondary">
            {positionsLabel(request.positions_total)} · {items.length} уникальных наименований
          </Typography>
        </Box>
        <Divider />
        {items.length ? items.map((item, index) => (
          <Box
            component="article"
            key={`${item.nomenclature_ref || item.name}-${item.characteristic_name}-${item.cancelled}-${index}`}
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 1fr) auto' },
              gap: 1,
              p: { xs: 1.5, sm: 2 },
              borderTop: index ? '1px solid' : 0,
              borderColor: 'divider',
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.75} alignItems="center">
                <Typography component="h3" variant="body1" fontWeight={800} sx={{ overflowWrap: 'anywhere' }}>
                  {item.name || item.nomenclature_name || 'Номенклатура без наименования'}
                </Typography>
                {item.cancelled ? <Chip size="small" variant="outlined" label="Отменено" /> : null}
              </Stack>
              {item.characteristic_name ? <Typography variant="body2" color="text.secondary">{item.characteristic_name}</Typography> : null}
              {Number(item.source_line_count) > 1 ? (
                <Typography variant="caption" color="text.secondary">Объединено строк в 1С: {item.source_line_count}</Typography>
              ) : null}
              {item.cancelled && item.cancellation_reasons?.length ? (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  Причина: {item.cancellation_reasons.join('; ')}
                </Typography>
              ) : null}
            </Box>
            <Typography variant="body1" fontWeight={900} sx={{ whiteSpace: 'nowrap' }}>
              {formatQuantity(item.quantity)} {item.unit || item.unit_name}
            </Typography>
          </Box>
        )) : <Typography color="text.secondary" sx={{ p: 2 }}>Номенклатура не найдена.</Typography>}
      </Paper>
    </Stack>
  );
}
