import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatPageDesktopLayout from './ChatPageDesktopLayout';
import ChatSidebar from '../../components/chat/ChatSidebar';
import { buildChatUiTokens } from '../../components/chat/chatUiTokens';
import { MainLayoutShellContext } from '../../components/layout/MainLayoutShellContext';
import { readSidebarLayout } from './chatSidebarSizing';

const theme = createTheme();
const ui = buildChatUiTokens(theme, { compactDesktop: true });
const openNotifications = vi.fn();
const openDrawer = vi.fn();
const createChat = vi.fn();
const conversation = {
  id: 'peer', kind: 'direct', title: 'Николаев Михаил Сергеевич', unread_count: 5,
  last_message_preview: 'Вы: Проверить компоновку', last_message_at: '2026-09-14T09:00:00Z',
  direct_peer: { presence: { is_online: true } },
};
function Harness({ mobile = false, persistent = false }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState('');
  const sidebar = <ChatSidebar theme={theme} ui={ui} isMobile={mobile} compactMobile={mobile}
    user={{ full_name: 'Собственное ФИО' }} unreadTotal={5} health={{ available: true }}
    sidebarQuery={query} onSidebarQueryChange={setQuery} searchPeople={[]} searchChats={[]}
    activeConversationId={active} onOpenConversation={setActive} conversations={[conversation]}
    onOpenGroup={createChat} activeFolderKey="personal" onActiveFolderChange={() => {}} showAiSection />;
  return <ThemeProvider theme={theme}>
    <MainLayoutShellContext.Provider value={{ headerMode: 'hidden', openNotifications, openDrawer, showNotificationsButton: true, notificationsBadgeValue: 3 }}>
      <ChatPageDesktopLayout isMobile={mobile} isPhone={mobile} theme={theme} ui={ui} sidebarPane={sidebar}
        threadPane={<div>Переписка: {active}</div>} renderDesktopRightPanel={persistent} renderPersistentRightPanel={persistent}
        desktopRightPanelContent={<div>Информация о чате</div>} resolvedMobileView="inbox" mobileMotionDisabled />
    </MainLayoutShellContext.Provider>
  </ThemeProvider>;
}

beforeEach(() => { window.localStorage.clear(); vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('resizable chat sidebar', () => {
  it('keeps one workspace title and exposes shell actions in the integrated header', async () => {
    render(<Harness />);
    expect(screen.getAllByText('Чаты')).toHaveLength(1);
    expect(screen.queryByText('Собственное ФИО')).not.toBeInTheDocument();
    expect(screen.getByText('Вы: Проверить компоновку')).toBeInTheDocument();
    expect(screen.queryByText(/В сети/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Уведомления' }));
    fireEvent.click(screen.getByRole('button', { name: 'Открыть главное меню' }));
    // Д2: «Новый чат» живёт в меню «Действия» рядом с поиск-пилюлей.
    fireEvent.click(screen.getByRole('button', { name: 'Действия' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Новый чат' }));
    expect(openNotifications).toHaveBeenCalledOnce();
    expect(openDrawer).toHaveBeenCalledOnce();
    expect(createChat).toHaveBeenCalledOnce();
  });

  it('preserves width and collapse across remount; rail keeps identity, unread, selection and search', async () => {
    const first = render(<Harness />);
    const separator = screen.getByRole('separator', { name: 'Ширина списка чатов' });
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    // Д1: ширина по умолчанию 420, шаг клавиатуры 16 → 436.
    expect(separator).toHaveAttribute('aria-valuenow', '436');
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть список чатов' }));
    const row = screen.getByRole('button', { name: /Николаев Михаил Сергеевич, непрочитанных: 5/ });
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Переписка: peer')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    first.unmount();
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Развернуть список чатов' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Поиск чатов' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Поиск чатов' })).toHaveFocus());
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '436');
  });

  it('clamps keyboard resize, resets by double click and collapses with Enter', () => {
    render(<Harness />);
    const separator = screen.getByRole('separator');
    // Д1: эталонная геометрия сайдбара — 420 по умолчанию; Д2-5 — диапазон 260–520.
    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator).toHaveAttribute('aria-valuenow', '520');
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute('aria-valuenow', '520');
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator).toHaveAttribute('aria-valuenow', '260');
    fireEvent.doubleClick(separator);
    expect(separator).toHaveAttribute('aria-valuenow', '420');
    fireEvent.keyDown(separator, { key: 'Enter' });
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('uses an overlay when three columns cannot fit and lets narrow-window users expand search', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 800, left: 0, right: 600, top: 0, bottom: 800 });
    render(<Harness persistent />);
    expect(screen.getByTestId('chat-desktop-right-panel-overlay')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-desktop-right-panel-persistent')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Поиск чатов' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Поиск чатов' })).toHaveFocus());
  });

  it('keeps folder tabs in the collapsed rail — Telegram folders-sidebar', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть список чатов' }));
    const personalTab = screen.getByRole('tab', { name: 'Личные' });
    const aiTab = screen.getByRole('tab', { name: 'ИИ' });
    expect(personalTab).toHaveAttribute('aria-selected', 'true');
    expect(aiTab).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(aiTab);
    expect(aiTab).toHaveAttribute('aria-selected', 'true');
    expect(personalTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('button', { name: 'Развернуть список чатов' })).toBeInTheDocument();
  });

  it('does not apply stored desktop collapse to mobile', () => {
    window.localStorage.setItem('hub.chat.sidebarLayout', JSON.stringify({ width: 410, collapsed: true }));
    render(<Harness mobile />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Развернуть список чатов' })).not.toBeInTheDocument();
  });

  it('pointer drag reaches compact below min and expands back', () => {
    const previewHidden = () => screen.getByText('Вы: Проверить компоновку').closest('[hidden]') !== null;
    // jsdom не знает PointerEvent — шлём MouseEvent нужного типа: хэндлеры те же.
    const pointer = (el, type, init = {}) =>
      fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));
    render(<Harness />);
    const separator = screen.getByRole('separator');
    // 420 + (150 - 400) = 170 < 260 → compact, превью прячется.
    pointer(separator, 'pointerdown', { clientX: 400 });
    pointer(separator, 'pointermove', { clientX: 150 });
    pointer(separator, 'pointerup');
    expect(previewHidden()).toBe(true);
    // Ручка жива в compact: обратный драг 176 + (400 - 200) = 376 → expanded.
    const sep2 = screen.getByRole('separator');
    pointer(sep2, 'pointerdown', { clientX: 200 });
    pointer(sep2, 'pointermove', { clientX: 400 });
    pointer(sep2, 'pointerup');
    expect(previewHidden()).toBe(false);
  });

  it('keyboard: ArrowLeft below min enters compact, again collapses to rail, ArrowRight restores', () => {
    render(<Harness />);
    const previewHidden = () => screen.getByText('Вы: Проверить компоновку').closest('[hidden]') !== null;
    const separator = screen.getByRole('separator');
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator).toHaveAttribute('aria-valuenow', '260');
    // 260 - 16 = 244 < min → compact; ещё ArrowLeft в compact → rail.
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(previewHidden()).toBe(true);
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowLeft' });
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Развернуть список чатов' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть список чатов' }));
    const sep2 = screen.getByRole('separator');
    fireEvent.keyDown(sep2, { key: 'Home' });
    fireEvent.keyDown(sep2, { key: 'ArrowLeft' });
    expect(previewHidden()).toBe(true);
    // compact → ArrowRight стартует expanded с минимальной ширины.
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
    expect(previewHidden()).toBe(false);
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '260');
  });

  it('compact mode keeps avatar+name rows, hides preview and persists across remount', () => {
    const first = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Компактный список чатов' }));
    // Имя видно в компакт-блоке; дубль внутри скрытого expanded-блока не в счёт.
    const visibleNames = () => screen.getAllByText('Николаев Михаил Сергеевич')
      .filter((node) => !node.closest('[hidden]'));
    expect(visibleNames()).toHaveLength(1);
    expect(screen.getByText('Вы: Проверить компоновку').closest('[hidden]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть список чатов' }));
    expect(screen.getByText('Вы: Проверить компоновку').closest('[hidden]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Компактный список чатов' }));
    first.unmount();
    render(<Harness />);
    expect(visibleNames()).toHaveLength(1);
    expect(screen.getByText('Вы: Проверить компоновку').closest('[hidden]')).not.toBeNull();
  });

  it('survives unavailable and malformed storage', () => {
    expect(readSidebarLayout({ getItem() { throw new Error('Blocked'); } })).toEqual({ width: 420, mode: 'expanded' });
    expect(readSidebarLayout({ getItem: () => 'null' })).toEqual({ width: 420, mode: 'expanded' });
    expect(readSidebarLayout({ getItem: () => '{"width":999,"collapsed":true}' })).toEqual({ width: 520, mode: 'collapsed' });
    expect(readSidebarLayout({ getItem: () => '{"width":300,"mode":"compact"}' })).toEqual({ width: 300, mode: 'compact' });
  });
});
