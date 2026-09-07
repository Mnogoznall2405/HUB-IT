import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import type { NativePickedFile } from '../files/nativeFilePicker';
import * as SecureStore from 'expo-secure-store';
import { CHAT_DRAFT_STORAGE_KEY, CHAT_OUTBOX_STORAGE_KEY, enqueueNativeChatStorage } from './nativeChatStorageQueue';

const copies = new Map<string, { uri: string; version: string; size: number }>();
const root = () => new Directory(Paths.document, 'hubit-chat-draft-files');
const activeFiles = new Set<Set<string>>();

export function pinNativeChatDraftFiles(files: NativePickedFile[]) {
  const uris = new Set(files.map((file) => file.uri));
  activeFiles.add(uris);
  return () => { activeFiles.delete(uris); };
}

async function referencedChatFiles() {
  const referenced = new Set<string>();
  for (const key of [CHAT_DRAFT_STORAGE_KEY, CHAT_OUTBOX_STORAGE_KEY]) {
    const raw = await SecureStore.getItemAsync(key);
    let entries: unknown;
    try { entries = raw ? JSON.parse(raw) : []; }
    catch { throw new Error('Не удалось проверить ссылки на вложения'); }
    if (!Array.isArray(entries)) throw new Error('Не удалось проверить ссылки на вложения');
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || !Number.isInteger(entry.userId) || entry.userId <= 0
        || (key === CHAT_DRAFT_STORAGE_KEY
          ? typeof entry.conversationId !== 'string' || !entry.conversationId.trim()
          : typeof entry.message?.conversation_id !== 'string' || !entry.message.conversation_id.trim())) {
        throw new Error('Не удалось проверить ссылки на вложения');
      }
      const context = key === CHAT_DRAFT_STORAGE_KEY ? entry.context : entry.upload;
      if (context !== undefined && context !== null && (typeof context !== 'object' || Array.isArray(context))) {
        throw new Error('Не удалось проверить ссылки на вложения');
      }
      const files = context?.files;
      if (files !== undefined && !Array.isArray(files)) throw new Error('Не удалось проверить ссылки на вложения');
      for (const file of files || []) {
        if (typeof file?.uri !== 'string' || !file.uri.trim()) throw new Error('Не удалось проверить ссылки на вложения');
        referenced.add(file.uri);
      }
    }
  }
  for (const uris of activeFiles) for (const uri of uris) referenced.add(uri);
  // An open editor may still point to the original picker URI after copying.
  for (const [key, copy] of copies) {
    const [, sourceUri] = JSON.parse(key);
    if (referenced.has(sourceUri)) referenced.add(copy.uri);
  }
  return referenced;
}

export type NativeChatFileInspection = {
  files: number; linked: number; unlinked: number; unlinkedBytes: number; missing: number; complete: boolean;
};

/** Read-only inventory. Unlinked files are candidates, never proof that deletion is safe. */
export function inspectNativeChatDraftFiles(userId: number): Promise<NativeChatFileInspection> {
  return enqueueNativeChatStorage(async () => {
    if (!Number.isInteger(userId) || userId <= 0) throw new Error('Не удалось проверить файлы чата');
    const referenced = await referencedChatFiles();
    const directory = new Directory(root(), String(userId));
    const prefix = `${directory.uri.replace(/\/$/, '')}/`;
    const report: NativeChatFileInspection = { files: 0, linked: 0, unlinked: 0, unlinkedBytes: 0, missing: 0, complete: true };
    const present = new Set<string>();
    const entries = directory.exists ? directory.list() : [];
    if (entries.length > 5000) report.complete = false;
    for (const entry of entries.slice(0, 5000)) {
      // Do not descend into unexpected directories or inspect another user's files.
      if (!(entry instanceof File) || !entry.uri.startsWith(prefix)
        || !/^[a-zA-Z0-9-]+$/.test(entry.uri.slice(prefix.length))) { report.complete = false; continue; }
      if (!entry.exists) { report.complete = false; continue; }
      present.add(entry.uri);
      report.files += 1;
      if (referenced.has(entry.uri)) report.linked += 1;
      else {
        report.unlinked += 1;
        const size = entry.size;
        if (typeof size === 'number' && Number.isFinite(size) && size >= 0) report.unlinkedBytes += size;
        else report.complete = false;
      }
    }
    for (const uri of referenced) {
      if (!uri.startsWith(prefix) || !/^[a-zA-Z0-9-]+$/.test(uri.slice(prefix.length))) continue;
      if (!present.has(uri) && !new File(uri).exists) report.missing += 1;
    }
    return report;
  });
}

/** Call inside the shared storage queue, after a successful metadata commit. */
export async function deleteUnreferencedChatFiles(candidates: string[]) {
  if (!candidates.length) return;
  const referenced = await referencedChatFiles();
  const prefix = `${root().uri.replace(/\/$/, '')}/`;
  const targets = new Set(candidates);
  for (const [key, copy] of copies) {
    if (targets.has(JSON.parse(key)[1])) targets.add(copy.uri);
  }
  for (const uri of targets) {
    if (referenced.has(uri) || !uri.startsWith(prefix)) continue;
    const relative = uri.slice(prefix.length);
    if (!/^\d+\/[a-zA-Z0-9-]+$/.test(relative)) continue;
    const file = new File(uri);
    if (file.exists) file.delete();
    for (const [key, copy] of copies) if (copy.uri === uri) copies.delete(key);
  }
}

function cleanupIncompleteCopy(destination: File) {
  try {
    if (destination.exists) destination.delete();
  } catch {
    // Incomplete destination cleanup must not hide the original copy failure.
  }
}

/** Keep picked files in app-private documents, not the OS-evictable picker cache. */
export async function persistNativeChatDraftFiles(
  userId: number,
  files: NativePickedFile[],
): Promise<NativePickedFile[]> {
  if (!Number.isInteger(userId) || userId <= 0) throw new Error('Не удалось сохранить файлы черновика');
  const directory = new Directory(root(), String(userId));
  directory.create({ intermediates: true, idempotent: true });
  const persisted: NativePickedFile[] = [];
  for (const picked of files) {
    const source = new File(picked.uri);
    const key = JSON.stringify([userId, source.uri]);
    const version = source.exists ? JSON.stringify([source.size, source.modificationTime]) : null;
    const previous = copies.get(key);
    const cached = previous ? new File(previous.uri) : null;
    if (previous && cached?.exists && cached.size === previous.size && (version === null || previous.version === version)) {
      persisted.push({ ...picked, uri: previous.uri, size: previous.size });
      continue;
    }
    if (!source.exists) throw new Error('Файл черновика недоступен. Выберите его снова.');
    if (source.uri.startsWith(`${directory.uri.replace(/\/$/, '')}/`)) {
      if (picked.size > 0 && source.size !== picked.size) throw new Error('Размер вложения изменился. Выберите файл снова.');
      persisted.push({ ...picked, size: source.size });
      continue;
    }
    const destination = new File(directory, randomUUID());
    try {
      // expo-file-system File.copy() returns Promise<void>; never check size before it settles.
      await source.copy(destination);
      if (!destination.exists || destination.size !== source.size) {
        throw new Error('Не удалось проверить копию вложения');
      }
    } catch (error) {
      cleanupIncompleteCopy(destination);
      if (error instanceof Error && (
        error.message === 'Не удалось проверить копию вложения'
        || error.message === 'Файл черновика недоступен. Выберите его снова.'
        || error.message === 'Размер вложения изменился. Выберите файл снова.'
      )) {
        throw error;
      }
      throw new Error('Не удалось сохранить вложение на устройстве. Повторите сохранение.');
    }
    copies.set(key, { uri: destination.uri, version: version!, size: destination.size });
    persisted.push({ ...picked, uri: destination.uri, size: destination.size });
  }
  return persisted;
}

export function clearNativeChatDraftFiles() {
  copies.clear();
  const directory = root();
  if (directory.exists) directory.delete();
}
