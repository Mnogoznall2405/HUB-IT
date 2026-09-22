import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  createFilterOptions,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  IconButton,
  ListItemText,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import AddPhotoAlternateOutlinedIcon from '@mui/icons-material/AddPhotoAlternateOutlined';
import AttachFileOutlinedIcon from '@mui/icons-material/AttachFileOutlined';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ChecklistRoundedIcon from '@mui/icons-material/ChecklistRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import FormatListBulletedRoundedIcon from '@mui/icons-material/FormatListBulletedRounded';
import FormatListNumberedRoundedIcon from '@mui/icons-material/FormatListNumberedRounded';
import MarkdownEditor from '../hub/MarkdownEditor';
import { hubAnnouncementsAPI } from '../../api/hubAnnouncements';
import { buildOfficeUiTokens, getOfficeDialogPaperSx } from '../../theme/officeUiTokens';
import FeedPostCard from './FeedPostCard';

const EMPTY_FORM = {
  title: '',
  preview: '',
  body: '',
  priority: 'normal',
  audience_scope: 'all',
  audience_roles: [],
  audience_user_ids: [],
  audience_department_codes: [],
  audience_cities: [],
  requires_ack: false,
  is_pinned: false,
  pinned_until: '',
  published_from: '',
  expires_at: '',
  is_active: true,
  comments_enabled: true,
  reactions_enabled: true,
  category_id: '',
  tags: '',
  notify_on_update: false,
  poll_enabled: false,
  poll_question: '',
  poll_options: ['', ''],
  poll_allows_multiple: false,
  poll_is_anonymous: false,
  poll_closes_at: '',
};

const AUDIENCE_OPTIONS = [
  { value: 'all', label: 'Все пользователи' },
  { value: 'roles', label: 'Выбранные роли' },
  { value: 'users', label: 'Конкретные пользователи' },
  { value: 'departments', label: 'Отделы и подразделения' },
  { value: 'cities', label: 'Города' },
  { value: 'departments_cities', label: 'Отделы в выбранных городах' },
];

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Информация' },
  { value: 'normal', label: 'Обычная новость' },
  { value: 'high', label: 'Важное сообщение' },
];

const filterAnywhereOptions = createFilterOptions({ matchFrom: 'any', ignoreCase: true, trim: true });
const filterUserOptions = createFilterOptions({
  matchFrom: 'any',
  ignoreCase: true,
  trim: true,
  stringify: (option) => [option?.full_name, option?.username].filter(Boolean).join(' '),
});

const parseTagsField = (value) => String(value || '')
  .split(',')
  .map((item) => item.trim().replace(/^#/, ''))
  .filter(Boolean);

const joinTagsField = (values) => [...new Set(
  (Array.isArray(values) ? values : []).flatMap((item) => parseTagsField(item)),
)].join(', ');

const renderCheckedOption = (getPrimary, getSecondary) => (props, option, { selected }) => {
  const { key, ...optionProps } = props;
  const secondary = getSecondary ? getSecondary(option) : '';
  return (
    <Box component="li" key={key} {...optionProps}>
      <Checkbox checked={selected} tabIndex={-1} disableRipple size="small" sx={{ p: 0.25, mr: 0.75, flexShrink: 0 }} />
      <ListItemText primary={getPrimary(option)} secondary={secondary || undefined} />
    </Box>
  );
};

const renderOptionChips = (getLabel) => (values, getTagProps) => values.map((option, index) => {
  const { key, ...tagProps } = getTagProps({ index });
  return <Chip key={key} {...tagProps} label={getLabel(option)} size="small" />;
});

const toLocalDateTime = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

const toIso = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const isImageAttachment = (attachment) => (
  String(attachment?.file_mime || '').toLowerCase().startsWith('image/')
  || /\.(?:avif|gif|jpe?g|png|webp)$/i.test(String(attachment?.file_name || ''))
);

const normalizePollOptions = (poll) => {
  const options = Array.isArray(poll?.options) ? poll.options.map((item) => String(item?.text || item || '')) : [];
  return [...options, '', ''].slice(0, Math.max(2, options.length));
};

const normalizeForm = (post) => post ? {
  title: post.title || '',
  preview: post.preview || '',
  body: post.body || '',
  priority: post.priority || 'normal',
  audience_scope: post.audience_scope || 'all',
  audience_roles: Array.isArray(post.audience_roles) ? post.audience_roles : [],
  audience_user_ids: Array.isArray(post.audience_user_ids) ? post.audience_user_ids.map(Number) : [],
  audience_department_codes: Array.isArray(post.audience_department_codes) ? post.audience_department_codes : [],
  audience_cities: Array.isArray(post.audience_cities) ? post.audience_cities : [],
  requires_ack: Boolean(post.requires_ack),
  is_pinned: Boolean(post.is_pinned),
  pinned_until: toLocalDateTime(post.pinned_until),
  published_from: toLocalDateTime(post.published_from),
  expires_at: toLocalDateTime(post.expires_at),
  is_active: post.is_active !== false,
  comments_enabled: post.comments_enabled !== false,
  reactions_enabled: post.reactions_enabled !== false,
  category_id: post.category?.id || post.category_id || '',
  tags: Array.isArray(post.tags) ? post.tags.map((item) => item.name || item.slug).filter(Boolean).join(', ') : '',
  notify_on_update: false,
  poll_enabled: Boolean(post.poll),
  poll_question: post.poll?.question || '',
  poll_options: normalizePollOptions(post.poll),
  poll_allows_multiple: Boolean(post.poll?.allows_multiple),
  poll_is_anonymous: Boolean(post.poll?.is_anonymous),
  poll_closes_at: toLocalDateTime(post.poll?.closes_at),
} : { ...EMPTY_FORM };

export default function FeedComposerDialog({
  open,
  post = null,
  recipients = { users: [], roles: [], departments: [], cities: [] },
  user = null,
  onClose,
  onSaved,
  notifyError,
}) {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const editing = Boolean(post?.id);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [coverFile, setCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState('');
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [draftId, setDraftId] = useState('');
  const [autosaveState, setAutosaveState] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [categories, setCategories] = useState([]);
  const [tagOptions, setTagOptions] = useState([]);
  const [existingAttachments, setExistingAttachments] = useState([]);
  const [coverAttachmentId, setCoverAttachmentId] = useState('');
  const [pendingDeleteAttachment, setPendingDeleteAttachment] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm(normalizeForm(post));
    setCoverFile(null);
    setCoverPreview('');
    setFiles([]);
    setSubmitted(false);
    setDraftId(post?.status === 'draft' ? String(post.id) : '');
    setAutosaveState('');
    setPreviewOpen(false);
    setExistingAttachments(Array.isArray(post?.attachments) ? post.attachments : []);
    setCoverAttachmentId(String(post?.cover_attachment?.id || ''));
  }, [open, post]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    hubAnnouncementsAPI.getCategories().then((payload) => {
      if (!cancelled) setCategories(Array.isArray(payload?.items) ? payload.items : []);
    }).catch(() => undefined);
    hubAnnouncementsAPI.getTags().then((payload) => {
      if (!cancelled) {
        const items = Array.isArray(payload?.items) ? payload.items : [];
        setTagOptions([...new Set(items.map((item) => item.name || item.slug).filter(Boolean))]);
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!coverFile) {
      setCoverPreview('');
      return undefined;
    }
    const url = URL.createObjectURL(coverFile);
    setCoverPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const titleInvalid = submitted && form.title.trim().length < 3;
  const audienceMissing = (
    (form.audience_scope === 'roles' && form.audience_roles.length === 0)
    || (form.audience_scope === 'users' && form.audience_user_ids.length === 0)
    || (form.audience_scope === 'departments' && form.audience_department_codes.length === 0)
    || (form.audience_scope === 'cities' && form.audience_cities.length === 0)
    || (form.audience_scope === 'departments_cities' && (
      form.audience_department_codes.length === 0 || form.audience_cities.length === 0
    ))
  );
  const audienceInvalid = submitted && audienceMissing;
  const publishedTime = form.published_from ? new Date(form.published_from).getTime() : null;
  const expiresTime = form.expires_at ? new Date(form.expires_at).getTime() : null;
  const hasDateError = expiresTime !== null && (
    expiresTime <= Date.now()
    || (publishedTime !== null && expiresTime <= publishedTime)
  );
  const datesInvalid = submitted && hasDateError;
  const pollOptions = form.poll_options.map((item) => String(item || '').trim()).filter(Boolean);
  const pollClosesTime = form.poll_closes_at ? new Date(form.poll_closes_at).getTime() : null;
  const hasPollError = Boolean(form.poll_enabled && (
    form.poll_question.trim().length < 3
    || pollOptions.length < 2
    || form.poll_options.some((item) => !String(item || '').trim())
    || new Set(pollOptions.map((item) => item.toLocaleLowerCase('ru-RU'))).size !== pollOptions.length
    || (pollClosesTime !== null && (pollClosesTime <= Date.now() || (publishedTime !== null && pollClosesTime <= publishedTime)))
  ));
  const selectedExistingCover = existingAttachments.find((attachment) => attachment.id === coverAttachmentId && isImageAttachment(attachment));
  const existingCoverUrl = post?.id && selectedExistingCover?.id
    ? hubAnnouncementsAPI.buildAttachmentUrl(post.id, selectedExistingCover.id)
    : '';
  const composerCoverUrl = coverPreview || existingCoverUrl;
  const audienceRoleOptions = form.audience_roles.map((value) => (
    (recipients.roles || []).find((item) => item.value === value) || { value, label: value }
  ));
  const audienceUserOptions = form.audience_user_ids.map((id) => (
    (recipients.users || []).find((item) => Number(item.id) === Number(id)) || { id, username: String(id) }
  ));
  const audienceDepartmentOptions = form.audience_department_codes.map((code) => (
    (recipients.departments || []).find((item) => item.code === code) || { code, name: code }
  ));
  const audienceCityOptions = form.audience_cities.map((value) => (
    (recipients.cities || []).find((item) => item.value === value) || { value, label: value }
  ));

  const buildPayload = useCallback((extra = {}) => ({
    title: form.title.trim(),
    preview: form.preview.trim(),
    body: form.body.trim(),
    priority: form.priority,
    audience_scope: form.audience_scope,
    audience_roles: form.audience_scope === 'roles' ? form.audience_roles : [],
    audience_user_ids: form.audience_scope === 'users' ? form.audience_user_ids.map(Number) : [],
    audience_department_codes: (
      form.audience_scope === 'departments' || form.audience_scope === 'departments_cities'
    ) ? form.audience_department_codes : [],
    audience_cities: (
      form.audience_scope === 'cities' || form.audience_scope === 'departments_cities'
    ) ? form.audience_cities : [],
    requires_ack: Boolean(form.requires_ack),
    is_pinned: Boolean(form.is_pinned),
    pinned_until: form.is_pinned ? toIso(form.pinned_until) : null,
    published_from: toIso(form.published_from),
    expires_at: toIso(form.expires_at),
    is_active: form.is_active !== false,
    comments_enabled: form.comments_enabled !== false,
    reactions_enabled: form.reactions_enabled !== false,
    category_id: form.category_id || null,
    tags: String(form.tags || '').split(',').map((item) => item.trim().replace(/^#/, '')).filter(Boolean),
    poll: form.poll_enabled ? {
      question: form.poll_question.trim(),
      options: form.poll_options.map((item) => String(item || '').trim()),
      allows_multiple: Boolean(form.poll_allows_multiple),
      is_anonymous: Boolean(form.poll_is_anonymous),
      closes_at: toIso(form.poll_closes_at),
    } : null,
    ...extra,
  }), [form]);

  useEffect(() => {
    if (!open || saving || (editing && post?.status !== 'draft')) return undefined;
    const timeoutId = window.setTimeout(async () => {
      setAutosaveState('saving');
      try {
        if (draftId) {
          await hubAnnouncementsAPI.updateAnnouncement(draftId, buildPayload({ status: 'draft', is_active: true }));
        } else {
          const draft = await hubAnnouncementsAPI.createDraft(buildPayload({ status: 'draft', is_active: true }));
          setDraftId(String(draft?.id || ''));
        }
        setAutosaveState('saved');
      } catch (error) {
        setAutosaveState('error');
      }
    }, 1500);
    return () => window.clearTimeout(timeoutId);
  }, [buildPayload, draftId, editing, open, post?.status, saving]);

  const selectCover = (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (!file) return;
    if (!String(file.type || '').startsWith('image/')) {
      notifyError?.(null, 'Для обложки выберите изображение.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      notifyError?.(null, 'Размер обложки не должен превышать 20 МБ.');
      return;
    }
    setCoverFile(file);
  };

  const selectFiles = (event) => {
    const selected = Array.from(event.target.files || []).filter((file) => file.size <= 20 * 1024 * 1024);
    event.target.value = '';
    setFiles(selected);
  };

  const moveExistingAttachment = (index, direction) => {
    setExistingAttachments((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const appendBodyTemplate = (template) => {
    setField('body', `${form.body.trimEnd()}${form.body.trim() ? '\n\n' : ''}${template}`);
  };

  const updatePollOption = (index, value) => {
    setForm((current) => ({
      ...current,
      poll_options: current.poll_options.map((item, optionIndex) => (optionIndex === index ? value : item)),
    }));
  };

  const addPollOption = () => {
    setForm((current) => (current.poll_options.length >= 10 ? current : { ...current, poll_options: [...current.poll_options, ''] }));
  };

  const removePollOption = (index) => {
    setForm((current) => (current.poll_options.length <= 2 ? current : {
      ...current,
      poll_options: current.poll_options.filter((_, optionIndex) => optionIndex !== index),
    }));
  };

  const removeExistingAttachment = (attachment) => {
    if (!post?.id || !attachment?.id) return;
    setPendingDeleteAttachment(attachment);
  };

  const confirmRemoveExistingAttachment = async () => {
    const attachment = pendingDeleteAttachment;
    if (!post?.id || !attachment?.id) return;
    setPendingDeleteAttachment(null);
    try {
      await hubAnnouncementsAPI.deleteAttachment(post.id, attachment.id);
      setExistingAttachments((current) => current.filter((item) => item.id !== attachment.id));
      if (coverAttachmentId === attachment.id) setCoverAttachmentId('');
    } catch (error) {
      notifyError?.(error, 'Не удалось удалить вложение.');
    }
  };

  const submit = async () => {
    setSubmitted(true);
    if (form.title.trim().length < 3 || audienceMissing || hasDateError || hasPollError || saving) return;
    setSaving(true);
    const payload = buildPayload({ notify_on_update: Boolean(form.notify_on_update) });
    try {
      const managedId = draftId || (editing ? String(post.id) : '');
      let saved;
      if (managedId) {
        saved = await hubAnnouncementsAPI.updateAnnouncement(managedId, payload);
        const uploaded = [];
        for (const file of [coverFile, ...files].filter(Boolean)) {
          uploaded.push(await hubAnnouncementsAPI.uploadAttachment(managedId, file));
        }
        const attachmentIds = [...existingAttachments.map((item) => item.id), ...uploaded.map((item) => item.id)].filter(Boolean);
        const selectedCover = coverFile ? uploaded[0]?.id : coverAttachmentId;
        if (attachmentIds.length) await hubAnnouncementsAPI.reorderAttachments(managedId, attachmentIds, selectedCover);
        if (post?.status === 'published') {
          saved = await hubAnnouncementsAPI.getAnnouncement(managedId);
        } else {
          saved = await hubAnnouncementsAPI.publishAnnouncement(managedId);
        }
      } else {
        saved = await hubAnnouncementsAPI.createAnnouncement(payload, [coverFile, ...files].filter(Boolean));
      }
      onSaved?.(saved, { editing });
    } catch (error) {
      notifyError?.(error, editing ? 'Не удалось сохранить публикацию.' : 'Не удалось опубликовать запись.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      fullScreen={mobile}
      fullWidth
      maxWidth="md"
      PaperProps={{ sx: getOfficeDialogPaperSx(ui) }}
    >
      <DialogTitle sx={{ position: { xs: 'sticky', sm: 'relative' }, top: 0, zIndex: 3, pr: 7, bgcolor: ui.panelSolid, borderBottom: { xs: '1px solid', sm: 0 }, borderColor: ui.borderSoft }}>
        <Typography component="div" variant="h6" sx={{ fontWeight: 800 }}>
          {editing ? 'Редактировать публикацию' : 'Новая публикация'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Новость появится в общей ленте и в уведомлениях выбранной аудитории.
        </Typography>
        {autosaveState ? (
          <Typography role="status" variant="caption" color={autosaveState === 'error' ? 'error.main' : 'text.secondary'}>
            {autosaveState === 'saving' ? 'Сохранение черновика…' : autosaveState === 'saved' ? 'Черновик сохранён' : 'Не удалось сохранить черновик'}
          </Typography>
        ) : null}
        <IconButton aria-label="Закрыть форму публикации" onClick={onClose} disabled={saving} sx={{ position: 'absolute', top: 8, right: 8 }}>
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ px: { xs: 2, sm: 3 }, py: 2.5 }}>
        <Stack spacing={2}>
          <Typography component="h2" sx={{ fontSize: '0.86rem', fontWeight: 800, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Основное</Typography>
          <TextField
            autoFocus
            label="Заголовок"
            value={form.title}
            onChange={(event) => setField('title', event.target.value)}
            required
            fullWidth
            error={titleInvalid}
            placeholder="Например: переезд офиса в новое здание"
            helperText={titleInvalid ? 'Введите заголовок длиной не менее 3 символов.' : 'Коротко сформулируйте главную новость.'}
            inputProps={{ maxLength: 240 }}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            label="Краткое описание"
            value={form.preview}
            onChange={(event) => setField('preview', event.target.value)}
            fullWidth
            multiline
            minRows={2}
            placeholder="Одно-два предложения для карточки в ленте"
            inputProps={{ maxLength: 800 }}
            helperText="Этот текст виден в свёрнутой карточке. Если оставить поле пустым, будет использовано начало публикации."
            InputLabelProps={{ shrink: true }}
          />
          <Box>
            <Typography sx={{ mb: 0.75, fontWeight: 800 }}>Структура текста</Typography>
            <Stack direction="row" spacing={0.75} sx={{ overflowX: 'auto', pb: 0.5, scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
              <Button variant="outlined" startIcon={<FormatListBulletedRoundedIcon />} onClick={() => appendBodyTemplate('- Первый пункт\n- Второй пункт\n- Третий пункт')} sx={{ flexShrink: 0, minHeight: 44, borderRadius: '10px', textTransform: 'none' }}>Список</Button>
              <Button variant="outlined" startIcon={<FormatListNumberedRoundedIcon />} onClick={() => appendBodyTemplate('1. Первый шаг\n2. Второй шаг\n3. Третий шаг')} sx={{ flexShrink: 0, minHeight: 44, borderRadius: '10px', textTransform: 'none' }}>Шаги</Button>
              <Button variant="outlined" startIcon={<ChecklistRoundedIcon />} onClick={() => appendBodyTemplate('- [ ] Задача\n- [ ] Ещё одна задача')} sx={{ flexShrink: 0, minHeight: 44, borderRadius: '10px', textTransform: 'none' }}>Чек-лист</Button>
            </Stack>
          </Box>
          <MarkdownEditor
            label="Полный текст"
            value={form.body}
            onChange={(value) => setField('body', value)}
            minRows={10}
            placeholder="Расскажите подробнее: что произошло, для кого это важно и что нужно сделать."
            visualVariant="taskDialog"
            inputLabelProps={{ shrink: true }}
          />

          <Box sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: '14px', bgcolor: ui.panelBg, boxShadow: `inset 0 0 0 1px ${ui.borderSoft}` }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontWeight: 800 }}>Опрос</Typography>
                <Typography variant="body2" color="text.secondary">Соберите мнение сотрудников прямо в ленте.</Typography>
              </Box>
              <Switch inputProps={{ 'aria-label': 'Добавить опрос' }} checked={form.poll_enabled} onChange={(event) => setField('poll_enabled', event.target.checked)} />
            </Stack>
            {form.poll_enabled ? (
              <Stack spacing={1.25} sx={{ mt: 1.5 }}>
                <TextField fullWidth label="Вопрос" value={form.poll_question} onChange={(event) => setField('poll_question', event.target.value)} error={submitted && form.poll_question.trim().length < 3} placeholder="Что хотите узнать у коллег?" inputProps={{ maxLength: 300 }} InputLabelProps={{ shrink: true }} />
                <Stack spacing={0.75}>
                  {form.poll_options.map((option, index) => (
                    <Stack key={index} direction="row" spacing={0.75} alignItems="center">
                      <TextField fullWidth label={`Вариант ${index + 1}`} value={option} onChange={(event) => updatePollOption(index, event.target.value)} error={submitted && !String(option || '').trim()} placeholder="Текст варианта" inputProps={{ maxLength: 160 }} InputLabelProps={{ shrink: true }} />
                      <IconButton aria-label={`Удалить вариант ${index + 1}`} disabled={form.poll_options.length <= 2} onClick={() => removePollOption(index)} sx={{ width: 44, height: 44, flexShrink: 0 }}><DeleteOutlineRoundedIcon /></IconButton>
                    </Stack>
                  ))}
                </Stack>
                <Button startIcon={<AddRoundedIcon />} onClick={addPollOption} disabled={form.poll_options.length >= 10} sx={{ alignSelf: 'flex-start', minHeight: 44, borderRadius: '10px', textTransform: 'none' }}>Добавить вариант</Button>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.5} useFlexGap flexWrap="wrap">
                  <FormControlLabel control={<Switch checked={form.poll_allows_multiple} onChange={(event) => setField('poll_allows_multiple', event.target.checked)} />} label="Несколько вариантов" />
                  <FormControlLabel control={<Switch checked={form.poll_is_anonymous} onChange={(event) => setField('poll_is_anonymous', event.target.checked)} />} label="Анонимный опрос" />
                </Stack>
                <TextField fullWidth label="Завершить опрос" type="datetime-local" value={form.poll_closes_at} onChange={(event) => setField('poll_closes_at', event.target.value)} InputLabelProps={{ shrink: true }} />
                {submitted && hasPollError ? <Typography role="alert" color="error.main" variant="body2">Заполните вопрос и 2–10 уникальных вариантов. Дата завершения должна быть позже публикации.</Typography> : null}
              </Stack>
            ) : null}
          </Box>

          <Stack spacing={1}>
            <Typography sx={{ fontWeight: 800 }}>Изображения и файлы</Typography>
            {composerCoverUrl ? <Box component="img" src={composerCoverUrl} alt="Предварительный просмотр обложки" sx={{ width: '100%', maxHeight: 360, aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: '14px' }} /> : null}
            {existingAttachments.length ? (
              <Stack spacing={0.75}>
                {existingAttachments.map((attachment, index) => (
                  <Stack key={attachment.id} direction="row" alignItems="center" spacing={0.75} useFlexGap flexWrap={{ xs: 'wrap', sm: 'nowrap' }} sx={{ minHeight: 44, p: 1, borderRadius: '10px', bgcolor: ui.panelBg }}>
                    <Typography noWrap sx={{ flex: 1, flexBasis: { xs: '100%', sm: 'auto' }, fontSize: '0.88rem' }}>{attachment.file_name}</Typography>
                    {isImageAttachment(attachment) ? <Button size="small" aria-pressed={coverAttachmentId === attachment.id} onClick={() => setCoverAttachmentId(attachment.id)} sx={{ textTransform: 'none' }}>{coverAttachmentId === attachment.id ? 'Обложка' : 'Сделать обложкой'}</Button> : null}
                    <IconButton aria-label="Переместить выше" disabled={index === 0} onClick={() => moveExistingAttachment(index, -1)}><Typography aria-hidden>↑</Typography></IconButton>
                    <IconButton aria-label="Переместить ниже" disabled={index === existingAttachments.length - 1} onClick={() => moveExistingAttachment(index, 1)}><Typography aria-hidden>↓</Typography></IconButton>
                    <IconButton aria-label={`Удалить ${attachment.file_name}`} onClick={() => removeExistingAttachment(attachment)}><CloseRoundedIcon /></IconButton>
                  </Stack>
                ))}
              </Stack>
            ) : null}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button component="label" variant="outlined" startIcon={<AddPhotoAlternateOutlinedIcon />}>
                {coverFile ? 'Заменить новую обложку' : 'Добавить обложку'}
                <input hidden type="file" accept="image/*" onChange={selectCover} />
              </Button>
              {coverFile ? <Button color="inherit" onClick={() => setCoverFile(null)}>Убрать новую обложку</Button> : null}
              <Button component="label" variant="outlined" startIcon={<AttachFileOutlinedIcon />}>Добавить файлы<input hidden type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.txt,.zip" onChange={selectFiles} /></Button>
            </Stack>
            {files.length ? <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">{files.map((file) => <Chip key={`${file.name}-${file.size}`} label={file.name} onDelete={() => setFiles((current) => current.filter((item) => item !== file))} />)}</Stack> : null}
          </Stack>

          <Accordion disableGutters elevation={0} sx={{ border: '1px solid', borderColor: ui.borderSoft, borderRadius: '14px !important', '&::before': { display: 'none' } }}>
            <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
              <Box>
                <Typography sx={{ fontWeight: 800 }}>Аудитория и параметры публикации</Typography>
                <Typography variant="caption" color="text.secondary">По умолчанию публикацию увидят все пользователи.</Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              <Grid container spacing={1.5}>
                <Grid item xs={12} md={6}>
                  <Autocomplete
                    options={AUDIENCE_OPTIONS}
                    value={AUDIENCE_OPTIONS.find((option) => option.value === form.audience_scope) || AUDIENCE_OPTIONS[0]}
                    onChange={(_event, option) => { if (option) setField('audience_scope', option.value); }}
                    getOptionLabel={(option) => option.label}
                    isOptionEqualToValue={(option, optionValue) => option.value === optionValue.value}
                    filterOptions={filterAnywhereOptions}
                    autoHighlight
                    disableClearable
                    noOptionsText="Ничего не найдено"
                    renderInput={(params) => (
                      <TextField {...params} label="Аудитория" placeholder="Поиск варианта…" error={audienceInvalid} InputLabelProps={{ shrink: true }} />
                    )}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <Autocomplete
                    options={categories}
                    value={categories.find((category) => String(category.id) === String(form.category_id)) || null}
                    onChange={(_event, option) => setField('category_id', option?.id || '')}
                    getOptionLabel={(option) => option.name || ''}
                    isOptionEqualToValue={(option, optionValue) => String(option.id) === String(optionValue.id)}
                    filterOptions={filterAnywhereOptions}
                    autoHighlight
                    noOptionsText="Категория не найдена"
                    renderInput={(params) => (
                      <TextField {...params} label="Категория" placeholder="Без категории" InputLabelProps={{ shrink: true }} />
                    )}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <Autocomplete
                    multiple
                    freeSolo
                    options={tagOptions}
                    value={parseTagsField(form.tags)}
                    onChange={(_event, values) => setField('tags', joinTagsField(values))}
                    filterOptions={filterAnywhereOptions}
                    autoHighlight
                    noOptionsText="Совпадений нет — Enter добавит новый тег"
                    renderTags={renderOptionChips((option) => option)}
                    renderInput={(params) => (
                      <TextField {...params} label="Теги" placeholder="офис, инструкция, безопасность" helperText="Выберите из списка или введите свой и нажмите Enter." InputLabelProps={{ shrink: true }} />
                    )}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <Autocomplete
                    options={PRIORITY_OPTIONS}
                    value={PRIORITY_OPTIONS.find((option) => option.value === form.priority) || PRIORITY_OPTIONS[1]}
                    onChange={(_event, option) => { if (option) setField('priority', option.value); }}
                    getOptionLabel={(option) => option.label}
                    isOptionEqualToValue={(option, optionValue) => option.value === optionValue.value}
                    filterOptions={filterAnywhereOptions}
                    autoHighlight
                    disableClearable
                    noOptionsText="Ничего не найдено"
                    renderInput={(params) => (
                      <TextField {...params} label="Тип сообщения" placeholder="Поиск типа…" InputLabelProps={{ shrink: true }} />
                    )}
                  />
                </Grid>
                {form.audience_scope === 'roles' ? (
                  <Grid item xs={12}>
                    <Autocomplete
                      multiple
                      disableCloseOnSelect
                      options={recipients.roles || []}
                      value={audienceRoleOptions}
                      onChange={(_event, options) => setField('audience_roles', options.map((option) => option.value))}
                      getOptionLabel={(option) => option.label || String(option.value || '')}
                      isOptionEqualToValue={(option, optionValue) => option.value === optionValue.value}
                      filterOptions={filterAnywhereOptions}
                      autoHighlight
                      noOptionsText="Ничего не найдено"
                      renderOption={renderCheckedOption((option) => option.label)}
                      renderTags={renderOptionChips((option) => option.label)}
                      renderInput={(params) => (
                        <TextField {...params} label="Роли" placeholder="Поиск роли…" error={audienceInvalid} helperText={audienceInvalid ? 'Выберите хотя бы одну роль.' : ''} InputLabelProps={{ shrink: true }} />
                      )}
                    />
                  </Grid>
                ) : null}
                {form.audience_scope === 'users' ? (
                  <Grid item xs={12}>
                    <Autocomplete
                      multiple
                      disableCloseOnSelect
                      options={recipients.users || []}
                      value={audienceUserOptions}
                      onChange={(_event, options) => setField('audience_user_ids', options.map((option) => Number(option.id)))}
                      getOptionLabel={(option) => option.full_name || option.username || String(option.id || '')}
                      isOptionEqualToValue={(option, optionValue) => Number(option.id) === Number(optionValue.id)}
                      filterOptions={filterUserOptions}
                      autoHighlight
                      noOptionsText="Ничего не найдено"
                      renderOption={renderCheckedOption((option) => option.full_name || option.username, (option) => option.username)}
                      renderTags={renderOptionChips((option) => option.full_name || option.username)}
                      renderInput={(params) => (
                        <TextField {...params} label="Пользователи" placeholder="Поиск сотрудника…" error={audienceInvalid} helperText={audienceInvalid ? 'Выберите хотя бы одного пользователя.' : ''} InputLabelProps={{ shrink: true }} />
                      )}
                    />
                  </Grid>
                ) : null}
                {form.audience_scope === 'departments' || form.audience_scope === 'departments_cities' ? (
                  <Grid item xs={12}>
                    <Autocomplete
                      multiple
                      disableCloseOnSelect
                      options={recipients.departments || []}
                      value={audienceDepartmentOptions}
                      onChange={(_event, options) => setField('audience_department_codes', options.map((option) => option.code))}
                      getOptionLabel={(option) => option.name || String(option.code || '')}
                      isOptionEqualToValue={(option, optionValue) => option.code === optionValue.code}
                      filterOptions={filterAnywhereOptions}
                      autoHighlight
                      noOptionsText="Ничего не найдено"
                      renderOption={renderCheckedOption((option) => option.name)}
                      renderTags={renderOptionChips((option) => option.name)}
                      renderInput={(params) => (
                        <TextField {...params} label="Отделы" placeholder="Поиск отдела…" error={audienceInvalid} helperText={audienceInvalid ? 'Выберите хотя бы один отдел.' : ''} InputLabelProps={{ shrink: true }} />
                      )}
                    />
                  </Grid>
                ) : null}
                {form.audience_scope === 'cities' || form.audience_scope === 'departments_cities' ? (
                  <Grid item xs={12}>
                    <Autocomplete
                      multiple
                      disableCloseOnSelect
                      options={recipients.cities || []}
                      value={audienceCityOptions}
                      onChange={(_event, options) => setField('audience_cities', options.map((option) => option.value))}
                      getOptionLabel={(option) => option.label || String(option.value || '')}
                      isOptionEqualToValue={(option, optionValue) => option.value === optionValue.value}
                      filterOptions={filterAnywhereOptions}
                      autoHighlight
                      noOptionsText="Ничего не найдено"
                      renderOption={renderCheckedOption((option) => option.label)}
                      renderTags={renderOptionChips((option) => option.label)}
                      renderInput={(params) => (
                        <TextField {...params} label="Города" placeholder="Поиск города…" error={audienceInvalid} helperText={audienceInvalid ? 'Выберите хотя бы один город.' : ''} InputLabelProps={{ shrink: true }} />
                      )}
                    />
                  </Grid>
                ) : null}
                <Grid item xs={12} md={4}>
                  <TextField fullWidth label="Опубликовать с" type="datetime-local" value={form.published_from} onChange={(event) => setField('published_from', event.target.value)} InputLabelProps={{ shrink: true }} />
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField fullWidth label="Закрепить до" type="datetime-local" value={form.pinned_until} onChange={(event) => setField('pinned_until', event.target.value)} disabled={!form.is_pinned} InputLabelProps={{ shrink: true }} />
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField fullWidth label="Скрыть после" type="datetime-local" value={form.expires_at} onChange={(event) => setField('expires_at', event.target.value)} error={datesInvalid} helperText={datesInvalid ? 'Дата скрытия должна быть позже публикации и текущего времени.' : ''} InputLabelProps={{ shrink: true }} />
                </Grid>
                <Grid item xs={12}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} useFlexGap flexWrap="wrap">
                    <FormControlLabel control={<Switch checked={form.requires_ack} onChange={(event) => setField('requires_ack', event.target.checked)} />} label="Требовать подтверждение ознакомления" />
                    <FormControlLabel control={<Switch checked={form.is_pinned} onChange={(event) => setField('is_pinned', event.target.checked)} />} label="Закрепить вверху" />
                    <FormControlLabel control={<Switch checked={form.is_active} onChange={(event) => setField('is_active', event.target.checked)} />} label="Показывать в ленте" />
                    <FormControlLabel control={<Switch checked={form.comments_enabled} onChange={(event) => setField('comments_enabled', event.target.checked)} />} label="Разрешить комментарии" />
                    <FormControlLabel control={<Switch checked={form.reactions_enabled} onChange={(event) => setField('reactions_enabled', event.target.checked)} />} label="Разрешить реакции" />
                  </Stack>
                </Grid>
                {post?.status === 'published' ? <Grid item xs={12}><FormControlLabel control={<Switch checked={form.notify_on_update} onChange={(event) => setField('notify_on_update', event.target.checked)} />} label="Уведомить аудиторию об изменениях" /></Grid> : null}
              </Grid>
            </AccordionDetails>
          </Accordion>

          <Button variant="outlined" onClick={() => setPreviewOpen((current) => !current)} sx={{ alignSelf: 'flex-start', minHeight: 44, textTransform: 'none' }}>
            {previewOpen ? 'Скрыть предпросмотр' : 'Показать предпросмотр'}
          </Button>
          {previewOpen ? (
            <Box aria-label="Предпросмотр публикации" sx={{ maxWidth: 640, width: '100%', mx: 'auto' }}>
              <FeedPostCard
                post={{
                  id: 'preview',
                  ...buildPayload(),
                  author_full_name: 'Предпросмотр',
                  author_username: user?.username || 'author',
                  published_at: new Date().toISOString(),
                  category: categories.find((item) => item.id === form.category_id) || null,
                  tags: buildPayload().tags.map((name) => ({ id: name, name })),
                  comments_count: 0,
                  reaction_counts: {},
                  attachments: [],
                  poll: buildPayload().poll ? {
                    ...buildPayload().poll,
                    id: 'preview-poll',
                    options: buildPayload().poll.options.filter(Boolean).map((text, index) => ({ id: `preview-option-${index}`, text, votes_count: 0 })),
                    viewer_option_ids: [],
                    total_votes: 0,
                    total_voters: 0,
                    has_voted: false,
                    is_closed: false,
                  } : null,
                }}
                coverUrl={composerCoverUrl}
                initialExpanded
                buildAttachmentUrl={hubAnnouncementsAPI.buildAttachmentUrl}
              />
            </Box>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ position: { xs: 'sticky', sm: 'static' }, bottom: 0, zIndex: 3, px: { xs: 2, sm: 3 }, py: 1.5, pb: { xs: 'max(12px, env(safe-area-inset-bottom))', sm: 1.5 }, bgcolor: ui.panelSolid, borderTop: '1px solid', borderColor: ui.borderSoft }}>
        <Button color="inherit" onClick={onClose} disabled={saving}>Отмена</Button>
        <Button variant="contained" onClick={submit} disabled={saving} startIcon={saving ? <CircularProgress size={18} color="inherit" /> : null}>
          {editing ? 'Сохранить' : 'Опубликовать'}
        </Button>
      </DialogActions>
      <Dialog open={Boolean(pendingDeleteAttachment)} onClose={() => setPendingDeleteAttachment(null)} fullWidth maxWidth="xs">
        <DialogTitle>Удалить файл?</DialogTitle>
        <DialogContent dividers>
          <Typography>{`Файл «${pendingDeleteAttachment?.file_name || ''}» будет удалён из публикации.`}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingDeleteAttachment(null)}>Отмена</Button>
          <Button variant="contained" color="error" onClick={() => void confirmRemoveExistingAttachment()} sx={{ textTransform: 'none' }}>
            Удалить файл
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
