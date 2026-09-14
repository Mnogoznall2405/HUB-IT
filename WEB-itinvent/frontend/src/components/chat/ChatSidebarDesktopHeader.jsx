import { Badge } from '@mui/material';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import CreateRoundedIcon from '@mui/icons-material/CreateRounded';
import NotificationsOutlinedIcon from '@mui/icons-material/NotificationsOutlined';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import { SidebarActionButton } from './ChatSidebarRows';
import { useChatSidebarSizing } from './ChatSidebarSizingContext';
import { useMainLayoutShell } from '../layout/MainLayoutShellContext';

export default function ChatSidebarDesktopHeader({ ui, workspace, showAiSection, onWorkspaceChange, onCreate, unavailable, onSearch, onCollapse }) {
  const { collapsed, setCollapsed } = useChatSidebarSizing();
  const shell = useMainLayoutShell();
  const shellActions = shell.headerMode === 'hidden';
  const expand = () => setCollapsed?.(false);
  const action = (title, onClick, icon, disabled = false) => (
    <SidebarActionButton title={title} onClick={onClick} disabled={disabled} ui={ui}>{icon}</SidebarActionButton>
  );
  return (
    <div data-testid="chat-sidebar-desktop-header" className={collapsed ? 'grid grid-cols-2 justify-items-center py-2' : 'mb-2 flex min-w-0 items-center gap-1'}>
      {shellActions ? action('Открыть главное меню', shell.openDrawer, <MenuRoundedIcon fontSize="small" />) : null}
      {!collapsed ? (
        showAiSection ? (
          <div role="tablist" aria-label="Раздел чата" className="flex min-w-0 flex-1 rounded-xl bg-[var(--chat-filter-strip-bg)] p-0.5">
            {[['chats', 'Чаты'], ['ai', 'ИИ']].map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={workspace === key} onClick={() => onWorkspaceChange(key)}
                className="min-h-9 min-w-0 flex-1 rounded-lg px-1 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--chat-focus-ring)]"
                style={{ backgroundColor: workspace === key ? 'var(--chat-folder-tab-active-bg)' : 'transparent', color: workspace === key ? 'var(--chat-folder-tab-active-text)' : 'var(--chat-text-secondary)' }}>
                {label}
              </button>
            ))}
          </div>
        ) : <span className="min-w-0 flex-1 font-semibold text-[color:var(--chat-text-strong)]">Чаты</span>
      ) : action('Разделы и папки чатов', expand, <FolderOutlinedIcon fontSize="small" />)}
      {collapsed ? action('Поиск чатов', onSearch, <SearchRoundedIcon fontSize="small" />) : null}
      {action(workspace === 'ai' ? 'Новый AI-чат' : 'Новый чат', onCreate, <CreateRoundedIcon fontSize="small" />, unavailable)}
      {shellActions && shell.showNotificationsButton ? action('Уведомления', shell.openNotifications,
        <Badge badgeContent={shell.notificationsBadgeValue} color="error" max={99}><NotificationsOutlinedIcon fontSize="small" /></Badge>) : null}
      {setCollapsed ? action(collapsed ? 'Развернуть список чатов' : 'Свернуть список чатов', collapsed ? expand : onCollapse,
        collapsed ? <ChevronRightRoundedIcon fontSize="small" /> : <ChevronLeftRoundedIcon fontSize="small" />) : null}
    </div>
  );
}
