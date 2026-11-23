import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ListItemText, Menu, MenuItem } from '@mui/material';

import NestedMenuItem from './NestedMenuItem';

function HostMenu() {
  const [openSubmenu, setOpenSubmenu] = useState('');
  return (
    <Menu open anchorPosition={{ left: 10, top: 10 }} onClose={() => {}}>
      <NestedMenuItem
        id="share"
        openSubmenu={openSubmenu}
        onOpenSubmenu={setOpenSubmenu}
        label="Поделиться"
        testId="group-share"
      >
        <MenuItem><ListItemText>Копировать ссылку</ListItemText></MenuItem>
      </NestedMenuItem>
      <NestedMenuItem
        id="organize"
        openSubmenu={openSubmenu}
        onOpenSubmenu={setOpenSubmenu}
        label="Организовать"
        testId="group-organize"
      >
        <MenuItem><ListItemText>Переименовать</ListItemText></MenuItem>
      </NestedMenuItem>
      <MenuItem>Удалить</MenuItem>
    </Menu>
  );
}

describe('NestedMenuItem', () => {
  it('opens the flyout on click and marks the parent item expanded', () => {
    render(<HostMenu />);
    const parent = screen.getByTestId('group-share');
    expect(parent).toHaveAttribute('aria-haspopup', 'menu');
    expect(parent).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Копировать ссылку')).not.toBeInTheDocument();

    fireEvent.click(parent);
    expect(parent).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Копировать ссылку')).toBeInTheDocument();

    // The flyout must not add its own backdrop — one backdrop (the parent's)
    // stays, so clicks on sibling parent rows still reach the parent menu.
    expect(document.querySelectorAll('.MuiBackdrop-root')).toHaveLength(1);
  });

  it('opens on ArrowRight/Enter and closes back to the parent on ArrowLeft/Escape', async () => {
    render(<HostMenu />);
    const parent = screen.getByTestId('group-organize');
    parent.focus();

    fireEvent.keyDown(parent, { key: 'ArrowRight' });
    expect(screen.getByText('Переименовать')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByText('Переименовать'), { key: 'ArrowLeft' });
    await waitFor(() => expect(screen.queryByText('Переименовать')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(parent);

    fireEvent.keyDown(parent, { key: 'Enter' });
    expect(screen.getByText('Переименовать')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByText('Переименовать'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Переименовать')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(parent);
  });

  it('hovering a sibling collapses the previous flyout instead of stacking menus', async () => {
    render(<HostMenu />);
    fireEvent.mouseEnter(screen.getByTestId('group-share'));
    expect(screen.getByText('Копировать ссылку')).toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByTestId('group-organize'));
    await waitFor(() => expect(screen.queryByText('Копировать ссылку')).not.toBeInTheDocument());
    expect(screen.getByText('Переименовать')).toBeInTheDocument();
  });

  it('a tap gesture (mouseenter + click) opens the flyout instead of flickering it', async () => {
    render(<HostMenu />);
    const parent = screen.getByTestId('group-share');
    // Touch browsers emulate mouseenter right before the click of the same
    // tap — opening on hover and instantly toggling closed was the bug.
    fireEvent.mouseEnter(parent);
    fireEvent.click(parent);
    expect(screen.getByText('Копировать ссылку')).toBeInTheDocument();

    // The NEXT tap toggles the flyout closed.
    fireEvent.click(parent);
    await waitFor(() => expect(screen.queryByText('Копировать ссылку')).not.toBeInTheDocument());
  });

  it('delays the switch while another flyout is open so a diagonal aim survives', async () => {
    render(<HostMenu />);
    fireEvent.mouseEnter(screen.getByTestId('group-share'));
    expect(screen.getByText('Копировать ссылку')).toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByTestId('group-organize'));
    // Switch is NOT immediate — a quick pass over the sibling does not tear
    // down the flyout the pointer is heading for.
    expect(screen.getByText('Копировать ссылку')).toBeInTheDocument();
    expect(screen.queryByText('Переименовать')).not.toBeInTheDocument();

    // Pointer keeps moving and leaves the sibling before the delay elapses —
    // the pending switch is cancelled, the open flyout stays.
    fireEvent.mouseLeave(screen.getByTestId('group-organize'));
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(screen.getByText('Копировать ссылку')).toBeInTheDocument();
    expect(screen.queryByText('Переименовать')).not.toBeInTheDocument();

    // Lingering on the sibling past the delay performs the switch.
    fireEvent.mouseEnter(screen.getByTestId('group-organize'));
    await waitFor(() => expect(screen.getByText('Переименовать')).toBeInTheDocument());
    expect(screen.queryByText('Копировать ссылку')).not.toBeInTheDocument();
  });

  it('never opens a flyout for a disabled group row', () => {
    render(
      <Menu open anchorPosition={{ left: 10, top: 10 }} onClose={() => {}}>
        <NestedMenuItem
          id="locked"
          openSubmenu=""
          onOpenSubmenu={() => {}}
          label="Недоступно"
          disabled
          testId="group-locked"
        >
          <MenuItem><ListItemText>Скрытый пункт</ListItemText></MenuItem>
        </NestedMenuItem>
      </Menu>,
    );
    const row = screen.getByTestId('group-locked');
    fireEvent.mouseEnter(row);
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: 'ArrowRight' });
    expect(screen.queryByText('Скрытый пункт')).not.toBeInTheDocument();
  });

  it('flips the flyout to the left when it would overflow the viewport', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
      return this.dataset?.testid === 'group-share'
        ? { right: 390, left: 200, top: 10, bottom: 50, width: 190, height: 40 }
        : { right: 390, left: 0, top: 0, bottom: 0, width: 390, height: 40 };
    });
    render(<HostMenu />);
    fireEvent.click(screen.getByTestId('group-share'));
    const popover = document.querySelector('.MuiPopover-root');
    expect(popover).toBeTruthy();
    vi.restoreAllMocks();
  });
});
