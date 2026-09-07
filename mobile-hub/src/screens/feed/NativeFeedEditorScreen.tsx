import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useLocalSearchParams } from 'expo-router';
import { useUnsavedFormGuard } from '../../navigation/useUnsavedFormGuard';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  archiveFeedPost,
  createFeedDraft,
  createFeedPost,
  deleteFeedAttachment,
  getFeedPost,
  getFeedRecipients,
  listFeedCategories,
  listFeedTags,
  publishFeedPost,
  reorderFeedAttachments,
  transformFeedMarkdown,
  updateFeedPost,
  uploadFeedAttachment,
  type FeedEditorPayload,
  type FeedCategory,
  type FeedTag,
  type FeedRecipientRole,
  type FeedRecipientUser,
  type FeedUploadFile,
} from '../../api/feedApi';
import { formatApiError } from '../../api/formatError';
import { useAuth } from '../../auth/AuthContext';
import {
  isImageAttachment,
  type FeedAttachment,
  type FeedPost,
} from '../../feed/feedFormat';
import {
  feedDateTimeInputValue,
  feedDateTimeToIso,
  filterFeedRecipients,
  validateFeedEditorDates,
  validateFeedPoll,
} from '../../feed/feedEditorModel';
import { pickNativeFeedFiles } from '../../feed/nativeFeedFiles';
import { FeedMarkdownText } from '../../feed/FeedMarkdownText';
import { createFeedClientRequestId } from '../../feed/feedRequestId';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import {
  AccountLoading,
  AccountPrimaryButton,
  AccountScreenScaffold,
  AccountSecondaryButton,
  AccountSectionCard,
  AccountStatusText,
} from '../account/AccountChrome';
import { goBackOrReplace } from '../account/accountBack';

const PRIORITIES = [
  { value: 'low', label: 'Информация' },
  { value: 'normal', label: 'Обычная' },
  { value: 'high', label: 'Важная' },
] as const;

const AUDIENCE_SCOPES = [
  { value: 'all', label: 'Все сотрудники' },
  { value: 'roles', label: 'По ролям' },
  { value: 'users', label: 'Выбранные сотрудники' },
] as const;

const RECIPIENT_SEARCH_DELAY_MS = 300;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

function existingAttachmentKey(attachmentId: string): string {
  return `existing:${attachmentId}`;
}

function newAttachmentKey(uri: string): string {
  return `new:${uri}`;
}

type AttachmentEditorItem =
  | { key: string; attachment: FeedAttachment; file?: never }
  | { key: string; file: FeedUploadFile; attachment?: never };

function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function recipientName(user: FeedRecipientUser): string {
  return user.full_name || user.username || `Сотрудник #${user.id}`;
}

function uploadIsImage(file: FeedUploadFile): boolean {
  return isImageAttachment({ file_name: file.name, file_mime: file.mimeType });
}

function booleanOption({
  label,
  value,
  onPress,
  disabled,
  testID,
  tokens,
}: {
  label: string;
  value: boolean;
  onPress: () => void;
  disabled: boolean;
  testID: string;
  tokens: ReturnType<typeof useFluentTokens>;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value, disabled }}
      style={[styles.optionRow, { borderColor: tokens.borderSoft, opacity: disabled ? 0.55 : 1 }]}
    >
      <MaterialCommunityIcons name={value ? 'checkbox-marked' : 'checkbox-blank-outline'} size={22} color={value ? tokens.primary : tokens.iconMuted} />
      <Text style={[styles.optionLabel, { color: tokens.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

function AttachmentEditorRow({
  name,
  image,
  cover,
  disabled,
  onCover,
  onMoveUp,
  onMoveDown,
  onRemove,
  tokens,
}: {
  name: string;
  image: boolean;
  cover: boolean;
  disabled: boolean;
  onCover?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove: () => void;
  tokens: ReturnType<typeof useFluentTokens>;
}) {
  return (
    <View style={[styles.attachmentRow, { borderColor: tokens.borderSoft }]}>
      <MaterialCommunityIcons name={image ? 'file-image-outline' : 'file-outline'} size={20} color={tokens.primary} />
      <Text numberOfLines={2} style={[styles.attachmentName, { color: tokens.textPrimary }]}>{name}</Text>
      {image && onCover ? (
        <Pressable
          accessibilityRole="radio"
          accessibilityLabel={`Сделать файл ${name} обложкой`}
          accessibilityState={{ selected: cover, disabled }}
          disabled={disabled}
          onPress={onCover}
          style={[styles.attachmentAction, { backgroundColor: cover ? tokens.accentSoft : 'transparent' }]}
        >
          <MaterialCommunityIcons name={cover ? 'image-check' : 'image-outline'} size={19} color={cover ? tokens.primary : tokens.textSecondary} />
        </Pressable>
      ) : null}
      {onMoveUp ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Поднять файл ${name}`} disabled={disabled} onPress={onMoveUp} style={styles.attachmentAction}>
          <MaterialCommunityIcons name="arrow-up" size={19} color={tokens.textSecondary} />
        </Pressable>
      ) : null}
      {onMoveDown ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Опустить файл ${name}`} disabled={disabled} onPress={onMoveDown} style={styles.attachmentAction}>
          <MaterialCommunityIcons name="arrow-down" size={19} color={tokens.textSecondary} />
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`Удалить файл ${name}`} disabled={disabled} onPress={onRemove} style={styles.attachmentAction}>
        <MaterialCommunityIcons name="delete-outline" size={19} color={tokens.error} />
      </Pressable>
    </View>
  );
}

export function NativeFeedEditorScreen() {
  const params = useLocalSearchParams<{ postId?: string | string[] }>();
  const postId = String(Array.isArray(params.postId) ? params.postId[0] : params.postId || '').trim();
  const { hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const canWrite = hasPermission('announcements.write');
  const canModerate = hasPermission('announcements.moderate');
  const canEdit = canWrite || (Boolean(postId) && canModerate);
  const [source, setSource] = useState<FeedPost | null>(null);
  const [loading, setLoading] = useState(Boolean(postId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [title, setTitle] = useState('');
  const [preview, setPreview] = useState('');
  const [body, setBody] = useState('');
  const [bodyPreview, setBodyPreview] = useState(false);
  const [transformingBody, setTransformingBody] = useState(false);
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [requiresAck, setRequiresAck] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [reactionsEnabled, setReactionsEnabled] = useState(true);
  const [tagsText, setTagsText] = useState('');
  const [categories, setCategories] = useState<FeedCategory[]>([]);
  const [knownTags, setKnownTags] = useState<FeedTag[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [notifyOnUpdate, setNotifyOnUpdate] = useState(false);
  const [audienceScope, setAudienceScope] = useState<'all' | 'roles' | 'users'>('all');
  const [audienceRoles, setAudienceRoles] = useState<string[]>([]);
  const [audienceUserIds, setAudienceUserIds] = useState<number[]>([]);
  const [recipientUsers, setRecipientUsers] = useState<FeedRecipientUser[]>([]);
  const [recipientRoles, setRecipientRoles] = useState<FeedRecipientRole[]>([]);
  const [recipientQuery, setRecipientQuery] = useState('');
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [recipientsError, setRecipientsError] = useState('');
  const [publishedFrom, setPublishedFrom] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [pinnedUntil, setPinnedUntil] = useState('');
  const [pollEnabled, setPollEnabled] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [pollAllowsMultiple, setPollAllowsMultiple] = useState(false);
  const [pollAnonymous, setPollAnonymous] = useState(false);
  const [pollClosesAt, setPollClosesAt] = useState('');
  const [existingAttachments, setExistingAttachments] = useState<FeedAttachment[]>([]);
  const [newFiles, setNewFiles] = useState<FeedUploadFile[]>([]);
  const [attachmentOrder, setAttachmentOrder] = useState<string[]>([]);
  const [coverKey, setCoverKey] = useState('');
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const createRequestRef = useRef<{ fingerprint: string; id: string } | null>(null);

  const formFingerprint = JSON.stringify([title, preview, body, priority, requiresAck, isPinned,
    commentsEnabled, reactionsEnabled, tagsText, categoryId, isActive, notifyOnUpdate,
    audienceScope, audienceRoles, audienceUserIds, publishedFrom, expiresAt, pinnedUntil,
    pollEnabled, pollQuestion, pollOptions, pollAllowsMultiple, pollAnonymous, pollClosesAt,
    existingAttachments.map((file) => file.id), newFiles, attachmentOrder, coverKey]);
  const baseline = useRef<{ postId: string; fingerprint: string } | null>(null);
  useLayoutEffect(() => {
    if (!loading && (!postId || source?.id === postId)
      && (!baseline.current || baseline.current.postId !== postId)) {
      baseline.current = { postId, fingerprint: formFingerprint };
    }
  }, [formFingerprint, loading, postId, source]);
  const dirty = Boolean(baseline.current?.postId === postId
    && baseline.current.fingerprint !== formFingerprint);
  const { requestLeave, leaveSaved } = useUnsavedFormGuard(canEdit && dirty, canEdit && (busy || attachmentBusy || transformingBody));

  const pollLocked = Boolean(source?.poll && Number(source.poll.total_votes || 0) > 0);
  const debouncedRecipientQuery = useDebouncedValue(recipientQuery, RECIPIENT_SEARCH_DELAY_MS);
  const selectedRecipientIdsKey = audienceScope === 'users' ? audienceUserIds.join(',') : '';
  const visibleRecipientUsers = useMemo(
    () => filterFeedRecipients(recipientUsers, recipientQuery, 20),
    [recipientQuery, recipientUsers],
  );
  const orderedAttachmentRows = useMemo<AttachmentEditorItem[]>(() => {
    const existingByKey = new Map<string, AttachmentEditorItem>(existingAttachments.map((attachment) => [
      existingAttachmentKey(String(attachment.id || '')),
      { key: existingAttachmentKey(String(attachment.id || '')), attachment },
    ]));
    const newByKey = new Map<string, AttachmentEditorItem>(newFiles.map((file) => [
      newAttachmentKey(file.uri),
      { key: newAttachmentKey(file.uri), file },
    ]));
    const knownKeys = new Set([...existingByKey.keys(), ...newByKey.keys()]);
    const keys = [
      ...attachmentOrder.filter((key) => knownKeys.has(key)),
      ...[...knownKeys].filter((key) => !attachmentOrder.includes(key)),
    ];
    const rows: AttachmentEditorItem[] = [];
    keys.forEach((key) => {
      const existing = existingByKey.get(key);
      if (existing) {
        rows.push(existing);
        return;
      }
      const added = newByKey.get(key);
      if (added) rows.push(added);
    });
    return rows;
  }, [attachmentOrder, existingAttachments, newFiles]);

  const goBack = useCallback(() => {
    requestLeave(() => {
      if (router.canGoBack()) router.back();
      else goBackOrReplace('/(shell)/feed');
    });
  }, [requestLeave]);

  useEffect(() => {
    if (!canEdit) return;
    let active = true;
    setRecipientsLoading(true);
    setRecipientsError('');
    void getFeedRecipients({
      q: debouncedRecipientQuery,
      limit: 20,
      userIds: selectedRecipientIdsKey
        ? selectedRecipientIdsKey.split(',').map(Number).filter((id) => id > 0)
        : [],
    }).then((payload) => {
      if (!active) return;
      setRecipientUsers(payload.users);
      setRecipientRoles(payload.roles);
    }).catch((cause) => {
      if (active) setRecipientsError(formatApiError(cause, 'Не удалось загрузить аудиторию.'));
    }).finally(() => {
      if (active) setRecipientsLoading(false);
    });
    return () => { active = false; };
  }, [canEdit, debouncedRecipientQuery, selectedRecipientIdsKey]);

  useEffect(() => {
    if (!canEdit) return;
    let active = true;
    void Promise.all([listFeedCategories(false), listFeedTags()])
      .then(([items, tagItems]) => {
        if (!active) return;
        setCategories(items);
        setKnownTags(tagItems);
      })
      .catch((cause) => { if (active) setError(formatApiError(cause, 'Не удалось загрузить категории.')); });
    return () => { active = false; };
  }, [canEdit]);

  useEffect(() => {
    if (!canEdit || !postId) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    void getFeedPost(postId).then((post) => {
      if (!active) return;
      setSource(post);
      setTitle(String(post.title || ''));
      setPreview(String(post.preview || ''));
      setBody(String(post.body || ''));
      setPriority(PRIORITIES.some((option) => option.value === post.priority) ? post.priority as 'low' | 'normal' | 'high' : 'normal');
      setRequiresAck(Boolean(post.requires_ack));
      setIsPinned(Boolean(post.is_pinned));
      setCommentsEnabled(post.comments_enabled !== false);
      setReactionsEnabled(post.reactions_enabled !== false);
      setTagsText((post.tags || []).join(', '));
      setCategoryId(String(post.category_id || ''));
      setIsActive(post.is_active !== false);
      setAudienceScope(
        post.audience_scope === 'roles' || post.audience_scope === 'users'
          ? post.audience_scope
          : 'all',
      );
      setAudienceRoles(Array.isArray(post.audience_roles) ? post.audience_roles.map(String) : []);
      setAudienceUserIds(Array.isArray(post.audience_user_ids) ? post.audience_user_ids.map(Number).filter((id) => id > 0) : []);
      setPublishedFrom(feedDateTimeInputValue(post.published_from));
      setExpiresAt(feedDateTimeInputValue(post.expires_at));
      setPinnedUntil(feedDateTimeInputValue(post.pinned_until));
      const poll = post.poll;
      setPollEnabled(Boolean(poll));
      setPollQuestion(String(poll?.question || ''));
      const nextPollOptions = Array.isArray(poll?.options)
        ? poll.options.map((option) => String(option.text || '')).slice(0, 10)
        : [];
      setPollOptions(nextPollOptions.length >= 2 ? nextPollOptions : ['', '']);
      setPollAllowsMultiple(Boolean(poll?.allows_multiple ?? poll?.multiple));
      setPollAnonymous(Boolean(poll?.is_anonymous));
      setPollClosesAt(feedDateTimeInputValue(poll?.closes_at));
      const attachments = Array.isArray(post.attachments) ? post.attachments : [];
      setExistingAttachments(attachments);
      setNewFiles([]);
      setAttachmentOrder(attachments.map((attachment) => existingAttachmentKey(String(attachment.id || ''))));
      const coverId = String(
        post.cover_attachment?.id
        || attachments.find((attachment) => attachment.is_cover)?.id
        || '',
      ).trim();
      setCoverKey(coverId ? existingAttachmentKey(coverId) : '');
    }).catch((cause) => {
      if (active) setError(formatApiError(cause, 'Не удалось загрузить публикацию для редактирования.'));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [canEdit, postId]);

  const payload = useMemo<FeedEditorPayload>(() => ({
    title: title.trim(),
    preview: preview.trim(),
    body: body.trim(),
    priority,
    audience_scope: audienceScope,
    audience_roles: audienceScope === 'roles' ? audienceRoles : [],
    audience_user_ids: audienceScope === 'users' ? audienceUserIds : [],
    requires_ack: requiresAck,
    is_pinned: isPinned,
    pinned_until: isPinned ? feedDateTimeToIso(pinnedUntil) : null,
    published_from: feedDateTimeToIso(publishedFrom),
    expires_at: feedDateTimeToIso(expiresAt),
    comments_enabled: commentsEnabled,
    reactions_enabled: reactionsEnabled,
    category_id: categoryId || null,
    tags: [...new Set(tagsText.split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 20),
    is_active: isActive,
    notify_on_update: source?.status === 'published' ? notifyOnUpdate : false,
    poll: pollEnabled ? {
      question: pollQuestion.trim(),
      options: pollOptions.map((option) => option.trim()),
      allows_multiple: pollAllowsMultiple,
      is_anonymous: pollAnonymous,
      closes_at: feedDateTimeToIso(pollClosesAt),
    } : null,
  }), [
    audienceRoles,
    audienceScope,
    audienceUserIds,
    body,
    categoryId,
    commentsEnabled,
    expiresAt,
    isPinned,
    isActive,
    notifyOnUpdate,
    pinnedUntil,
    pollAllowsMultiple,
    pollAnonymous,
    pollClosesAt,
    pollEnabled,
    pollOptions,
    pollQuestion,
    preview,
    priority,
    publishedFrom,
    reactionsEnabled,
    requiresAck,
    tagsText,
    title,
    source?.status,
  ]);

  const validate = useCallback(() => {
    if (payload.title.length < 3) return 'Заголовок должен содержать не меньше 3 символов.';
    if (!payload.body) return 'Добавьте основной текст публикации.';
    if (audienceScope === 'roles' && audienceRoles.length === 0) return 'Выберите хотя бы одну роль.';
    if (audienceScope === 'users' && audienceUserIds.length === 0) return 'Выберите хотя бы одного сотрудника.';
    const dateError = validateFeedEditorDates({ publishedFrom, expiresAt, pinnedUntil, pollClosesAt }, {
      isPinned,
      pollEnabled,
    });
    if (dateError) return dateError;
    if (pollEnabled) {
      const pollError = validateFeedPoll(pollQuestion, pollOptions);
      if (pollError) return pollError;
    }
    return '';
  }, [
    audienceRoles.length,
    audienceScope,
    audienceUserIds.length,
    expiresAt,
    isPinned,
    payload.body,
    payload.title,
    pinnedUntil,
    pollClosesAt,
    pollEnabled,
    pollOptions,
    pollQuestion,
    publishedFrom,
  ]);

  const filesForAtomicCreate = useMemo(() => {
    const fileByKey = new Map(newFiles.map((file) => [newAttachmentKey(file.uri), file]));
    const orderedFiles = attachmentOrder.flatMap((key) => {
      const file = fileByKey.get(key);
      return file ? [file] : [];
    });
    newFiles.forEach((file) => {
      if (!orderedFiles.some((item) => item.uri === file.uri)) orderedFiles.push(file);
    });
    if (!coverKey.startsWith('new:')) return orderedFiles;
    const coverUri = coverKey.slice(4);
    const cover = orderedFiles.find((file) => file.uri === coverUri);
    return cover ? [cover, ...orderedFiles.filter((file) => file.uri !== coverUri)] : orderedFiles;
  }, [attachmentOrder, coverKey, newFiles]);

  const createRequestIdFor = useCallback((mode: 'draft' | 'published') => {
    const fingerprint = JSON.stringify({
      mode,
      payload,
      files: filesForAtomicCreate.map((file) => ({
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
        uploadId: file.uploadId || '',
      })),
    });
    if (createRequestRef.current?.fingerprint !== fingerprint) {
      createRequestRef.current = { fingerprint, id: createFeedClientRequestId() };
    }
    return createRequestRef.current.id;
  }, [filesForAtomicCreate, payload]);

  const syncAttachments = useCallback(async (targetPostId: string) => {
    let currentExisting = [...existingAttachments];
    let remainingFiles = [...newFiles];
    let currentOrder = [...attachmentOrder];
    let currentCoverKey = coverKey;
    for (const file of newFiles) {
      const attachment = await uploadFeedAttachment(targetPostId, file);
      const attachmentId = String(attachment.id || '').trim();
      const oldKey = newAttachmentKey(file.uri);
      const nextKey = existingAttachmentKey(attachmentId);
      if (!currentExisting.some((item) => String(item.id || '') === attachmentId)) {
        currentExisting = [...currentExisting, attachment];
      }
      remainingFiles = remainingFiles.filter((item) => item.uri !== file.uri);
      currentOrder = currentOrder.map((key) => key === oldKey ? nextKey : key);
      if (!currentOrder.includes(nextKey)) currentOrder.push(nextKey);
      if (currentCoverKey === oldKey) currentCoverKey = nextKey;
      setExistingAttachments(currentExisting);
      setNewFiles(remainingFiles);
      setAttachmentOrder(currentOrder);
      setCoverKey(currentCoverKey);
    }
    const knownAttachmentIds = new Set(currentExisting.map((attachment) => String(attachment.id || '')).filter(Boolean));
    const attachmentIds = currentOrder
      .filter((key) => key.startsWith('existing:'))
      .map((key) => key.slice(9))
      .filter((attachmentId) => knownAttachmentIds.has(attachmentId));
    currentExisting.forEach((attachment) => {
      const attachmentId = String(attachment.id || '').trim();
      if (attachmentId && !attachmentIds.includes(attachmentId)) attachmentIds.push(attachmentId);
    });
    const coverAttachmentId = currentCoverKey.startsWith('existing:') ? currentCoverKey.slice(9) : '';
    let orderedAttachments = currentExisting;
    if (attachmentIds.length > 0) {
      const reordered = await reorderFeedAttachments(targetPostId, attachmentIds, coverAttachmentId);
      if (reordered.length > 0) orderedAttachments = reordered;
    }
    setExistingAttachments(orderedAttachments);
    setNewFiles([]);
    setAttachmentOrder(orderedAttachments.map((attachment) => existingAttachmentKey(String(attachment.id || ''))));
    setCoverKey(coverAttachmentId ? existingAttachmentKey(coverAttachmentId) : '');
  }, [attachmentOrder, coverKey, existingAttachments, newFiles]);

  const pickAttachments = useCallback(async () => {
    if (busy || offlineMode) return;
    try {
      const picked = await pickNativeFeedFiles();
      setNewFiles((current) => {
        const known = new Set(current.map((file) => file.uri));
        return [...current, ...picked.filter((file) => !known.has(file.uri))];
      });
      setAttachmentOrder((current) => {
        const known = new Set(current);
        return [
          ...current,
          ...picked.map((file) => newAttachmentKey(file.uri)).filter((key) => !known.has(key)),
        ];
      });
      if (!coverKey) {
        const firstImage = picked.find(uploadIsImage);
        if (firstImage) setCoverKey(`new:${firstImage.uri}`);
      }
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось выбрать вложения.'));
    }
  }, [busy, coverKey, offlineMode]);

  const appendBodyTemplate = useCallback((template: string) => {
    setBody((current) => `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${template}`);
    setBodyPreview(false);
  }, []);

  const transformBody = useCallback(async () => {
    const sourceText = body.trim();
    if (sourceText.length < 3 || transformingBody || offlineMode) return;
    setTransformingBody(true);
    setError('');
    try {
      setBody(await transformFeedMarkdown(sourceText));
      setBodyPreview(false);
      setMessage('Текст преобразован в Markdown');
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось преобразовать текст.'));
    } finally {
      setTransformingBody(false);
    }
  }, [body, offlineMode, transformingBody]);

  const removeExistingAttachment = useCallback((attachment: FeedAttachment) => {
    const attachmentId = String(attachment.id || '').trim();
    if (!postId || !attachmentId || attachmentBusy) return;
    Alert.alert('Удалить вложение?', String(attachment.file_name || 'Файл'), [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () => {
          setAttachmentBusy(true);
          void deleteFeedAttachment(postId, attachmentId)
            .then(() => {
              setExistingAttachments((current) => current.filter((item) => String(item.id) !== attachmentId));
              setAttachmentOrder((current) => current.filter((key) => key !== existingAttachmentKey(attachmentId)));
              setCoverKey((current) => current === existingAttachmentKey(attachmentId) ? '' : current);
            })
            .catch((cause) => setError(formatApiError(cause, 'Не удалось удалить вложение.')))
            .finally(() => setAttachmentBusy(false));
        },
      },
    ]);
  }, [attachmentBusy, postId]);

  const openSaved = useCallback((post: FeedPost) => {
    leaveSaved(() => router.replace({ pathname: '/(shell)/feed/[postId]', params: { postId: post.id } } as never));
  }, [leaveSaved]);

  const save = useCallback(async (mode: 'draft' | 'published') => {
    if (busy || offlineMode) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      let saved: FeedPost;
      if (postId) {
        saved = await updateFeedPost(postId, payload);
        await syncAttachments(postId);
      } else if (mode === 'draft') {
        saved = await createFeedDraft({ ...payload, status: 'draft', client_request_id: createRequestIdFor('draft') });
        await syncAttachments(saved.id);
      } else {
        saved = await createFeedPost({ ...payload, status: 'published', client_request_id: createRequestIdFor('published') }, filesForAtomicCreate);
      }
      openSaved(saved);
    } catch (cause) {
      setError(formatApiError(cause, mode === 'draft' ? 'Не удалось сохранить черновик.' : 'Не удалось сохранить публикацию.'));
    } finally {
      setBusy(false);
    }
  }, [busy, createRequestIdFor, filesForAtomicCreate, offlineMode, openSaved, payload, postId, syncAttachments, validate]);

  const publishDraft = useCallback(async () => {
    if (!postId || busy || offlineMode) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await updateFeedPost(postId, payload);
      await syncAttachments(postId);
      openSaved(await publishFeedPost(postId));
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось опубликовать черновик.'));
    } finally {
      setBusy(false);
    }
  }, [busy, offlineMode, openSaved, payload, postId, syncAttachments, validate]);

  const archive = useCallback(async () => {
    if (!postId || busy || offlineMode) return;
    setBusy(true);
    setError('');
    try {
      openSaved(await archiveFeedPost(postId));
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось архивировать публикацию.'));
    } finally {
      setBusy(false);
    }
  }, [busy, offlineMode, openSaved, postId]);

  if (!canEdit) {
    return <AccountScreenScaffold title="Редактор ленты" tokens={tokens} onBack={goBack}><AccountSectionCard tokens={tokens} title="Нет доступа" description={postId ? 'Редактировать публикацию может автор или модератор.' : 'Для создания публикации нужно право announcements.write.'}>{null}</AccountSectionCard></AccountScreenScaffold>;
  }

  return (
    <AccountScreenScaffold title={postId ? 'Редактирование' : 'Новая публикация'} tokens={tokens} onBack={goBack}>
      {offlineMode ? <Text accessibilityRole="alert" style={[styles.status, { color: tokens.warning }]}>Автономный режим: сохранение публикаций отключено.</Text> : null}
      <AccountStatusText tokens={tokens} error={error} message={message} />
      {loading ? <AccountLoading tokens={tokens} /> : postId && source?.can_manage === false ? (
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Редактировать публикацию может автор или модератор.">{null}</AccountSectionCard>
      ) : (
        <>
          <AccountSectionCard tokens={tokens} title="Содержание" description="Текст синхронизируется с общей web-лентой HUB-IT.">
            <Text style={[styles.label, { color: tokens.textSecondary }]}>Заголовок</Text>
            <TextInput testID="feed-editor-title" value={title} onChangeText={setTitle} maxLength={200} accessibilityLabel="Заголовок публикации" style={[styles.input, { color: tokens.textPrimary, borderColor: tokens.border }]} />
            <Text style={[styles.label, { color: tokens.textSecondary }]}>Короткое описание</Text>
            <TextInput testID="feed-editor-preview" value={preview} onChangeText={setPreview} maxLength={500} multiline accessibilityLabel="Короткое описание публикации" style={[styles.previewInput, { color: tokens.textPrimary, borderColor: tokens.border }]} />
            <Text style={[styles.label, { color: tokens.textSecondary }]}>Основной текст</Text>
            <View style={styles.markdownActions}>
              <Pressable accessibilityRole="button" accessibilityLabel="Добавить маркированный список" onPress={() => appendBodyTemplate('- Первый пункт\n- Второй пункт')} style={[styles.markdownAction, { borderColor: tokens.borderSoft }]}><Text style={{ color: tokens.primary, fontWeight: '800' }}>Список</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Добавить нумерованные шаги" onPress={() => appendBodyTemplate('1. Первый шаг\n2. Второй шаг')} style={[styles.markdownAction, { borderColor: tokens.borderSoft }]}><Text style={{ color: tokens.primary, fontWeight: '800' }}>Шаги</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Добавить чек-лист" onPress={() => appendBodyTemplate('- [ ] Задача\n- [ ] Ещё одна задача')} style={[styles.markdownAction, { borderColor: tokens.borderSoft }]}><Text style={{ color: tokens.primary, fontWeight: '800' }}>Чек-лист</Text></Pressable>
              <Pressable testID="feed-editor-preview-toggle" accessibilityRole="button" accessibilityState={{ selected: bodyPreview }} onPress={() => setBodyPreview((value) => !value)} style={[styles.markdownAction, { borderColor: tokens.borderSoft, backgroundColor: bodyPreview ? tokens.accentSoft : 'transparent' }]}><Text style={{ color: tokens.primary, fontWeight: '800' }}>{bodyPreview ? 'Редактор' : 'Предпросмотр'}</Text></Pressable>
            </View>
            {bodyPreview ? (
              <View testID="feed-editor-markdown-preview" style={[styles.markdownPreview, { borderColor: tokens.border, backgroundColor: tokens.panelMuted }]}>
                {body.trim() ? <FeedMarkdownText value={body} tokens={tokens} /> : <Text style={{ color: tokens.textSecondary }}>Нет текста для предпросмотра.</Text>}
              </View>
            ) : (
              <TextInput testID="feed-editor-body" value={body} onChangeText={setBody} maxLength={50_000} multiline accessibilityLabel="Основной текст публикации" textAlignVertical="top" style={[styles.bodyInput, { color: tokens.textPrimary, borderColor: tokens.border }]} />
            )}
            <Pressable
              testID="feed-editor-transform-markdown"
              accessibilityRole="button"
              accessibilityState={{ disabled: body.trim().length < 3 || transformingBody || offlineMode }}
              disabled={body.trim().length < 3 || transformingBody || offlineMode}
              onPress={() => { void transformBody(); }}
              style={[styles.outlineButton, { borderColor: tokens.borderSoft, opacity: body.trim().length < 3 || transformingBody || offlineMode ? 0.5 : 1 }]}
            >
              {transformingBody ? <ActivityIndicator color={tokens.primary} /> : <MaterialCommunityIcons name="format-text" size={19} color={tokens.primary} />}
              <Text style={{ color: tokens.primary, fontWeight: '800' }}>Преобразовать в Markdown</Text>
            </Pressable>
            <Text style={[styles.label, { color: tokens.textSecondary }]}>Теги через запятую</Text>
            <TextInput testID="feed-editor-tags" value={tagsText} onChangeText={setTagsText} maxLength={500} accessibilityLabel="Теги публикации" style={[styles.input, { color: tokens.textPrimary, borderColor: tokens.border }]} />
            {knownTags.length > 0 ? (
              <View style={styles.choiceWrap}>
                {knownTags.slice(0, 20).map((tag) => {
                  const selectedTags = tagsText.split(',').map((item) => item.trim()).filter(Boolean);
                  const selected = selectedTags.includes(tag.name);
                  return (
                    <Pressable
                      key={tag.id}
                      testID={`feed-editor-tag-${tag.id}`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      onPress={() => setTagsText((current) => {
                        const values = current.split(',').map((item) => item.trim()).filter(Boolean);
                        return (selected ? values.filter((item) => item !== tag.name) : [...values, tag.name]).join(', ');
                      })}
                      style={[styles.choiceChip, { backgroundColor: selected ? tokens.accentSoft : tokens.actionBg, borderColor: selected ? tokens.primary : tokens.border }]}
                    >
                      <Text style={{ color: selected ? tokens.primary : tokens.textPrimary, fontWeight: '800' }}>#{tag.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            {categories.length > 0 ? (
              <>
                <Text style={[styles.label, { color: tokens.textSecondary }]}>Категория</Text>
                <View accessibilityRole="radiogroup" style={styles.choiceWrap}>
                  <Pressable testID="feed-editor-category-none" accessibilityRole="radio" accessibilityState={{ selected: !categoryId }} onPress={() => setCategoryId('')} style={[styles.choiceChip, { backgroundColor: !categoryId ? tokens.primary : tokens.actionBg, borderColor: !categoryId ? tokens.primary : tokens.border }]}><Text style={{ color: !categoryId ? '#fff' : tokens.textPrimary, fontWeight: '800' }}>Без категории</Text></Pressable>
                  {categories.map((category) => {
                    const selected = categoryId === category.id;
                    return <Pressable key={category.id} testID={`feed-editor-category-${category.id}`} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => setCategoryId(category.id)} style={[styles.choiceChip, { backgroundColor: selected ? tokens.primary : tokens.actionBg, borderColor: selected ? tokens.primary : tokens.border }]}><Text style={{ color: selected ? '#fff' : tokens.textPrimary, fontWeight: '800' }}>{category.name}</Text></Pressable>;
                  })}
                </View>
              </>
            ) : null}
          </AccountSectionCard>

          <AccountSectionCard
            tokens={tokens}
            title="Аудитория"
            description="Выберите, кому будет доступна публикация. Поиск показывает не больше 20 совпадений."
          >
            {recipientsError ? <Text accessibilityRole="alert" style={[styles.status, { color: tokens.error }]}>{recipientsError}</Text> : null}
            <View accessibilityRole="radiogroup" style={styles.choiceWrap}>
              {AUDIENCE_SCOPES.map((option) => {
                const selected = audienceScope === option.value;
                return (
                  <Pressable
                    key={option.value}
                    testID={`feed-editor-audience-${option.value}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled: busy || offlineMode }}
                    disabled={busy || offlineMode}
                    onPress={() => setAudienceScope(option.value)}
                    style={[
                      styles.choiceChip,
                      {
                        backgroundColor: selected ? tokens.primary : tokens.actionBg,
                        borderColor: selected ? tokens.primary : tokens.border,
                      },
                    ]}
                  >
                    <Text style={{ color: selected ? '#fff' : tokens.textPrimary, fontWeight: '800' }}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {recipientsLoading ? <ActivityIndicator color={tokens.primary} accessibilityLabel="Загрузка аудитории" /> : null}
            {audienceScope === 'roles' ? (
              <View style={styles.selectionList}>
                {recipientRoles.map((role) => {
                  const selected = audienceRoles.includes(role.value);
                  return (
                    <Pressable
                      key={role.value}
                      testID={`feed-editor-role-${role.value}`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected, disabled: busy || offlineMode }}
                      disabled={busy || offlineMode}
                      onPress={() => setAudienceRoles((current) => (
                        selected ? current.filter((value) => value !== role.value) : [...current, role.value]
                      ))}
                      style={[styles.selectionRow, { borderColor: tokens.borderSoft }]}
                    >
                      <MaterialCommunityIcons name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'} size={22} color={selected ? tokens.primary : tokens.iconMuted} />
                      <Text style={[styles.selectionLabel, { color: tokens.textPrimary }]}>{role.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            {audienceScope === 'users' ? (
              <View style={styles.selectionList}>
                <TextInput
                  testID="feed-editor-recipient-search"
                  accessibilityLabel="Поиск сотрудников"
                  value={recipientQuery}
                  onChangeText={setRecipientQuery}
                  placeholder="Имя или логин"
                  placeholderTextColor={tokens.textTertiary}
                  maxLength={200}
                  style={[styles.input, { color: tokens.textPrimary, borderColor: tokens.border }]}
                />
                {audienceUserIds.length > 0 ? (
                  <View style={styles.selectedRecipients}>
                    {audienceUserIds.map((userId) => {
                      const user = recipientUsers.find((item) => item.id === userId);
                      return (
                        <Pressable
                          key={userId}
                          accessibilityRole="button"
                          accessibilityLabel={`Убрать сотрудника ${user ? recipientName(user) : userId}`}
                          onPress={() => setAudienceUserIds((current) => current.filter((id) => id !== userId))}
                          style={[styles.selectedRecipient, { backgroundColor: tokens.accentSoft }]}
                        >
                          <Text numberOfLines={1} style={{ color: tokens.primary, fontSize: 12, fontWeight: '700', maxWidth: 180 }}>
                            {user ? recipientName(user) : `#${userId}`}
                          </Text>
                          <MaterialCommunityIcons name="close" size={16} color={tokens.primary} />
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
                {visibleRecipientUsers.map((user) => {
                  const selected = audienceUserIds.includes(user.id);
                  return (
                    <Pressable
                      key={user.id}
                      testID={`feed-editor-recipient-${user.id}`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected, disabled: busy || offlineMode }}
                      disabled={busy || offlineMode}
                      onPress={() => setAudienceUserIds((current) => (
                        selected ? current.filter((id) => id !== user.id) : [...current, user.id]
                      ))}
                      style={[styles.selectionRow, { borderColor: tokens.borderSoft }]}
                    >
                      <MaterialCommunityIcons name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'} size={22} color={selected ? tokens.primary : tokens.iconMuted} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.selectionLabel, { color: tokens.textPrimary }]}>{recipientName(user)}</Text>
                        <Text style={{ color: tokens.textSecondary, fontSize: 12 }}>
                          {[user.username ? `@${user.username}` : '', user.department].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
                {!recipientsLoading && visibleRecipientUsers.length === 0 ? (
                  <Text style={{ color: tokens.textSecondary }}>Совпадений нет.</Text>
                ) : null}
              </View>
            ) : null}
          </AccountSectionCard>

          <AccountSectionCard tokens={tokens} title="Параметры">
            <View accessibilityRole="radiogroup" style={styles.priorityRow}>
              {PRIORITIES.map((option) => {
                const selected = priority === option.value;
                return <Pressable key={option.value} testID={`feed-editor-priority-${option.value}`} onPress={() => setPriority(option.value)} accessibilityRole="radio" accessibilityState={{ selected }} style={[styles.priorityChip, { backgroundColor: selected ? tokens.primary : tokens.actionBg, borderColor: selected ? tokens.primary : tokens.border }]}><Text style={{ color: selected ? '#fff' : tokens.textPrimary, fontWeight: '800' }}>{option.label}</Text></Pressable>;
              })}
            </View>
            {booleanOption({ label: 'Требовать подтверждение прочтения', value: requiresAck, onPress: () => setRequiresAck((value) => !value), disabled: busy || offlineMode, testID: 'feed-editor-requires-ack', tokens })}
            {booleanOption({ label: 'Закрепить публикацию', value: isPinned, onPress: () => setIsPinned((value) => !value), disabled: busy || offlineMode, testID: 'feed-editor-pinned', tokens })}
            {booleanOption({ label: 'Разрешить комментарии', value: commentsEnabled, onPress: () => setCommentsEnabled((value) => !value), disabled: busy || offlineMode, testID: 'feed-editor-comments', tokens })}
            {booleanOption({ label: 'Разрешить реакции', value: reactionsEnabled, onPress: () => setReactionsEnabled((value) => !value), disabled: busy || offlineMode, testID: 'feed-editor-reactions', tokens })}
            {booleanOption({ label: 'Публикация активна', value: isActive, onPress: () => setIsActive((value) => !value), disabled: busy || offlineMode, testID: 'feed-editor-active', tokens })}
            {source?.status === 'published' ? booleanOption({ label: 'Уведомить аудиторию об изменениях', value: notifyOnUpdate, onPress: () => setNotifyOnUpdate((value) => !value), disabled: busy || offlineMode, testID: 'feed-editor-notify-update', tokens }) : null}
          </AccountSectionCard>

          <AccountSectionCard tokens={tokens} title="Сроки" description="Формат: ГГГГ-ММ-ДД ЧЧ:ММ или полный ISO 8601.">
            <Text style={[styles.label, { color: tokens.textSecondary }]}>Опубликовать с</Text>
            <TextInput testID="feed-editor-published-from" accessibilityLabel="Дата публикации" value={publishedFrom} onChangeText={setPublishedFrom} autoCapitalize="none" placeholder="2026-08-25 09:00" placeholderTextColor={tokens.textTertiary} style={[styles.input, { color: tokens.textPrimary, borderColor: tokens.border }]} />
            {isPinned ? (
              <>
                <Text style={[styles.label, { color: tokens.textSecondary }]}>Закрепить до</Text>
                <TextInput testID="feed-editor-pinned-until" accessibilityLabel="Дата окончания закрепления" value={pinnedUntil} onChangeText={setPinnedUntil} autoCapitalize="none" placeholder="2026-08-30 18:00" placeholderTextColor={tokens.textTertiary} style={[styles.input, { color: tokens.textPrimary, borderColor: tokens.border }]} />
              </>
            ) : null}
            <Text style={[styles.label, { color: tokens.textSecondary }]}>Скрыть после</Text>
            <TextInput testID="feed-editor-expires-at" accessibilityLabel="Дата скрытия публикации" value={expiresAt} onChangeText={setExpiresAt} autoCapitalize="none" placeholder="2026-09-01 18:00" placeholderTextColor={tokens.textTertiary} style={[styles.input, { color: tokens.textPrimary, borderColor: tokens.border }]} />
          </AccountSectionCard>

          <AccountSectionCard tokens={tokens} title="Опрос">
            {booleanOption({
              label: 'Добавить опрос',
              value: pollEnabled,
              onPress: () => setPollEnabled((value) => !value),
              disabled: busy || offlineMode || pollLocked,
              testID: 'feed-editor-poll-enabled',
              tokens,
            })}
            {pollLocked ? <Text style={[styles.status, { color: tokens.warning }]}>Опрос нельзя изменить после начала голосования.</Text> : null}
            {pollEnabled ? (
              <View style={styles.pollEditor}>
                <Text style={[styles.label, { color: tokens.textSecondary }]}>Вопрос</Text>
                <TextInput testID="feed-editor-poll-question" accessibilityLabel="Вопрос опроса" editable={!pollLocked && !busy && !offlineMode} value={pollQuestion} onChangeText={setPollQuestion} maxLength={300} style={[styles.input, { color: tokens.textPrimary, borderColor: tokens.border, opacity: pollLocked ? 0.6 : 1 }]} />
                {pollOptions.map((option, index) => (
                  <View key={`poll-option-${index}`} style={styles.pollOptionRow}>
                    <TextInput
                      testID={`feed-editor-poll-option-${index}`}
                      accessibilityLabel={`Вариант ответа ${index + 1}`}
                      editable={!pollLocked && !busy && !offlineMode}
                      value={option}
                      onChangeText={(value) => setPollOptions((current) => current.map((item, optionIndex) => optionIndex === index ? value : item))}
                      maxLength={160}
                      style={[styles.input, styles.pollOptionInput, { color: tokens.textPrimary, borderColor: tokens.border, opacity: pollLocked ? 0.6 : 1 }]}
                    />
                    <Pressable
                      testID={`feed-editor-poll-remove-${index}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Удалить вариант ${index + 1}`}
                      accessibilityState={{ disabled: pollLocked || pollOptions.length <= 2 }}
                      disabled={pollLocked || pollOptions.length <= 2}
                      onPress={() => setPollOptions((current) => current.filter((_, optionIndex) => optionIndex !== index))}
                      style={[styles.inlineIconButton, { opacity: pollLocked || pollOptions.length <= 2 ? 0.4 : 1 }]}
                    >
                      <MaterialCommunityIcons name="delete-outline" size={20} color={tokens.error} />
                    </Pressable>
                  </View>
                ))}
                <Pressable
                  testID="feed-editor-poll-add"
                  accessibilityRole="button"
                  accessibilityLabel="Добавить вариант ответа"
                  accessibilityState={{ disabled: pollLocked || pollOptions.length >= 10 }}
                  disabled={pollLocked || pollOptions.length >= 10}
                  onPress={() => setPollOptions((current) => [...current, ''])}
                  style={[styles.outlineButton, { borderColor: tokens.borderSoft }]}
                >
                  <MaterialCommunityIcons name="plus" size={19} color={tokens.primary} />
                  <Text style={{ color: tokens.primary, fontWeight: '800' }}>Добавить вариант</Text>
                </Pressable>
                {booleanOption({ label: 'Разрешить несколько вариантов', value: pollAllowsMultiple, onPress: () => setPollAllowsMultiple((value) => !value), disabled: busy || offlineMode || pollLocked, testID: 'feed-editor-poll-multiple', tokens })}
                {booleanOption({ label: 'Анонимный опрос', value: pollAnonymous, onPress: () => setPollAnonymous((value) => !value), disabled: busy || offlineMode || pollLocked, testID: 'feed-editor-poll-anonymous', tokens })}
                <Text style={[styles.label, { color: tokens.textSecondary }]}>Завершить опрос</Text>
                <TextInput testID="feed-editor-poll-closes-at" accessibilityLabel="Дата завершения опроса" editable={!pollLocked && !busy && !offlineMode} value={pollClosesAt} onChangeText={setPollClosesAt} autoCapitalize="none" placeholder="2026-08-30 18:00" placeholderTextColor={tokens.textTertiary} style={[styles.input, { color: tokens.textPrimary, borderColor: tokens.border, opacity: pollLocked ? 0.6 : 1 }]} />
              </View>
            ) : null}
          </AccountSectionCard>

          <AccountSectionCard tokens={tokens} title="Вложения" description="До 20 МБ на файл. Изображение можно выбрать обложкой.">
            {orderedAttachmentRows.map((row, index) => {
              const attachment = 'attachment' in row ? row.attachment : undefined;
              const file = 'file' in row ? row.file : undefined;
              const name = attachment
                ? String(attachment.file_name || 'Вложение')
                : String(file?.name || 'Вложение');
              const image = attachment ? isImageAttachment(attachment) : Boolean(file && uploadIsImage(file));
              return (
                <AttachmentEditorRow
                  key={row.key}
                  name={name}
                  image={image}
                  cover={coverKey === row.key}
                  disabled={busy || offlineMode || attachmentBusy}
                  onCover={image ? () => setCoverKey(row.key) : undefined}
                  onMoveUp={index > 0 ? () => setAttachmentOrder((current) => moveItem(current, index, -1)) : undefined}
                  onMoveDown={index < orderedAttachmentRows.length - 1 ? () => setAttachmentOrder((current) => moveItem(current, index, 1)) : undefined}
                  onRemove={attachment
                    ? () => removeExistingAttachment(attachment)
                    : () => {
                      if (!file) return;
                      setNewFiles((current) => current.filter((item) => item.uri !== file.uri));
                      setAttachmentOrder((current) => current.filter((key) => key !== row.key));
                      setCoverKey((current) => current === row.key ? '' : current);
                    }}
                  tokens={tokens}
                />
              );
            })}
            <Pressable
              testID="feed-editor-attachments-pick"
              accessibilityRole="button"
              accessibilityLabel="Выбрать вложения"
              accessibilityState={{ disabled: busy || offlineMode }}
              disabled={busy || offlineMode}
              onPress={() => { void pickAttachments(); }}
              style={[styles.outlineButton, { borderColor: tokens.borderSoft }]}
            >
              <MaterialCommunityIcons name="paperclip" size={19} color={tokens.primary} />
              <Text style={{ color: tokens.primary, fontWeight: '800' }}>Выбрать файлы</Text>
            </Pressable>
          </AccountSectionCard>

          <View style={styles.actions}>
            {postId ? (
              <>
                <AccountSecondaryButton tokens={tokens} label="Сохранить изменения" onPress={() => { void save('published'); }} disabled={busy || offlineMode} testID="feed-editor-save" />
                {source?.status !== 'published' ? <AccountPrimaryButton tokens={tokens} label={source?.status === 'scheduled' ? 'Применить расписание' : 'Опубликовать'} onPress={() => { void publishDraft(); }} disabled={busy || offlineMode} testID="feed-editor-publish" /> : null}
                {source?.status !== 'archived' ? <AccountSecondaryButton tokens={tokens} label="В архив" onPress={() => { void archive(); }} disabled={busy || offlineMode} danger testID="feed-editor-archive" /> : null}
              </>
            ) : (
              <>
                <AccountSecondaryButton tokens={tokens} label="Сохранить черновик" onPress={() => { void save('draft'); }} disabled={busy || offlineMode} testID="feed-editor-draft" />
                <AccountPrimaryButton tokens={tokens} label="Опубликовать" onPress={() => { void save('published'); }} disabled={busy || offlineMode} testID="feed-editor-publish" />
              </>
            )}
            {busy ? <ActivityIndicator color={tokens.primary} accessibilityLabel="Сохранение публикации" /> : null}
          </View>
        </>
      )}
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  status: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  label: { marginTop: 4, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  input: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15 },
  previewInput: { minHeight: 72, maxHeight: 120, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, textAlignVertical: 'top' },
  bodyInput: { minHeight: 180, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  markdownActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  markdownAction: { minHeight: 40, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  markdownPreview: { minHeight: 180, borderWidth: 1, borderRadius: 12, padding: 12 },
  priorityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  priorityChip: { minHeight: 42, borderWidth: 1, borderRadius: 21, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choiceChip: { minHeight: 44, borderWidth: 1, borderRadius: 22, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  selectionList: { gap: 4 },
  selectionRow: { minHeight: 48, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  selectionLabel: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  selectedRecipients: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  selectedRecipient: { minHeight: 40, borderRadius: 20, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  pollEditor: { gap: 8 },
  pollOptionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pollOptionInput: { flex: 1 },
  inlineIconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  outlineButton: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  attachmentRow: { minHeight: 52, borderWidth: 1, borderRadius: 12, paddingLeft: 10, flexDirection: 'row', alignItems: 'center', gap: 4 },
  attachmentName: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  attachmentAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  optionRow: { minHeight: 48, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  optionLabel: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  actions: { gap: 10 },
});
