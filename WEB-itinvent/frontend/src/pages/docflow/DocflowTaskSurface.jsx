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
import ChevronRightOutlinedIcon from '@mui/icons-material/ChevronRightOutlined';
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import PersonOutlineOutlinedIcon from '@mui/icons-material/PersonOutlineOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';


export function formatDocflowDate(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
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
  return (
    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
      <Chip
        size="small"
        color={task?.completed ? 'success' : 'primary'}
        label={task?.completed ? 'Завершено' : (task?.accepted ? 'Принято в работу' : 'Новое')}
      />
      {task?.importance ? <Chip size="small" variant="outlined" label={task.importance} /> : null}
      {task?.business_state ? <Chip size="small" variant="outlined" label={task.business_state} /> : null}
    </Stack>
  );
}

export function DocflowTaskCard({ task, onOpen }) {
  const due = formatDocflowDate(task?.due_at);
  const created = formatDocflowDate(task?.created_at);

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
        sx={{ px: { xs: 1.5, sm: 2.5 }, py: { xs: 1.5, sm: 1.75 }, minHeight: 88 }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <Typography fontWeight={800} sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', lineHeight: 1.3 }}>
              {task?.title || 'Задание 1С'}
            </Typography>
            <ChevronRightOutlinedIcon color="action" sx={{ flexShrink: 0, mt: 0.1 }} />
          </Stack>

          <Stack spacing={0.9} sx={{ mt: 1 }}>
            <TaskStatusChips task={task} />
            <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap">
              {task?.number ? <Typography variant="caption">№ {task.number}</Typography> : null}
              {task?.author ? (
                <Typography variant="caption" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
                  <PersonOutlineOutlinedIcon sx={{ fontSize: 15 }} /> {task.author}
                </Typography>
              ) : null}
              {due ? (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
                  <ScheduleOutlinedIcon sx={{ fontSize: 15 }} /> До {due}
                </Typography>
              ) : null}
              {!due && created ? <Typography variant="caption">Создано {created}</Typography> : null}
            </Stack>
          </Stack>
        </Box>
      </ListItemButton>
    </ListItem>
  );
}

function DetailValue({ label, children }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ mt: 0.25, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {children}
      </Typography>
    </Box>
  );
}

function TaskFiles({ task, loading, error, onPreviewFile, onDownloadFile }) {
  const files = Array.isArray(task?.files) ? task.files : [];
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
        <List disablePadding sx={{ display: 'grid', gap: 0.75 }}>
          {files.map((file) => (
            <ListItem
              key={file.ref}
              disableGutters
              secondaryAction={(
                <Stack direction="row" spacing={0.25}>
                  {file.preview_supported ? (
                    <Tooltip title="Открыть предпросмотр">
                      <IconButton
                        onClick={() => onPreviewFile?.(task, file)}
                        aria-label={`Открыть предпросмотр ${file.name}`}
                        sx={{ minWidth: 42, minHeight: 42 }}
                      >
                        <VisibilityOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  ) : null}
                  <Tooltip title="Скачать оригинал">
                    <IconButton
                      onClick={() => onDownloadFile?.(task, file)}
                      aria-label={`Скачать ${file.name}`}
                      sx={{ minWidth: 42, minHeight: 42 }}
                    >
                      <DownloadOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              )}
              sx={{
                minHeight: 62,
                pl: 1.25,
                pr: file.preview_supported ? 10.5 : 6,
                border: 1,
                borderColor: 'divider',
                borderRadius: 2.25,
                bgcolor: 'background.paper',
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight={750} sx={{ overflowWrap: 'anywhere' }}>
                  {file.name || 'Файл 1С'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {[formatDocflowFileSize(file.size), formatDocflowDate(file.created_at)].filter(Boolean).join(' · ')}
                </Typography>
              </Box>
            </ListItem>
          ))}
        </List>
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
  if (actions.length === 0 && !commandState) return null;
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
    </Stack>
  );
}

function TaskDetailsContent({ task, loading, error, fileError, actionNotice, onRetry, onPreviewFile, onDownloadFile }) {
  return (
    <Stack spacing={2.25}>
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
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2.5, bgcolor: 'action.hover' }}>
        <Typography variant="caption" color="text.secondary">Полное описание</Typography>
        {loading ? (
          <Stack spacing={0.35} sx={{ mt: 0.5 }}>
            <Skeleton width="96%" />
            <Skeleton width="84%" />
            <Skeleton width="58%" />
          </Stack>
        ) : (
          <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.65 }}>
            {task?.description || 'Описание в 1С не указано.'}
          </Typography>
        )}
      </Paper>
      <Stack spacing={1.6}>
        <DetailValue label="Автор">{task?.author}</DetailValue>
        <DetailValue label="Номер">{task?.number}</DetailValue>
        <DetailValue label="Тип задания">{task?.task_type_label || task?.task_type}</DetailValue>
        <DetailValue label="Процесс">{task?.process_name}</DetailValue>
        <DetailValue label="Тип процесса">{task?.process_type_label || task?.process_type}</DetailValue>
        <DetailValue label="Дата постановки">{formatDocflowDate(task?.created_at)}</DetailValue>
        <DetailValue label="Срок исполнения">{formatDocflowDate(task?.due_at)}</DetailValue>
        <DetailValue label="Дата исполнения">{formatDocflowDate(task?.completed_at)}</DetailValue>
        <DetailValue label="Результат выполнения">{task?.result}</DetailValue>
      </Stack>
      {Array.isArray(task?.related_objects) && task.related_objects.length > 0 ? (
        <Stack spacing={1}>
          <Typography fontWeight={800}>Связанные документы и объекты</Typography>
          {task.related_objects.map((item) => (
            <Paper key={item.ref} variant="outlined" sx={{ p: 1.25, borderRadius: 2.25 }}>
              <Typography variant="body2" fontWeight={750} sx={{ overflowWrap: 'anywhere' }}>
                {item.title}
              </Typography>
              {item.object_type_label || item.object_type ? (
                <Typography variant="caption" color="text.secondary">
                  {item.object_type_label || item.object_type}
                </Typography>
              ) : null}
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
      <Alert severity="info" variant="outlined">
        Данные и файлы читаются напрямую через вашу сессию 1С. Доступ повторно проверяется при каждом открытии файла.
      </Alert>
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
        <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.2 }}>Задание 1С</Typography>
        <Typography fontWeight={850} sx={{ mt: 0.25, overflowWrap: 'anywhere', lineHeight: 1.3 }}>
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
            maxHeight: '88dvh',
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            overflow: 'hidden',
          },
        }}
      >
        <Box sx={{ width: 42, height: 4, borderRadius: 999, bgcolor: 'divider', mx: 'auto', mt: 1 }} />
        <DetailsHeader task={task} loading={loading} onRefresh={onRefresh} onClose={onClose} />
        <Divider />
        <Box sx={{ p: 2, overflowY: 'auto', pb: 'calc(env(safe-area-inset-bottom, 0px) + 20px)' }}>
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
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle component="div" sx={{ p: 0 }}>
        <DetailsHeader task={task} loading={loading} onRefresh={onRefresh} onClose={onClose} />
      </DialogTitle>
      <Divider />
      <DialogContent sx={{ pt: 2.5 }}>
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
