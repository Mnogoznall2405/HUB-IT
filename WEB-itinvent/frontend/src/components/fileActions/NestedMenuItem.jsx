import { useCallback, useEffect, useRef, useState } from 'react';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { Box, ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material';

const SUBMENU_MIN_WIDTH = 200;

// When a flyout is already open, the pointer has this long to cross a sibling
// row diagonally on its way into the flyout before the switch actually happens.
export const SUBMENU_SWITCH_DELAY_MS = 200;

// A tap on touch devices fires pointer/mouseenter and then click for a single
// gesture. Within this window an open triggered by that emulated mouseenter is
// treated as "opened by the tap", so the click keeps the flyout open instead of
// instantly toggling it shut.
const TAP_OPEN_GRACE_MS = 700;

// A menu row that opens a secondary flyout menu anchored to its side.
// Open/close is controlled by the parent menu through `openSubmenu`/`onOpenSubmenu`
// so that hovering a sibling row collapses the previous flyout, while moving the
// pointer into the flyout itself keeps it open.
export default function NestedMenuItem({
  id,
  openSubmenu,
  onOpenSubmenu,
  onSubmenuEnter = null,
  label,
  icon = null,
  disabled = false,
  dense = false,
  testId = '',
  children,
}) {
  const itemRef = useRef(null);
  const switchTimerRef = useRef(null);
  const openMetaRef = useRef({ via: '', at: 0 });
  const [flipLeft, setFlipLeft] = useState(false);
  // Mount the flyout lazily: before the first open there is no anchor yet and
  // a mounted-but-closed Menu warns about `anchorEl === undefined`.
  const [everOpened, setEverOpened] = useState(false);
  const open = openSubmenu === id;

  const clearSwitchTimer = useCallback(() => {
    if (switchTimerRef.current) {
      clearTimeout(switchTimerRef.current);
      switchTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearSwitchTimer, [clearSwitchTimer]);

  const openSub = useCallback((via) => {
    if (disabled) return;
    const rect = itemRef.current?.getBoundingClientRect?.();
    if (rect && rect.right + SUBMENU_MIN_WIDTH + 16 > window.innerWidth) {
      setFlipLeft(true);
    } else {
      setFlipLeft(false);
    }
    setEverOpened(true);
    openMetaRef.current = { via, at: Date.now() };
    onOpenSubmenu?.(id);
  }, [disabled, id, onOpenSubmenu]);

  const closeSub = useCallback(() => {
    onOpenSubmenu?.(null);
  }, [onOpenSubmenu]);

  const focusSelf = useCallback(() => {
    itemRef.current?.focus?.();
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (disabled) return;
    if (open) {
      // Pointer returned to the row whose flyout is open — counts as being
      // "inside" the submenu, so a pending close from a crossed leaf cancels.
      onSubmenuEnter?.();
      return;
    }
    if (openSubmenu) {
      // Another flyout is open: delay the switch so a diagonal move towards
      // the open flyout does not tear it down mid-gesture.
      clearSwitchTimer();
      switchTimerRef.current = setTimeout(() => {
        switchTimerRef.current = null;
        openSub('hover');
      }, SUBMENU_SWITCH_DELAY_MS);
      return;
    }
    openSub('hover');
  }, [disabled, open, openSubmenu, onSubmenuEnter, clearSwitchTimer, openSub]);

  return (
    <>
      <MenuItem
        ref={itemRef}
        data-testid={testId || undefined}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={clearSwitchTimer}
        onClick={(event) => {
          // Tap/click toggles the flyout instead of closing the whole menu.
          event.stopPropagation();
          if (disabled) return;
          clearSwitchTimer();
          const { via, at } = openMetaRef.current;
          if (open && via === 'hover' && Date.now() - at < TAP_OPEN_GRACE_MS) {
            // Same tap gesture: the emulated mouseenter already opened the
            // flyout — keep it open; the next tap toggles it closed.
            openMetaRef.current = { via: 'click', at: Date.now() };
            return;
          }
          if (open) closeSub();
          else openSub('click');
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === 'ArrowRight' || event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            openSub('key');
          }
        }}
        sx={{ minHeight: dense ? 36 : 40 }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: 1 }}>
          {icon ? <ListItemIcon>{icon}</ListItemIcon> : null}
          <ListItemText>{label}</ListItemText>
        </Box>
        <ChevronRightRoundedIcon fontSize="small" sx={{ ml: 1.5, color: 'text.secondary', flex: '0 0 auto' }} />
      </MenuItem>
      {everOpened ? (
      <Menu
        open={open}
        anchorEl={itemRef.current}
        onClose={closeSub}
        // The flyout adds neither a backdrop nor a hit target: the modal root
        // covers the viewport, so pointer-events must pass through it to the
        // parent menu (sibling rows stay clickable/hoverable). Outside clicks
        // land on the parent menu's backdrop and close everything. `sx` lands
        // on the Popover (modal) root.
        hideBackdrop
        disableScrollLock
        sx={{ pointerEvents: 'none' }}
        anchorOrigin={{ vertical: 'top', horizontal: flipLeft ? 'left' : 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: flipLeft ? 'right' : 'left' }}
        MenuListProps={{
          'aria-label': label,
          onKeyDown: (event) => {
            if (event.key === 'ArrowLeft' || event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              closeSub();
              focusSelf();
            }
          },
        }}
        PaperProps={{
          onMouseEnter: () => onSubmenuEnter?.(),
          sx: {
            pointerEvents: 'auto',
            minWidth: SUBMENU_MIN_WIDTH,
            mt: -0.5,
            ml: flipLeft ? -0.5 : 0.5,
            mr: flipLeft ? 0.5 : undefined,
            borderRadius: '10px',
            boxShadow: '0 14px 36px rgba(2, 6, 23, 0.24)',
          },
        }}
      >
        {children}
      </Menu>
      ) : null}
    </>
  );
}
