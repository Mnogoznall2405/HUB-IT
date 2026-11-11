export type ChatAiSandboxPermission = {
  id: string;
  title: string;
  detail: string;
  argumentsText: string;
};

export type ChatAiSandboxFile = {
  id: string;
  path: string;
  kind: string;
  changed: boolean;
  availability: string;
  downloadUrl?: string | null;
  messageId?: string;
  attachmentId?: string;
};

export type ChatAiSandboxState = {
  enabled: boolean;
  jobStatus: string;
  jobLabel: string;
  pendingPermissions: ChatAiSandboxPermission[];
  files: ChatAiSandboxFile[];
  diffs: Array<{ path: string; patch: string }>;
  archive: {
    downloadUrl?: string | null;
    messageId?: string;
    attachmentId?: string;
  } | null;
};

const STATUS_LABELS: Record<string, string> = {
  preparing: 'Подготовка',
  queued: 'В очереди',
  claimed: 'Запускается',
  running: 'Выполняется',
  waiting_permission: 'Нужно разрешение',
  succeeded: 'Готово',
  completed: 'Готово',
  failed: 'Ошибка',
  cancelled: 'Остановлено',
  expired: 'Время истекло',
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function sandboxStatusLabel(value: unknown): string {
  const key = text(value).toLowerCase();
  return STATUS_LABELS[key] || text(value) || 'Ожидает запуска';
}

export function isSandboxAiBot(bot?: { surface?: string | null } | null): boolean {
  return text(bot?.surface).toLowerCase() === 'sandbox';
}

function attachmentReference(item: unknown): { messageId: string; attachmentId: string } {
  const payload = record(item);
  const attachment = record(payload.attachment);
  return {
    messageId: text(payload.message_id || payload.messageId || attachment.message_id),
    attachmentId: text(payload.attachment_id || payload.attachmentId || attachment.id),
  };
}

function filePath(item: unknown): string {
  const payload = record(item);
  return text(payload.path || payload.relative_path || payload.name || payload.file_name) || 'Файл';
}

function collectDiffEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return [{ diff: value }];
  const payload = record(value);
  if (Array.isArray(payload.files)) return payload.files;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.entries)) return payload.entries;
  return Object.keys(payload).length ? [payload] : [];
}

export function normalizeAiSandboxPayload(payload?: unknown): ChatAiSandboxState {
  const data = record(payload);
  const job = record(data.job);
  const archive = data.archive && typeof data.archive === 'object' ? record(data.archive) : null;
  const archiveRef = archive ? attachmentReference(archive) : { messageId: '', attachmentId: '' };
  return {
    enabled: data.enabled !== false,
    jobStatus: text(job.status),
    jobLabel: sandboxStatusLabel(job.status),
    pendingPermissions: (Array.isArray(data.pending_permissions) ? data.pending_permissions : [])
      .map((item) => {
        const permission = record(item);
        const id = text(permission.id || permission.permission_id);
        const title = text(
          permission.title || permission.tool_label || permission.tool || permission.kind,
        ) || 'Действие OpenCode';
        const detail = text(
          permission.description
          || permission.reason
          || permission.summary
          || permission.operation
          || permission.command
          || permission.path,
        );
        const argumentsText = permission.arguments && typeof permission.arguments === 'object'
          ? JSON.stringify(permission.arguments, null, 2)
          : '';
        return {
          id,
          title,
          detail,
          argumentsText: argumentsText && argumentsText !== '{}' ? argumentsText : '',
        };
      })
      .filter((item) => item.id),
    files: (Array.isArray(data.files) ? data.files : []).map((item) => {
      const file = record(item);
      const ref = attachmentReference(file);
      const availability = text(file.availability).toLowerCase();
      return {
        id: text(file.id || file.file_id),
        path: filePath(file),
        kind: text(file.kind).toLowerCase(),
        changed: Boolean(file.changed) || ['added', 'modified', 'deleted'].includes(text(file.status).toLowerCase()),
        availability,
        downloadUrl: text(file.download_url || file.url) || null,
        messageId: ref.messageId || undefined,
        attachmentId: ref.attachmentId || undefined,
      };
    }).filter((item) => item.id || item.path),
    diffs: collectDiffEntries(data.diff).map((item) => {
      const entry = record(item);
      return {
        path: filePath(entry),
        patch: text(entry.diff || entry.patch || entry.content || entry.text),
      };
    }).filter((item) => item.path || item.patch),
    archive: archive ? {
      downloadUrl: text(archive.download_url || archive.url) || null,
      messageId: archiveRef.messageId || undefined,
      attachmentId: archiveRef.attachmentId || undefined,
    } : null,
  };
}

export function canAttachSandboxFile(file: ChatAiSandboxFile): boolean {
  const ready = !file.availability || ['attached', 'not_applicable'].includes(file.availability);
  return ready && ['output', 'changed', 'archive'].includes(file.kind);
}
