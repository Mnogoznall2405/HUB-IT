import { memo, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  Link,
  List,
  ListItem,
  ListItemButton,
  Paper,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import AssignmentTurnedInOutlinedIcon from '@mui/icons-material/AssignmentTurnedInOutlined';
import AttachFileOutlinedIcon from '@mui/icons-material/AttachFileOutlined';
import CalendarTodayOutlinedIcon from '@mui/icons-material/CalendarTodayOutlined';
import CheckCircleOutlineOutlinedIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import ChevronRightOutlinedIcon from '@mui/icons-material/ChevronRightOutlined';
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import OpenInNewOutlinedIcon from '@mui/icons-material/OpenInNewOutlined';
import PersonOutlineOutlinedIcon from '@mui/icons-material/PersonOutlineOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import MailAttachmentCard from '../../components/mail/MailAttachmentCard';


const TITLE_EXPAND_THRESHOLD = 120;

const clampedTitleSx = (lines) => ({
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: lines,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  overflowWrap: 'anywhere',
});

function parseDocflowDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.getFullYear() <= 1901) return null;
  return parsed;
}

export function formatDocflowDate(value) {
  const parsed = parseDocflowDate(value);
  if (!parsed) return '';
  return parsed.toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: parsed.getHours() || parsed.getMinutes() ? '2-digit' : undefined,
    minute: parsed.getHours() || parsed.getMinutes() ? '2-digit' : undefined,
  });
}

export function formatDocflowFileSize(value) {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) return 'Размер не указан';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let current = size;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current >= 10 || index === 0 ? current.toFixed(0) : current.toFixed(1)} ${units[index]}`;
}

const DESCRIPTION_LINK_RE = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|https?:\/\/[^\s<>"')\]]+)/g;

function looksLikeInitialFragment(text) {
  return /(?:^|[\s(«"'])[А-ЯA-Z]\.$/.test(String(text || '').trim())
    || /[А-ЯA-Z]\.[А-ЯA-Z]\.$/.test(String(text || '').trim());
}

function softSplitDescriptionSentences(text) {
  const source = String(text || '').trim();
  if (!source) return [];
  const tokens = source.split(/(?<=[.!?…])\s+/).map((part) => part.trim()).filter(Boolean);
  if (tokens.length <= 1) return [source];

  const paragraphs = [];
  let buffer = '';
  tokens.forEach((token) => {
    if (!buffer) {
      buffer = token;
      return;
    }
    if (looksLikeInitialFragment(buffer) || (!/[.!?…]$/.test(buffer) && buffer.length < 48)) {
      buffer = `${buffer} ${token}`;
      return;
    }
    paragraphs.push(buffer);
    buffer = token;
  });
  if (buffer) paragraphs.push(buffer);
  return paragraphs.length > 1 ? paragraphs : [source];
}

/** Разбивает текст задания 1С на абзацы для читаемой вёрстки. */
export function splitDocflowDescriptionParagraphs(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return [];

  let parts = raw.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 1 && parts[0].includes('\n')) {
    const lines = parts[0].split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length >= 2) parts = lines;
  }
  if (parts.length === 1 && parts[0].length > 140) {
    const soft = softSplitDescriptionSentences(parts[0]);
    if (soft.length > 1) parts = soft;
  }
  return parts;
}

function DescriptionInlineText({ text }) {
  const value = String(text || '');
  const nodes = [];
  let lastIndex = 0;
  DESCRIPTION_LINK_RE.lastIndex = 0;
  let match = DESCRIPTION_LINK_RE.exec(value);
  while (match) {
    if (match.index > lastIndex) nodes.push(value.slice(lastIndex, match.index));
    const token = match[0];
    if (token.includes('@')) {
      nodes.push(
        <Link key={`mail-${match.index}`} href={`mailto:${token}`} underline="hover" sx={{ fontWeight: 600 }}>
          {token}
        </Link>,
      );
    } else {
      nodes.push(
        <Link
          key={`url-${match.index}`}
          href={token}
          target="_blank"
          rel="noopener noreferrer"
          underline="hover"
          sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}
        >
          {token}
        </Link>,
      );
    }
    lastIndex = match.index + token.length;
    match = DESCRIPTION_LINK_RE.exec(value);
  }
  if (lastIndex < value.length) nodes.push(value.slice(lastIndex));
  return nodes.length > 0 ? nodes : value;
}

function TaskDescriptionBody({ description }) {
  const paragraphs = splitDocflowDescriptionParagraphs(description);
  if (paragraphs.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Описание в 1С не указано.
      </Typography>
    );
  }
  return (
    <Stack spacing={1.35} sx={{ width: '100%' }}>
      {paragraphs.map((paragraph, index) => (
        <Typography
          key={`${index}-${paragraph.slice(0, 24)}`}
          variant="body2"
          component="p"
          sx={{
            m: 0,
            width: '100%',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            lineHeight: 1.65,
            fontWeight: index === 0 && paragraphs.length > 1 ? 600 : 400,
            color: 'text.primary',
          }}
        >
          <DescriptionInlineText text={paragraph} />
        </Typography>
      ))}
    </Stack>
  );
}

function TaskStatusChips({ task }) {
  const processLabel = task?.process_type_label || task?.process_type;
  const importance = String(task?.importance || '').trim();
  const showImportance = importance && !importance.toLocaleLowerCase('ru-RU').includes('обычн');
  return (
    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
      <Chip
        size="small"
        color={task?.completed ? 'success' : 'primary'}
        label={task?.completed ? 'Завершено' : (task?.accepted ? 'Принято в работу' : 'Новое')}
        sx={{ height: 22, '& .MuiChip-label': { px: 0.7, fontSize: '0.65rem' } }}
      />
      {processLabel ? (
        <Chip
          size="small"
          variant="outlined"
          label={processLabel}
          sx={{ height: 22, '& .MuiChip-label': { px: 0.7, fontSize: '0.65rem' } }}
        />
      ) : null}
      {showImportance ? (
        <Chip
          size="small"
          color="warning"
          variant="outlined"
          label={importance}
          sx={{ height: 22, '& .MuiChip-label': { px: 0.7, fontSize: '0.65rem' } }}
        />
      ) : null}
    </Stack>
  );
}

export const DocflowTaskCard = memo(function DocflowTaskCard({ task, onOpen }) {
  const title = String(task?.title || 'Задание 1С').trim() || 'Задание 1С';
  const due = formatDocflowDate(task?.due_at);
  const created = formatDocflowDate(task?.created_at);
  const completed = formatDocflowDate(task?.completed_at);
  const dateLabel = task?.completed && completed
    ? 'Выполнено'
    : (due ? 'Срок исполнения' : 'Поставлено');
  const dateValue = task?.completed && completed ? completed : (due || created);
  const dueDate = parseDocflowDate(task?.due_at);
  const overdue = Boolean(dueDate && !task?.completed && dueDate.getTime() < Date.now());

  return (
    <ListItem
      disablePadding
      divider
      data-testid={`docflow-task-${task?.ref || 'unknown'}`}
      sx={{ contentVisibility: 'auto', containIntrinsicSize: '0 72px' }}
    >
      <ListItemButton
        onClick={() => onOpen(task)}
        alignItems="flex-start"
        title={title}
        aria-label={title}
        sx={{
          px: { xs: 1.1, sm: 1.75 },
          py: { xs: 0.85, sm: 1 },
          minHeight: { xs: 68, sm: 72 },
          gap: { xs: 0.75, sm: 1.25 },
          transitionProperty: 'background-color',
          transitionDuration: '150ms',
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={0.75} alignItems="flex-start">
            <Typography
              variant="body2"
              fontWeight={700}
              sx={{ flex: 1, minWidth: 0, lineHeight: 1.25, fontSize: { xs: '0.8125rem', sm: '0.875rem' }, ...clampedTitleSx(2) }}
            >
              {title}
            </Typography>
            <ChevronRightOutlinedIcon color="action" aria-hidden sx={{ flexShrink: 0, mt: 0.05, fontSize: 20 }} />
          </Stack>

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={{ xs: 0.5, sm: 1.25 }}
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            useFlexGap
            flexWrap="wrap"
            sx={{ mt: 0.65 }}
          >
            <TaskStatusChips task={task} />
            {task?.author ? (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, minWidth: 0, fontSize: '0.7rem' }}
              >
                <PersonOutlineOutlinedIcon sx={{ fontSize: 14, flexShrink: 0 }} />
                <Box component="span" sx={{ overflowWrap: 'anywhere' }}>{task.author}</Box>
              </Typography>
            ) : null}
            {dateValue ? (
              <Box
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.45,
                  px: 0.75,
                  py: 0.25,
                  borderRadius: 1.25,
                  bgcolor: overdue ? 'error.main' : 'action.hover',
                  color: overdue ? 'error.contrastText' : 'text.primary',
                }}
              >
                {task?.completed ? (
                  <CheckCircleOutlineOutlinedIcon sx={{ fontSize: 14 }} />
                ) : (
                  <ScheduleOutlinedIcon sx={{ fontSize: 14 }} />
                )}
                <Typography variant="caption" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.65rem' }}>
                  {dateLabel}: {dateValue}
                </Typography>
              </Box>
            ) : null}
          </Stack>
        </Box>
      </ListItemButton>
    </ListItem>
  );
});

export const DocflowTaskList = memo(function DocflowTaskList({ tasks, onOpen }) {
  if (!Array.isArray(tasks) || tasks.length === 0) return null;
  return (
    <List disablePadding>
      {tasks.map((task) => (
        <DocflowTaskCard key={task.ref} task={task} onOpen={onOpen} />
      ))}
    </List>
  );
});

function DetailValue({ label, children, icon: IconComponent, accent = false, tone = 'default' }) {
  if (children === null || children === undefined || children === '') return null;
  const success = tone === 'success';
  const emphasized = accent || success;
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1.25,
        alignItems: 'flex-start',
        minWidth: 0,
        p: 1.5,
        borderRadius: 2.25,
        border: 1,
        borderColor: accent
          ? 'primary.main'
          : (success
            ? ((themeValue) => (themeValue.palette.mode === 'dark' ? 'rgba(129,199,132,0.35)' : 'rgba(46,125,50,0.28)'))
            : 'divider'),
        bgcolor: accent
          ? 'primary.main'
          : (success
            ? ((themeValue) => (themeValue.palette.mode === 'dark' ? 'rgba(129,199,132,0.10)' : 'rgba(46,125,50,0.06)'))
            : 'background.paper'),
        color: accent ? 'primary.contrastText' : 'text.primary',
        boxShadow: (theme) => (emphasized ? 'none' : `inset 0 0 0 1px ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,.02)' : 'rgba(15,23,42,.02)'}`),
      }}
    >
      {IconComponent ? (
        <Box
          aria-hidden
          sx={{
            width: 34,
            height: 34,
            borderRadius: 1.75,
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
            bgcolor: accent
              ? 'rgba(255,255,255,.16)'
              : (success
                ? ((themeValue) => (themeValue.palette.mode === 'dark' ? 'rgba(129,199,132,0.16)' : 'rgba(46,125,50,0.10)'))
                : 'action.selected'),
            color: accent
              ? 'inherit'
              : (success
                ? ((themeValue) => (themeValue.palette.mode === 'dark' ? 'rgba(165,214,167,0.95)' : themeValue.palette.success.dark))
                : 'text.secondary'),
          }}
        >
          <IconComponent sx={{ fontSize: 18 }} />
        </Box>
      ) : null}
      <Box sx={{ minWidth: 0, pt: 0.1 }}>
        <Typography
          variant="overline"
          sx={{
            display: 'block',
            lineHeight: 1.2,
            letterSpacing: '0.08em',
            color: accent
              ? 'inherit'
              : (success
                ? ((themeValue) => (themeValue.palette.mode === 'dark' ? 'rgba(165,214,167,0.75)' : themeValue.palette.success.dark))
                : 'text.secondary'),
            opacity: accent ? 0.86 : 1,
          }}
        >
          {label}
        </Typography>
        <Typography
          variant="body2"
          fontWeight={700}
          sx={{
            mt: 0.45,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1.35,
            color: accent
              ? 'inherit'
              : (success
                ? ((themeValue) => (themeValue.palette.mode === 'dark' ? 'rgba(200,230,201,0.95)' : themeValue.palette.success.dark))
                : 'inherit'),
          }}
        >
          {children}
        </Typography>
      </Box>
    </Box>
  );
}

function TaskFiles({ task, loading, error, onPreviewFile, onDownloadFile }) {
  const files = Array.isArray(task?.files)
    ? task.files.filter((file) => !file?.xdto_type || file.xdto_type === 'DMFile')
    : [];
  return (
    <Stack spacing={1.1}>
      <Stack direction="row" spacing={0.75} alignItems="center">
        <AttachFileOutlinedIcon color="action" fontSize="small" />
        <Typography fontWeight={800}>Файлы</Typography>
        {!loading ? <Chip size="small" label={files.length} /> : null}
      </Stack>
      {error ? (
        <Alert severity="error">
          {error.message}
          {error.correlationId ? (
            <Typography variant="caption" display="block">Код обращения: {error.correlationId}</Typography>
          ) : null}
        </Alert>
      ) : null}
      {loading ? (
        <Stack spacing={0.8} data-testid="docflow-detail-files-skeleton">
          {[0, 1].map((item) => <Skeleton key={item} variant="rounded" height={62} />)}
        </Stack>
      ) : files.length > 0 ? (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' },
            gap: 1,
            minWidth: 0,
          }}
        >
          {files.map((file) => (
            <Box
              key={file.ref}
              sx={{ minWidth: 0, contentVisibility: 'auto', containIntrinsicSize: '0 56px', '& > div': { width: '100%' } }}
            >
              <MailAttachmentCard
                attachment={{ ...file, downloadable: true }}
                onOpen={() => (file.preview_supported ? onPreviewFile?.(task, file) : onDownloadFile?.(task, file))}
                onDownload={() => onDownloadFile?.(task, file)}
                formatFileSize={formatDocflowFileSize}
              />
            </Box>
          ))}
        </Box>
      ) : (
        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2.25, bgcolor: 'action.hover' }}>
          <Typography variant="body2" color="text.secondary">К этому заданию файлы не прикреплены.</Typography>
        </Paper>
      )}
    </Stack>
  );
}

function TaskActionBar({ task, working, progressLabel, commandState, onAction, onCheckCommand }) {
  const actions = Array.isArray(task?.available_actions) ? task.available_actions : [];
  const requiresDigitalSignature = Boolean(task?.requires_digital_signature);
  const waitingCommand = commandState?.status === 'state_unknown' || commandState?.status === 'pending';
  const showProgress = Boolean(working || waitingCommand);
  const resolvedProgressLabel = String(progressLabel || '').trim() || (waitingCommand ? 'Действие в 1С' : '');
  if (actions.length === 0 && !commandState && !requiresDigitalSignature && !showProgress) return null;
  return (
    <Stack
      spacing={1}
      sx={{
        flexShrink: 0,
        px: 2,
        py: 1.5,
        pb: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
        bgcolor: 'background.paper',
        borderTop: 1,
        borderColor: 'divider',
        boxShadow: (theme) => `0 -8px 24px ${theme.palette.mode === 'dark' ? 'rgba(0,0,0,.35)' : 'rgba(15,23,42,.08)'}`,
      }}
    >
      {showProgress ? (
        <Paper
          variant="outlined"
          role="status"
          aria-live="polite"
          aria-busy={working || undefined}
          sx={{
            p: 1.5,
            borderRadius: 2.25,
            borderColor: 'primary.main',
            bgcolor: (themeValue) => (
              themeValue.palette.mode === 'dark'
                ? 'rgba(25,118,210,0.12)'
                : 'rgba(25,118,210,0.06)'
            ),
          }}
        >
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.25}
            alignItems={{ xs: 'stretch', sm: 'center' }}
            justifyContent="space-between"
          >
            <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
              <CircularProgress size={22} />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight={800} sx={{ overflowWrap: 'anywhere' }}>
                  {resolvedProgressLabel}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  {waitingCommand
                    ? 'Подтверждаем выполнение в 1С. Обычно это занимает несколько секунд.'
                    : 'Отправляем в 1С и ждём ответ…'}
                </Typography>
                {commandState?.correlation_id ? (
                  <Typography variant="caption" color="text.secondary" display="block">
                    Код обращения: {commandState.correlation_id}
                  </Typography>
                ) : null}
              </Box>
            </Stack>
            {waitingCommand ? (
              <Button
                color="primary"
                variant="outlined"
                size="small"
                disabled={working}
                onClick={onCheckCommand}
                sx={{ alignSelf: { xs: 'stretch', sm: 'center' }, minHeight: 36 }}
              >
                Проверить
              </Button>
            ) : null}
          </Stack>
        </Paper>
      ) : null}
      {!showProgress && actions.length > 0 ? (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          useFlexGap
          flexWrap="wrap"
        >
          {actions.map((action) => (
            <Button
              key={action.code}
              variant={action.code === 'reject' ? 'outlined' : 'contained'}
              color={action.tone || 'primary'}
              disabled={working}
              onClick={() => onAction?.(action)}
              sx={{
                minHeight: { xs: 40, sm: 44 },
                width: { xs: '100%', sm: 'auto' },
                flex: { sm: '0 0 auto' },
                px: { xs: 1.25, sm: 2 },
                fontSize: { xs: '0.8125rem', sm: '0.875rem' },
                lineHeight: 1.25,
                whiteSpace: { xs: 'normal', sm: 'nowrap' },
                textAlign: 'center',
              }}
            >
              {action.label}
            </Button>
          ))}
        </Stack>
      ) : null}
      {!showProgress && requiresDigitalSignature && task?.open_in_1c_url ? (
        <Button
          component="a"
          href={task.open_in_1c_url}
          target="_blank"
          rel="noopener noreferrer"
          variant="contained"
          endIcon={<OpenInNewOutlinedIcon />}
          sx={{
            minHeight: { xs: 40, sm: 44 },
            width: { xs: '100%', sm: 'auto' },
            alignSelf: { sm: 'flex-start' },
            fontSize: { xs: '0.8125rem', sm: '0.875rem' },
          }}
        >
          Выполнить в 1С
        </Button>
      ) : null}
    </Stack>
  );
}

function TaskDetailsContent({ task, loading, filesLoading = false, error, fileError, actionNotice, onRetry, onPreviewFile, onDownloadFile }) {
  const created = formatDocflowDate(task?.created_at);
  const due = formatDocflowDate(task?.due_at);
  const completed = formatDocflowDate(task?.completed_at);
  const relatedObjects = Array.isArray(task?.related_objects) ? task.related_objects : [];
  return (
    <Stack spacing={2.5}>
      <TaskStatusChips task={task} />
      {actionNotice?.severity && actionNotice?.message ? (
        <Alert severity={actionNotice.severity}>{actionNotice.message}</Alert>
      ) : null}
      {!task?.completed && task?.action_unavailable_reason ? (
        <Alert severity="info" variant="outlined">{task.action_unavailable_reason}</Alert>
      ) : null}
      {error ? (
        <Alert
          severity="error"
          action={<Button color="inherit" size="small" onClick={onRetry}>Повторить</Button>}
        >
          {error.message}
          {error.correlationId ? (
            <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
              Код обращения: {error.correlationId}
            </Typography>
          ) : null}
        </Alert>
      ) : null}
      <Box>
        <Typography component="h3" variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>
          Описание
        </Typography>
        <Paper
          variant="outlined"
          sx={{
            p: { xs: 1.5, sm: 2 },
            borderRadius: 2.5,
            bgcolor: 'background.paper',
            borderColor: 'divider',
          }}
        >
          {loading ? (
            <Stack spacing={0.35} sx={{ mt: 0.5 }}>
              <Skeleton width="96%" />
              <Skeleton width="84%" />
              <Skeleton width="58%" />
            </Stack>
          ) : (
            <TaskDescriptionBody description={task?.description} />
          )}
        </Paper>
      </Box>
      <Box>
        <Typography component="h3" variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>
          Сведения
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' },
            gap: 1.25,
          }}
        >
          <DetailValue label="Автор" icon={PersonOutlineOutlinedIcon}>{task?.author}</DetailValue>
          <DetailValue label="Поставлено" icon={CalendarTodayOutlinedIcon}>{created}</DetailValue>
          <DetailValue label="Срок исполнения" icon={ScheduleOutlinedIcon} accent={Boolean(due && !task?.completed)}>{due}</DetailValue>
          <DetailValue label="Выполнено" icon={CheckCircleOutlineOutlinedIcon}>{completed}</DetailValue>
          <DetailValue label="Результат" icon={CheckCircleOutlineOutlinedIcon} tone="success">{task?.result}</DetailValue>
        </Box>
      </Box>
      {relatedObjects.length > 0 ? (
        <Stack spacing={1.15}>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <DescriptionOutlinedIcon color="action" fontSize="small" />
            <Typography component="h3" variant="subtitle1" fontWeight={800}>
              {relatedObjects.length === 1 ? 'Связанный документ' : 'Связанные документы'}
            </Typography>
          </Stack>
          {relatedObjects.map((item) => (
            <Paper
              key={item.ref}
              variant="outlined"
              sx={{
                p: 1.5,
                borderRadius: 2.25,
                bgcolor: 'background.paper',
                borderColor: 'divider',
                borderLeftWidth: 3,
                borderLeftColor: 'primary.main',
              }}
            >
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', letterSpacing: '0.06em', textTransform: 'uppercase', mb: 0.45 }}
              >
                Документ 1С
              </Typography>
              <Typography variant="body2" fontWeight={700} sx={{ overflowWrap: 'anywhere', textWrap: 'pretty', lineHeight: 1.4 }}>
                {item.title}
              </Typography>
            </Paper>
          ))}
        </Stack>
      ) : null}
      <TaskFiles
        task={task}
        loading={Boolean(loading || filesLoading)}
        error={fileError}
        onPreviewFile={onPreviewFile}
        onDownloadFile={onDownloadFile}
      />
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: 'text.secondary' }}>
        <LockOutlinedIcon sx={{ fontSize: 16, flexShrink: 0 }} />
        <Typography variant="caption">
          Файлы открываются с вашими правами доступа 1С.
        </Typography>
      </Stack>
    </Stack>
  );
}

function DetailsHeader({ task, loading, onRefresh, onClose }) {
  const title = String(task?.title || 'Задание 1С').trim() || 'Задание 1С';
  const canExpand = title.length > TITLE_EXPAND_THRESHOLD;
  const [titleExpanded, setTitleExpanded] = useState(false);

  useEffect(() => {
    setTitleExpanded(false);
  }, [task?.ref, title]);

  return (
    <Stack
      direction="row"
      spacing={1.25}
      alignItems="flex-start"
      sx={{ flexShrink: 0, px: 2, pt: 1.5, pb: 1.25 }}
    >
      <Box sx={{ width: 38, height: 38, borderRadius: 2, bgcolor: 'primary.main', color: 'primary.contrastText', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <AssignmentTurnedInOutlinedIcon fontSize="small" />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.2, letterSpacing: '0.06em' }}>
          {task?.process_type_label || task?.process_type || 'Задание 1С'}
        </Typography>
        <Typography
          component="h2"
          variant="subtitle1"
          fontWeight={700}
          title={title}
          sx={{
            mt: 0.25,
            lineHeight: 1.35,
            ...(titleExpanded ? { overflowWrap: 'anywhere' } : clampedTitleSx(3)),
          }}
        >
          {title}
        </Typography>
        {canExpand ? (
          <Button
            size="small"
            onClick={() => setTitleExpanded((value) => !value)}
            sx={{ mt: 0.35, minHeight: 32, px: 0.5, alignSelf: 'flex-start' }}
          >
            {titleExpanded ? 'Свернуть' : 'Показать полностью'}
          </Button>
        ) : null}
      </Box>
      <Tooltip title="Обновить карточку">
        <span>
          <IconButton onClick={onRefresh} disabled={loading} aria-label="Обновить карточку задания" sx={{ mt: -0.5 }}>
            {loading ? <CircularProgress size={20} /> : <RefreshOutlinedIcon />}
          </IconButton>
        </span>
      </Tooltip>
      <IconButton onClick={onClose} aria-label="Закрыть карточку задания" sx={{ mt: -0.5, mr: -0.5 }}>
        <CloseOutlinedIcon />
      </IconButton>
    </Stack>
  );
}

export function DocflowTaskDetails({
  task,
  mobile,
  loading = false,
  filesLoading = false,
  error = null,
  fileError = null,
  actionNotice = null,
  actionWorking = false,
  actionProgressLabel = '',
  commandState = null,
  onRetry,
  onRefresh,
  onPreviewFile,
  onDownloadFile,
  onAction,
  onCheckCommand,
  onClose,
}) {
  const open = Boolean(task);
  if (mobile) {
    return (
      <Drawer
        anchor="bottom"
        open={open}
        onClose={onClose}
        ModalProps={{ keepMounted: false }}
        PaperProps={{
          sx: {
            maxHeight: '94dvh',
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            overflow: 'hidden',
            overscrollBehavior: 'contain',
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        <Box sx={{ width: 42, height: 4, borderRadius: 999, bgcolor: 'divider', mx: 'auto', mt: 1, flexShrink: 0 }} />
        <DetailsHeader task={task} loading={loading} onRefresh={onRefresh} onClose={onClose} />
        <Divider sx={{ flexShrink: 0 }} />
        <Box sx={{ p: 2, flex: 1, minHeight: 0, overflowY: 'auto', pb: 2.5 }}>
          <TaskDetailsContent
            task={task}
            loading={loading}
            filesLoading={filesLoading}
            error={error}
            fileError={fileError}
            actionNotice={actionNotice}
            onRetry={onRetry}
            onPreviewFile={onPreviewFile}
            onDownloadFile={onDownloadFile}
          />
        </Box>
        <TaskActionBar
          task={task}
          working={actionWorking}
          progressLabel={actionProgressLabel}
          commandState={commandState}
          onAction={onAction}
          onCheckCommand={onCheckCommand}
        />
      </Drawer>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      PaperProps={{
        sx: {
          maxHeight: '92dvh',
          borderRadius: 3,
          overflow: 'hidden',
          overscrollBehavior: 'contain',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <DialogTitle component="div" sx={{ p: 0, flexShrink: 0 }}>
        <DetailsHeader task={task} loading={loading} onRefresh={onRefresh} onClose={onClose} />
      </DialogTitle>
      <Divider sx={{ flexShrink: 0 }} />
      <DialogContent
        sx={{
          py: 2.5,
          px: { sm: 3 },
          minWidth: 0,
          flex: 1,
          overflowY: 'auto',
        }}
      >
        <TaskDetailsContent
          task={task}
          loading={loading}
          filesLoading={filesLoading}
          error={error}
          fileError={fileError}
          actionNotice={actionNotice}
          onRetry={onRetry}
          onPreviewFile={onPreviewFile}
          onDownloadFile={onDownloadFile}
        />
      </DialogContent>
      <TaskActionBar
        task={task}
        working={actionWorking}
        progressLabel={actionProgressLabel}
        commandState={commandState}
        onAction={onAction}
        onCheckCommand={onCheckCommand}
      />
    </Dialog>
  );
}
