import { router } from 'expo-router';
import { normalizeNativeRoutePath } from './nativeRoutePath';
import type { NativeChatDestination } from '../chat/nativeChatFeature';
import {
  NATIVE_CHAT_ENABLED,
  nativeChatDestinationFromPortalPath,
} from '../chat/nativeChatFeature';
import {
  nativeFeedDestinationFromPortalPath,
  type NativeFeedDestination,
} from '../feed/nativeFeedRoutes';
import {
  nativeAccountHrefFromPortalPath,
  type NativeAccountHref,
} from './nativeAccountRoutes';
import {
  NATIVE_TASKS_ENABLED,
  nativeTasksDestinationFromPortalPath,
  type NativeTasksDestination,
} from '../tasks/nativeTasksFeature';
import { NATIVE_NOTIFICATIONS_ENABLED } from '../notifications/nativeNotificationsFeature';
import {
  NATIVE_MAIL_ENABLED,
  nativeMailDestinationFromPortalPath,
  type NativeMailDestination,
} from '../mail/nativeMailFeature';
import {
  NATIVE_DATABASE_ENABLED,
  nativeDatabaseDestinationFromPortalPath,
  type NativeDatabaseDestination,
} from '../database/nativeDatabaseFeature';
import {
  NATIVE_MY_FILES_ENABLED,
  nativeMyFilesDestinationFromPortalPath,
  type NativeMyFilesDestination,
} from '../myFiles/nativeMyFilesFeature';
import {
  NATIVE_COMPANY_STRUCTURE_ENABLED,
  nativeCompanyStructureDestinationFromPortalPath,
  type NativeCompanyStructureDestination,
} from '../companyStructure/nativeCompanyStructureFeature';
import {
  NATIVE_DOCFLOW_ENABLED,
  nativeDocflowDestinationFromPortalPath,
  type NativeDocflowDestination,
} from '../docflow/nativeDocflowFeature';
import {
  NATIVE_SCAN_CENTER_ENABLED,
  nativeScanCenterDestinationFromPortalPath,
  type NativeScanCenterDestination,
} from '../scanCenter/nativeScanCenterFeature';
import {
  NATIVE_COMPUTERS_ENABLED,
  nativeComputersDestinationFromPortalPath,
  type NativeComputersDestination,
} from '../computers/nativeComputersFeature';
import {
  NATIVE_PASSWORDS_ENABLED,
  nativePasswordsDestinationFromPortalPath,
  type NativePasswordsDestination,
} from '../passwords/nativePasswordsFeature';
import {
  NATIVE_GROUPS_ACCESS_ENABLED,
  nativeGroupsAccessDestinationFromPortalPath,
  type NativeGroupsAccessDestination,
} from '../groupsAccess/nativeGroupsAccessFeature';
import {
  NATIVE_WAREHOUSE_1C_ENABLED,
  nativeWarehouse1CDestinationFromPortalPath,
  type NativeWarehouse1CDestination,
} from '../warehouse1c/nativeWarehouse1cFeature';
import {
  NATIVE_MFU_ENABLED,
  nativeMfuDestinationFromPortalPath,
  type NativeMfuDestination,
} from '../mfu/nativeMfuFeature';

export type NativeModuleHref =
  | { pathname: '/(shell)/dashboard' }
  | { pathname: '/(shell)/notifications' }
  | { pathname: '/(shell)/menu' }
  | { pathname: '/(shell)/address-book' }
  | NativeFeedDestination
  | { pathname: NativeAccountHref }
  | NativeTasksDestination
  | NativeChatDestination
  | NativeMailDestination
  | NativeDatabaseDestination
  | NativeMyFilesDestination
  | NativeCompanyStructureDestination
  | NativeDocflowDestination
  | NativeScanCenterDestination
  | NativeComputersDestination
  | NativePasswordsDestination
  | NativeGroupsAccessDestination
  | NativeWarehouse1CDestination
  | NativeMfuDestination;

function nativeRootFallback(pathname: string): NativeModuleHref {
  if (pathname === '/feed' || pathname.startsWith('/feed/')) return { pathname: '/(shell)/feed' };
  if (pathname === '/tasks' || pathname.startsWith('/tasks/')) return { pathname: '/(shell)/tasks' };
  if (pathname === '/chat' || pathname.startsWith('/chat/')) return { pathname: '/(shell)/chat' };
  if (pathname === '/mail' || pathname.startsWith('/mail/')) return { pathname: '/(shell)/mail' };
  if (pathname === '/database' || pathname.startsWith('/database/')) return { pathname: '/(shell)/database' };
  if (pathname === '/my-files' || pathname.startsWith('/my-files/')) return { pathname: '/(shell)/my-files' };
  if (pathname === '/company-structure' || pathname.startsWith('/company-structure/')) {
    return { pathname: '/(shell)/company-structure' };
  }
  if (pathname === '/docflow' || pathname.startsWith('/docflow/')) return { pathname: '/(shell)/docflow' };
  if (pathname === '/address-book' || pathname.startsWith('/address-book/')) {
    return { pathname: '/(shell)/address-book' };
  }
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return { pathname: '/(shell)/menu/settings' };
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return { pathname: '/(shell)/menu/admin' };
  if (pathname === '/profile' || pathname.startsWith('/profile/')) return { pathname: '/(shell)/menu/profile' };
  return { pathname: '/(shell)/menu' };
}

export function hrefForPortalPath(
  path: string,
): NativeModuleHref {
  const normalized = normalizeNativeRoutePath(path);
  let parsed: URL;
  try {
    parsed = new URL(normalized, 'https://hubit.invalid');
  } catch {
    return { pathname: '/(shell)/dashboard' };
  }
  const pathname = parsed.pathname;

  if (pathname === '/notifications') {
    if (NATIVE_NOTIFICATIONS_ENABLED) {
      return { pathname: '/(shell)/notifications' };
    }
    return { pathname: '/(shell)/dashboard' };
  }

  if (pathname === '/dashboard') return { pathname: '/(shell)/dashboard' };
  if (pathname === '/menu') return { pathname: '/(shell)/menu' };
  if (pathname === '/address-book') return { pathname: '/(shell)/address-book' };

  const feedHref = nativeFeedDestinationFromPortalPath(normalized);
  if (feedHref) return feedHref;

  const accountHref = nativeAccountHrefFromPortalPath(pathname);
  if (accountHref) return { pathname: accountHref };

  if (NATIVE_TASKS_ENABLED) {
    const tasksHref = nativeTasksDestinationFromPortalPath(normalized);
    if (tasksHref) return tasksHref;
  }

  if (NATIVE_MAIL_ENABLED) {
    const mailHref = nativeMailDestinationFromPortalPath(normalized);
    if (mailHref) return mailHref;
  }

  if (NATIVE_DATABASE_ENABLED) {
    const databaseHref = nativeDatabaseDestinationFromPortalPath(normalized);
    if (databaseHref) return databaseHref;
  }

  if (NATIVE_MY_FILES_ENABLED) {
    const myFilesHref = nativeMyFilesDestinationFromPortalPath(normalized);
    if (myFilesHref) return myFilesHref;
  }

  if (NATIVE_COMPANY_STRUCTURE_ENABLED) {
    const companyStructureHref = nativeCompanyStructureDestinationFromPortalPath(normalized);
    if (companyStructureHref) return companyStructureHref;
  }

  if (NATIVE_DOCFLOW_ENABLED) {
    const docflowHref = nativeDocflowDestinationFromPortalPath(normalized);
    if (docflowHref) return docflowHref;
  }

  if (NATIVE_SCAN_CENTER_ENABLED) {
    const scanCenterHref = nativeScanCenterDestinationFromPortalPath(normalized);
    if (scanCenterHref) return scanCenterHref;
  }

  if (NATIVE_COMPUTERS_ENABLED) {
    const computersHref = nativeComputersDestinationFromPortalPath(normalized);
    if (computersHref) return computersHref;
  }

  if (NATIVE_PASSWORDS_ENABLED) {
    const passwordsHref = nativePasswordsDestinationFromPortalPath(normalized);
    if (passwordsHref) return passwordsHref;
  }

  if (NATIVE_GROUPS_ACCESS_ENABLED) {
    const groupsAccessHref = nativeGroupsAccessDestinationFromPortalPath(normalized);
    if (groupsAccessHref) return groupsAccessHref;
  }

  if (NATIVE_WAREHOUSE_1C_ENABLED) {
    const warehouse1CHref = nativeWarehouse1CDestinationFromPortalPath(normalized);
    if (warehouse1CHref) return warehouse1CHref;
  }

  if (NATIVE_MFU_ENABLED) {
    const mfuHref = nativeMfuDestinationFromPortalPath(normalized);
    if (mfuHref) return mfuHref;
  }

  if (NATIVE_CHAT_ENABLED) {
    const chatHref = nativeChatDestinationFromPortalPath(normalized);
    if (chatHref) return chatHref;
  }

  return nativeRootFallback(pathname);
}

function routePathFromHref(href: NativeModuleHref): string {
  if (href.pathname === '/(shell)/dashboard') return '/dashboard';
  if (href.pathname === '/(shell)/notifications') return '/notifications';
  if (href.pathname === '/(shell)/menu') return '/menu';
  if (href.pathname === '/(shell)/address-book') return '/address-book';
  if (href.pathname === '/(shell)/tasks') {
    const query = new URLSearchParams();
    if (href.params?.q) query.set('q', href.params.q);
    if (href.params?.status) query.set('status', href.params.status);
    if (href.params?.focusMode) query.set('focus_mode', href.params.focusMode);
    if (href.params?.taskView) query.set('task_view', href.params.taskView);
    if (href.params?.taskDue) query.set('task_due', href.params.taskDue);
    if (href.params?.taskFiles) query.set('task_files', href.params.taskFiles);
    if (href.params?.taskUnread) query.set('task_unread_comments', href.params.taskUnread);
    if (href.params?.taskAssignee) query.set('task_assignee', href.params.taskAssignee);
    if (href.params?.taskController) query.set('task_controller', href.params.taskController);
    if (href.params?.taskDepartment) query.set('task_department', href.params.taskDepartment);
    if (href.params?.taskSort) query.set('task_date_sort', href.params.taskSort);
    const suffix = query.toString();
    return `/tasks${suffix ? `?${suffix}` : ''}`;
  }
  if (href.pathname === '/(shell)/tasks/create') return '/tasks/create';
  if (href.pathname === '/(shell)/tasks/analytics') return '/tasks?task_mode=analytics';
  if (href.pathname === '/(shell)/tasks/[taskId]') {
    return `/tasks/${encodeURIComponent(href.params.taskId)}`;
  }
  if (href.pathname === '/(shell)/feed') return '/feed';
  if (href.pathname === '/(shell)/feed/[postId]') {
    const query = href.params.commentId
      ? `?post=${encodeURIComponent(href.params.postId)}#feed-comment-${encodeURIComponent(href.params.commentId)}`
      : `?post=${encodeURIComponent(href.params.postId)}`;
    return `/feed${query}`;
  }
  if (href.pathname === '/(shell)/mail') {
    const query = new URLSearchParams();
    if (href.params?.mailboxId) query.set('mailboxId', href.params.mailboxId);
    if (href.params?.folder) query.set('folder', href.params.folder);
    if (href.params?.q) query.set('q', href.params.q);
    if (href.params?.view) query.set('view', href.params.view);
    if (href.params?.unreadOnly) query.set('unread_only', href.params.unreadOnly);
    if (href.params?.hasAttachments) query.set('has_attachments', href.params.hasAttachments);
    const suffix = query.toString();
    return `/mail${suffix ? `?${suffix}` : ''}`;
  }
  if (href.pathname === '/(shell)/mail/[messageId]') {
    const query = new URLSearchParams();
    if (href.params.mailboxId) query.set('mailboxId', href.params.mailboxId);
    if (href.params.folder) query.set('folder', href.params.folder);
    const suffix = query.toString();
    return `/mail/${encodeURIComponent(href.params.messageId)}${suffix ? `?${suffix}` : ''}`;
  }
  if (href.pathname === '/(shell)/mail/conversation/[conversationId]') {
    const query = new URLSearchParams();
    if (href.params.mailboxId) query.set('mailboxId', href.params.mailboxId);
    if (href.params.folder) query.set('folder', href.params.folder);
    const suffix = query.toString();
    return `/mail/conversation/${encodeURIComponent(href.params.conversationId)}${suffix ? `?${suffix}` : ''}`;
  }
  if (href.pathname === '/(shell)/mail/compose') {
    const query = new URLSearchParams();
    query.set('mode', href.params.mode || 'new');
    if (href.params.draftId) query.set('draftId', href.params.draftId);
    if (href.params.mailboxId) query.set('mailboxId', href.params.mailboxId);
    if (href.params.sourceMessageId) query.set('sourceMessageId', href.params.sourceMessageId);
    if (href.params.to) query.set('to', href.params.to);
    if (href.params.subject) query.set('subject', href.params.subject);
    return `/mail/compose?${query.toString()}`;
  }
  if (href.pathname === '/(shell)/database') {
    const query = new URLSearchParams();
    if (href.params?.q) query.set('q', href.params.q);
    if (href.params?.mode) query.set('mode', href.params.mode);
    const suffix = query.toString();
    return `/database${suffix ? `?${suffix}` : ''}`;
  }
  if (href.pathname === '/(shell)/database/[invNo]') {
    const query = new URLSearchParams();
    if (href.params.databaseId) query.set('databaseId', href.params.databaseId);
    if (href.params.tab) query.set('tab', href.params.tab);
    const suffix = query.toString();
    return `/database/${encodeURIComponent(href.params.invNo)}${suffix ? `?${suffix}` : ''}`;
  }
  if (href.pathname === '/(shell)/my-files') return '/my-files';
  if (href.pathname === '/(shell)/company-structure') {
    const query = new URLSearchParams();
    if (href.params?.nodeId) query.set('nodeId', href.params.nodeId);
    if (href.params?.blockId) query.set('blockId', href.params.blockId);
    const suffix = query.toString();
    return `/company-structure${suffix ? `?${suffix}` : ''}`;
  }
  if (href.pathname === '/(shell)/docflow') return '/docflow';
  if (href.pathname === '/(shell)/docflow/[taskRef]') {
    // The web client has no stable task-detail route contract yet. Keep the
    // internal native detail address private and canonicalize portal fallback
    // to the only public route that the web application guarantees.
    return '/docflow';
  }
  if (href.pathname === '/(shell)/scan-center') return '/scan-center';
  if (href.pathname === '/(shell)/computers') {
    const q = href.params?.q;
    return q ? `/computers?q=${encodeURIComponent(q)}` : '/computers';
  }
  if (href.pathname === '/(shell)/passwords') return '/passwords';
  if (href.pathname === '/(shell)/groups-access') return '/groups-access';
  if (href.pathname === '/(shell)/warehouse-1c') return '/warehouse-1c';
  if (href.pathname === '/(shell)/mfu') return '/mfu';
  if (href.pathname === '/(shell)/chat') return '/chat';
  if (href.pathname === '/(shell)/chat/[conversationId]') {
    const query = href.params.messageId
      ? `?message=${encodeURIComponent(href.params.messageId)}`
      : '';
    return `/chat/${encodeURIComponent(href.params.conversationId)}${query}`;
  }
  return href.pathname.replace('/(shell)', '');
}

export function routePathForPortalPath(
  path: string,
): string {
  return routePathFromHref(hrefForPortalPath(path));
}

export function openPortalPath(path: string): void {
  const href = hrefForPortalPath(path);
  router.navigate(href as never);
}

export function openNativeNotifications(): void {
  if (NATIVE_NOTIFICATIONS_ENABLED) {
    router.navigate('/(shell)/notifications' as never);
    return;
  }
  router.navigate('/(shell)/dashboard' as never);
}
