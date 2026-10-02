import { Badge } from '@mui/material';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import CreateRoundedIcon from '@mui/icons-material/CreateRounded';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import NotificationsOutlinedIcon from '@mui/icons-material/NotificationsOutlined';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import { SidebarActionButton } from './ChatSidebarRows';
import { useChatSidebarSizing } from './ChatSidebarSizingContext';
import { useMainLayoutShell } from '../layout/MainLayoutShellContext';

// Д2-5 (п. 8): сегментный переключатель «Чаты / ИИ» — выбранная вкладка
// с явным фоном из токенов ui.workspaceTabActive* (тёмная тема — акцент
// #5288c1), счётчики непрочитанных внутри вкладки.
function WorkspaceTabs({ workspace, onWorkspaceChange, aiUnreadCount, chatsUnreadCount }) {
  return (
    <div
      role="tablist"
      aria-label="Разделы чата"
      className="mt-1.5 flex min-w-0 rounded-xl bg-[var(--chat-filter-strip-bg)] p-0.5"
    >
      {[['chats', 'Чаты'], ['ai', 'ИИ']].map(([key, label]) => {
        const tabUnread = Math.max(0, Number(key === 'ai' ? aiUnreadCount : chatsUnreadCount) || 0);
        const selected = workspace === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            title={label}
            aria-label={label}
            aria-selected={selected}
            onClick={() => onWorkspaceChange(key)}
            className="min-h-9 min-w-0 flex-1 rounded-lg px-1 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--chat-focus-ring)]"
            style={{
              backgroundColor: selected ? 'var(--chat-workspace-tab-active-bg)' : 'transparent',
              color: selected ? 'var(--chat-workspace-tab-active-text)' : 'var(--chat-text-secondary)',
            }}
          >
            {label}
            {tabUnread > 0 ? (
              <span
                data-chat-folder-unread-badge="true"
                aria-label={`Непрочитанных сообщений: ${tabUnread}`}
                className="ml-1 inline-flex min-w-[20px] items-center justify-center rounded-full px-1 align-middle text-[11px] font-bold leading-none"
                style={{
                  minWidth: 20,
                  height: 20,
                  backgroundColor: selected ? 'var(--chat-workspace-tab-active-badge-bg)' : 'var(--chat-unread-bg)',
                  color: selected ? 'var(--chat-workspace-tab-active-badge-text)' : 'var(--chat-unread-text)',
                }}
              >
                {tabUnread > 99 ? '99+' : tabUnread}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// Д2-5 (п. 5): тот же переключатель в свёрнутой узкой полосе списка —
// компактные иконки с бейджами, чтобы раздел не исчезал при узком списке.
function CollapsedWorkspaceTabs({ workspace, onWorkspaceChange, aiUnreadCount, chatsUnreadCount }) {
  return (
    <div
      role="tablist"
      aria-label="Разделы чата"
      className="col-span-2 mx-1 mb-1 flex rounded-[10px] bg-[var(--chat-filter-strip-bg)] p-0.5"
    >
      {[
        ['chats', 'Чаты', <ForumOutlinedIcon key="icon" sx={{ fontSize: 18 }} />],
        ['ai', 'ИИ', <SmartToyOutlinedIcon key="icon" sx={{ fontSize: 18 }} />],
      ].map(([key, label, icon]) => {
        const tabUnread = Math.max(0, Number(key === 'ai' ? aiUnreadCount : chatsUnreadCount) || 0);
        const selected = workspace === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            title={label}
            aria-label={label}
            aria-selected={selected}
            onClick={() => onWorkspaceChange(key)}
            className="relative flex min-h-8 min-w-0 flex-1 items-center justify-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--chat-focus-ring)]"
            style={{
              backgroundColor: selected ? 'var(--chat-workspace-tab-active-bg)' : 'transparent',
              color: selected ? 'var(--chat-workspace-tab-active-text)' : 'var(--chat-text-secondary)',
            }}
          >
            {icon}
            {tabUnread > 0 ? (
              <span
                data-chat-folder-unread-badge="true"
                aria-label={`Непрочитанных сообщений: ${tabUnread}`}
                className="absolute -top-0.5 right-0 inline-flex min-w-[14px] items-center justify-center rounded-full px-0.5 align-middle text-[9px] font-bold leading-none"
                style={{
                  minWidth: 14,
                  height: 14,
                  backgroundColor: selected ? 'var(--chat-workspace-tab-active-badge-bg)' : 'var(--chat-unread-bg)',
                  color: selected ? 'var(--chat-workspace-tab-active-badge-text)' : 'var(--chat-unread-text)',
                }}
              >
                {tabUnread > 99 ? '99+' : tabUnread}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export default function ChatSidebarDesktopHeader({
  ui,
  workspace,
  showAiSection,
  onWorkspaceChange,
  onCreate,
  unavailable,
  onSearch,
  onCollapse,
  aiUnreadCount = 0,
  chatsUnreadCount = 0,
  search = null,
}) {
  const { collapsed, setCollapsed } = useChatSidebarSizing();
  const shell = useMainLayoutShell();
  const shellActions = shell.headerMode === 'hidden';
  const expand = () => setCollapsed?.(false);
  const action = (title, onClick, icon, disabled = false) => (
    <SidebarActionButton title={title} onClick={onClick} disabled={disabled} ui={ui}>{icon}</SidebarActionButton>
  );

  if (collapsed) {
    return (
      <div data-testid="chat-sidebar-desktop-header" className="grid grid-cols-2 justify-items-center py-2">
        {shellActions ? action('Открыть главное меню', shell.openDrawer, <MenuRoundedIcon fontSize="small" />) : null}
        {action('Разделы и папки чатов', expand, <FolderOutlinedIcon fontSize="small" />)}
        {showAiSection ? (
          <CollapsedWorkspaceTabs
            workspace={workspace}
            onWorkspaceChange={onWorkspaceChange}
            aiUnreadCount={aiUnreadCount}
            chatsUnreadCount={chatsUnreadCount}
          />
        ) : null}
        {action('Поиск чатов', onSearch, <SearchRoundedIcon fontSize="small" />)}
        {action(workspace === 'ai' ? 'Новый AI-чат' : 'Новый чат', onCreate, <CreateRoundedIcon fontSize="small" />, unavailable)}
        {shellActions && shell.showNotificationsButton ? action('Уведомления', shell.openNotifications,
          <Badge badgeContent={shell.notificationsBadgeValue} color="error" max={99}><NotificationsOutlinedIcon fontSize="small" /></Badge>) : null}
        {setCollapsed ? action('Развернуть список чатов', expand, <ChevronRightRoundedIcon fontSize="small" />) : null}
      </div>
    );
  }

  const searchHeight = Number(ui?.density?.sidebarSearchHeight) || 42;
  return (
    <div data-testid="chat-sidebar-desktop-header" className="mb-1.5 min-w-0">
      {/* Д2: ряд «☰ + поиск-пилюля» как в Telegram Web A */}
      <div className="flex min-w-0 items-center gap-1">
        {shellActions ? action('Открыть главное меню', shell.openDrawer, <MenuRoundedIcon fontSize="small" />) : null}
        {search ? (
          <div
            className="flex min-w-0 flex-1 items-center rounded-full border px-3 transition duration-150"
            style={{
              height: searchHeight,
              borderColor: search.focused ? 'transparent' : 'var(--chat-border-soft)',
              backgroundColor: search.focused ? 'var(--chat-sidebar-search-focus-bg)' : 'var(--chat-sidebar-search-bg)',
              boxShadow: search.focused ? '0 0 0 3px var(--chat-focus-ring)' : 'none',
            }}
          >
            <SearchRoundedIcon
              fontSize="small"
              sx={{ color: search.focused ? 'var(--chat-accent-text)' : 'var(--chat-text-secondary)' }}
            />
            <input
              ref={search.inputRef}
              aria-label={workspace === 'ai' ? 'Поиск по AI-диалогам' : 'Поиск чатов'}
              placeholder={workspace === 'ai' ? 'Поиск по AI-диалогам' : 'Поиск'}
              value={search.value || ''}
              onChange={(event) => search.onChange?.(event.target.value)}
              onFocus={search.onFocus}
              onBlur={search.onBlur}
              className="ml-2 h-full min-w-0 w-full bg-transparent text-[color:var(--chat-search-text)] placeholder:text-[color:var(--chat-search-placeholder)] outline-none"
              style={{ fontSize: ui?.density?.sidebarSearchFontSize || '14px' }}
            />
            <SidebarActionButton
              title="Действия"
              onClick={(event) => search.onOpenActions?.(event.currentTarget)}
              ui={ui}
              className="h-8 w-8 bg-transparent"
            >
              <MoreHorizRoundedIcon fontSize="small" />
            </SidebarActionButton>
          </div>
        ) : (
          !showAiSection
            ? <span className="min-w-0 flex-1 font-semibold text-[color:var(--chat-text-strong)]">Чаты</span>
            : <span className="min-w-0 flex-1" />
        )}
        {shellActions && shell.showNotificationsButton ? action('Уведомления', shell.openNotifications,
          <Badge badgeContent={shell.notificationsBadgeValue} color="error" max={99}><NotificationsOutlinedIcon fontSize="small" /></Badge>) : null}
        {setCollapsed ? action('Свернуть список чатов', onCollapse, <ChevronLeftRoundedIcon fontSize="small" />) : null}
      </div>
      {showAiSection ? (
        <WorkspaceTabs
          workspace={workspace}
          onWorkspaceChange={onWorkspaceChange}
          aiUnreadCount={aiUnreadCount}
          chatsUnreadCount={chatsUnreadCount}
        />
      ) : null}
    </div>
  );
}
