import { Badge } from '@mui/material';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import NotificationsOutlinedIcon from '@mui/icons-material/NotificationsOutlined';
import ViewCompactAltRoundedIcon from '@mui/icons-material/ViewCompactAltRounded';
import OpenInFullRoundedIcon from '@mui/icons-material/OpenInFullRounded';
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

// Свёрнутая лента папок — как folders-sidebar в Telegram Web K
// (foldersSidebarContent): вертикальный ряд иконок-вкладок размером с
// action-кнопку, активная подсвечена, бейдж непрочитанных у каждой,
// скролл без скроллбара при переполнении.
function CollapsedFolderRail({ items }) {
  return (
    <div
      role="tablist"
      aria-label="Папки чатов"
      className="chat-scroll-hidden flex max-h-[38vh] flex-col items-center gap-1 overflow-y-auto py-0.5"
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          title={item.label}
          aria-label={item.label}
          aria-selected={item.active}
          onClick={item.onClick}
          className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition duration-100 active:scale-[0.96] active:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--chat-focus-ring)]"
          style={{
            backgroundColor: item.active ? 'var(--chat-folder-tab-active-bg)' : 'var(--chat-header-action-bg)',
            color: item.active ? 'var(--chat-folder-tab-active-text)' : 'var(--chat-sidebar-action-text)',
          }}
        >
          {item.icon}
          {item.unread > 0 ? (
            <span
              data-chat-folder-unread-badge="true"
              aria-label={`Непрочитанных сообщений: ${item.unread}`}
              className="absolute -top-0.5 right-0 inline-flex min-w-[14px] items-center justify-center rounded-full px-0.5 align-middle text-[9px] font-bold leading-none"
              style={{
                minWidth: 14,
                height: 14,
                backgroundColor: item.active ? 'var(--chat-folder-tab-active-badge-bg)' : 'var(--chat-unread-bg)',
                color: item.active ? 'var(--chat-folder-tab-active-badge-text)' : 'var(--chat-unread-text)',
              }}
            >
              {item.unread > 99 ? '99+' : item.unread}
            </span>
          ) : null}
        </button>
      ))}
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
  railFolders = [],
  onOpenFolderManager,
}) {
  const { collapsed, compact, setCollapsed, setMode } = useChatSidebarSizing();
  const shell = useMainLayoutShell();
  const shellActions = shell.headerMode === 'hidden';
  const menuAction = shellActions && !shell.sidebarPinned;
  const expand = () => setCollapsed?.(false);
  const action = (title, onClick, icon, disabled = false) => (
    <SidebarActionButton title={title} onClick={onClick} disabled={disabled} ui={ui}>{icon}</SidebarActionButton>
  );

  if (collapsed) {
    // Рейл как folders-sidebar у Telegram: сверху меню и развернуть, затем
    // поиск, далее вертикальная лента иконок папок с бейджами, снизу
    // управление папками (слот «equalizer») и уведомления. Новый чат —
    // плавающий FAB поверх аватарок, как в Telegram.
    return (
      <div data-testid="chat-sidebar-desktop-header" className="flex flex-col items-center gap-1 py-2">
        {menuAction ? action('Открыть главное меню', shell.openDrawer, <MenuRoundedIcon fontSize="small" />) : null}
        {action('Развернуть список чатов', expand, <ChevronRightRoundedIcon fontSize="small" />)}
        {action('Поиск чатов', onSearch, <SearchRoundedIcon fontSize="small" />)}
        {railFolders.length > 0 ? <CollapsedFolderRail items={railFolders} /> : null}
        {typeof onOpenFolderManager === 'function'
          ? action('Управление папками', () => onOpenFolderManager(), <SettingsOutlinedIcon fontSize="small" />)
          : null}
        {shellActions && shell.showNotificationsButton ? action('Уведомления', shell.openNotifications,
          <Badge badgeContent={shell.notificationsBadgeValue} color="error" max={99}><NotificationsOutlinedIcon fontSize="small" /></Badge>) : null}
      </div>
    );
  }

  const searchHeight = Number(ui?.density?.sidebarSearchHeight) || 42;
  return (
    <div data-testid="chat-sidebar-desktop-header" className="mb-1.5 min-w-0">
      {/* Д2: ряд «☰ + поиск-пилюля» как в Telegram Web A */}
      <div className="flex min-w-0 items-center gap-1">
        {menuAction ? action('Открыть главное меню', shell.openDrawer, <MenuRoundedIcon fontSize="small" />) : null}
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
        {shellActions && shell.showNotificationsButton && !compact ? action('Уведомления', shell.openNotifications,
          <Badge badgeContent={shell.notificationsBadgeValue} color="error" max={99}><NotificationsOutlinedIcon fontSize="small" /></Badge>) : null}
        {setMode && compact ? action('Развернуть список чатов', () => setMode('expanded'), <OpenInFullRoundedIcon fontSize="small" />) : null}
        {setMode && !compact ? action('Компактный список чатов', () => setMode('compact'), <ViewCompactAltRoundedIcon fontSize="small" />) : null}
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
