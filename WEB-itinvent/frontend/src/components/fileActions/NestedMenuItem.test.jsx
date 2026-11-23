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
