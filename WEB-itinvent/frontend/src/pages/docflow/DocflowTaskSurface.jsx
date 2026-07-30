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

function TaskStatusChips({ task }) {
  const processLabel = task?.process_type_label || task?.process_type;
  const importance = String(task?.importance || '').trim();
  const showImportance = importance && !importance.toLocaleLowerCase('ru-RU').includes('обычн');
  return (
    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
      <Chip
        size="small"
        color={task?.completed ? 'success' : 'primary'}
        label={task?.completed ? 'Завершено' : (task?.accepted ? 'Принято в работу' : 'Новое')}
      />
      {processLabel ? <Chip size="small" variant="outlined" label={processLabel} /> : null}
      {showImportance ? <Chip size="small" color="warning" variant="outlined" label={importance} /> : null}
    </Stack>
  );
}

export function DocflowTaskCard({ task, onOpen }) {
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
      sx={{ contentVisibility: 'auto', containIntrinsicSize: '0 112px' }}
    >
      <ListItemButton
        onClick={() => onOpen(task)}
        alignItems="flex-start"
        sx={{
          px: { xs: 1.5, sm: 2.5 },
          py: { xs: 1.5, sm: 1.8 },
          minHeight: 104,
          gap: { xs: 1, sm: 2 },
          transitionProperty: 'background-color',
          transitionDuration: '150ms',
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <Typography
              fontWeight={800}
              sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', lineHeight: 1.35, textWrap: 'pretty' }}
            >
              {task?.title || 'Задание 1С'}
            </Typography>
            <ChevronRightOutlinedIcon color="action" sx={{ flexShrink: 0, mt: 0.1 }} />
          </Stack>

          <Stack spacing={1.15} sx={{ mt: 1.15 }}>
            <TaskStatusChips task={task} />
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={{ xs: 0.75, sm: 2 }}
              alignItems={{ xs: 'flex-start', sm: 'center' }}
              useFlexGap
            >
              {task?.author ? (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.55, minWidth: 0 }}
                >
                  <PersonOutlineOutlinedIcon sx={{ fontSize: 16, flexShrink: 0 }} />
                  <Box component="span" sx={{ overflowWrap: 'anywhere' }}>{task.author}</Box>
                </Typography>
              ) : null}
              {dateValue ? (
                <Box
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.65,
                    px: 1,
                    py: 0.55,
                    borderRadius: 1.5,
                    bgcolor: overdue ? 'error.main' : 'action.hover',
                    color: overdue ? 'error.contrastText' : 'text.primary',
                  }}
                >
                  {task?.completed ? (
                    <CheckCircleOutlineOutlinedIcon sx={{ fontSize: 17 }} />
                  ) : (
                    <ScheduleOutlinedIcon sx={{ fontSize: 17 }} />
                  )}
                  <Typography variant="caption" fontWeight={750} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {dateLabel}: {dateValue}
                  </Typography>
                </Box>
              ) : null}
            </Stack>
          </Stack>
        </Box>
      </ListItemButton>
    </ListItem>
  );
}

function DetailValue({ label, children, icon: IconComponent, accent = false }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1,
        alignItems: 'flex-start',
        minWidth: 0,
        p: 1.25,
        borderRadius: 2,
        bgcolor: accent ? 'primary.main' : 'action.hover',
        color: accent ? 'primary.contrastText' : 'text.primary',
      }}
    >
      {IconComponent ? <IconComponent sx={{ fontSize: 19, mt: 0.15, flexShrink: 0, opacity: accent ? 0.9 : 0.72 }} /> : null}
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" sx={{ color: accent ? 'inherit' : 'text.secondary', opacity: accent ? 0.82 : 1 }}>
          {label}
        </Typography>
        <Typography
          variant="body2"
          fontWeight={650}
          sx={{ mt: 0.2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums' }}
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

function TaskActionBar({ task, working, commandState, onAction, onCheckCommand }) {
  const actions = Array.isArray(task?.available_actions) ? task.available_actions : [];
  const requiresDigitalSignature = Boolean(task?.requires_digital_signature);
  if (actions.length === 0 && !commandState && !requiresDigitalSignature) return null;
  return (
    <Stack
      spacing={1}
      sx={{
        px: 2,
        py: 1.5,
        pb: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
        bgcolor: 'background.paper',
      }}
    >
      {commandState?.status === 'state_unknown' || commandState?.status === 'pending' ? (
        <Alert
          severity="warning"
          action={(
            <Button color="inherit" size="small" disabled={working} onClick={onCheckCommand}>
              Проверить
            </Button>
          )}
        >
          Проверяем результат в 1С. Не нажимайте действие повторно.
          {commandState?.correlation_id ? (
            <Typography variant="caption" display="block">
              Код обращения: {commandState.correlation_id}
            </Typography>
          ) : null}
        </Alert>
      ) : null}
      {actions.length > 0 && commandState?.status !== 'state_unknown' && commandState?.status !== 'pending' ? (
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          {actions.map((action) => (
            <Button
              key={action.code}
              variant={action.code === 'reject' ? 'outlined' : 'contained'}
              color={action.tone || 'primary'}
              disabled={working}
              onClick={() => onAction?.(action)}
              sx={{ minHeight: 44, flex: { xs: '1 1 132px', sm: '0 0 auto' } }}
            >
              {action.label}
            </Button>
          ))}
        </Stack>
      ) : null}
      {requiresDigitalSignature && task?.open_in_1c_url ? (
        <Button
          component="a"
          href={task.open_in_1c_url}
          target="_blank"
          rel="noopener noreferrer"
          variant="contained"
          endIcon={<OpenInNewOutlinedIcon />}
          sx={{ minHeight: 44, alignSelf: { sm: 'flex-start' } }}
        >
          Выполнить в 1С
        </Button>
      ) : null}
    </Stack>
  );
}

function TaskDetailsContent({ task, loading, error, fileError, actionNotice, onRetry, onPreviewFile, onDownloadFile }) {
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
        <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 2.5, bgcolor: 'action.hover' }}>
          {loading ? (
            <Stack spacing={0.35} sx={{ mt: 0.5 }}>
              <Skeleton width="96%" />
              <Skeleton width="84%" />
              <Skeleton width="58%" />
            </Stack>
          ) : (
            <Typography
              variant="body2"
              sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.6, maxWidth: '70ch', textWrap: 'pretty' }}
            >
              {task?.description || 'Описание в 1С не указано.'}
            </Typography>
          )}
        </Paper>
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' },
          gap: 1,
        }}
      >
        <DetailValue label="Автор" icon={PersonOutlineOutlinedIcon}>{task?.author}</DetailValue>
        <DetailValue label="Поставлено" icon={CalendarTodayOutlinedIcon}>{created}</DetailValue>
        <DetailValue label="Срок исполнения" icon={ScheduleOutlinedIcon} accent={Boolean(due && !task?.completed)}>{due}</DetailValue>
        <DetailValue label="Выполнено" icon={CheckCircleOutlineOutlinedIcon}>{completed}</DetailValue>
        <DetailValue label="Результат" icon={CheckCircleOutlineOutlinedIcon}>{task?.result}</DetailValue>
      </Box>
      {relatedObjects.length > 0 ? (
        <Stack spacing={1}>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <DescriptionOutlinedIcon color="action" fontSize="small" />
            <Typography component="h3" fontWeight={800}>
              {relatedObjects.length === 1 ? 'Связанный документ' : 'Связанные документы'}
            </Typography>
          </Stack>
          {relatedObjects.map((item) => (
            <Paper key={item.ref} variant="outlined" sx={{ p: 1.5, borderRadius: 2.25, bgcolor: 'action.hover' }}>
              <Typography variant="body2" fontWeight={700} sx={{ overflowWrap: 'anywhere', textWrap: 'pretty' }}>
                {item.title}
              </Typography>
            </Paper>
          ))}
        </Stack>
      ) : null}
      <TaskFiles
        task={task}
        loading={loading}
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
  return (
    <Stack direction="row" spacing={1.25} alignItems="flex-start" sx={{ px: 2, pt: 1.5, pb: 1.25 }}>
      <Box sx={{ width: 38, height: 38, borderRadius: 2, bgcolor: 'primary.main', color: 'primary.contrastText', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <AssignmentTurnedInOutlinedIcon fontSize="small" />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.2, letterSpacing: '0.06em' }}>
          {task?.process_type_label || task?.process_type || 'Задание 1С'}
        </Typography>
        <Typography
          component="h2"
          fontWeight={800}
          sx={{ mt: 0.25, overflowWrap: 'anywhere', lineHeight: 1.3, textWrap: 'balance' }}
        >
          {task?.title || 'Задание 1С'}
        </Typography>
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
  error = null,
  fileError = null,
  actionNotice = null,
  actionWorking = false,
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
        <Box sx={{ width: 42, height: 4, borderRadius: 999, bgcolor: 'divider', mx: 'auto', mt: 1 }} />
        <DetailsHeader task={task} loading={loading} onRefresh={onRefresh} onClose={onClose} />
        <Divider />
        <Box sx={{ p: 2, overflowY: 'auto', minHeight: 0, pb: 2.5 }}>
          <TaskDetailsContent
            task={task}
            loading={loading}
            error={error}
            fileError={fileError}
            actionNotice={actionNotice}
            onRetry={onRetry}
            onPreviewFile={onPreviewFile}
            onDownloadFile={onDownloadFile}
          />
        </Box>
        <Divider />
        <TaskActionBar
          task={task}
          working={actionWorking}
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
      PaperProps={{ sx: { maxHeight: '92dvh', borderRadius: 3, overflow: 'hidden', overscrollBehavior: 'contain' } }}
    >
      <DialogTitle component="div" sx={{ p: 0 }}>
        <DetailsHeader task={task} loading={loading} onRefresh={onRefresh} onClose={onClose} />
      </DialogTitle>
      <Divider />
      <DialogContent sx={{ py: 2.5, px: { sm: 3 }, minWidth: 0 }}>
        <TaskDetailsContent
          task={task}
          loading={loading}
          error={error}
          fileError={fileError}
          actionNotice={actionNotice}
          onRetry={onRetry}
          onPreviewFile={onPreviewFile}
          onDownloadFile={onDownloadFile}
        />
      </DialogContent>
      <Divider />
      <TaskActionBar
        task={task}
        working={actionWorking}
        commandState={commandState}
        onAction={onAction}
        onCheckCommand={onCheckCommand}
      />
    </Dialog>
  );
}
