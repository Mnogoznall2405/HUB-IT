import { useCallback, useRef, useState } from 'react';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { Box, ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material';

const SUBMENU_MIN_WIDTH = 200;

// A menu row that opens a secondary flyout menu anchored to its side.
// Open/close is controlled by the parent menu through `openSubmenu`/`onOpenSubmenu`
// so that hovering a sibling row collapses the previous flyout, while moving the
// pointer into the flyout itself keeps it open.
export default function NestedMenuItem({
  id,
  openSubmenu,
  onOpenSubmenu,
  label,
  icon = null,
  disabled = false,
  dense = false,
  testId = '',
  children,
}) {
  const itemRef = useRef(null);
  const [flipLeft, setFlipLeft] = useState(false);
  // Mount the flyout lazily: before the first open there is no anchor yet and
  // a mounted-but-closed Menu warns about `anchorEl === undefined`.
  const [everOpened, setEverOpened] = useState(false);
  const open = openSubmenu === id;

  const openSub = useCallback(() => {
    const rect = itemRef.current?.getBoundingClientRect?.();
    if (rect && rect.right + SUBMENU_MIN_WIDTH + 16 > window.innerWidth) {
      setFlipLeft(true);
    } else {
      setFlipLeft(false);
    }
    setEverOpened(true);
    onOpenSubmenu?.(id);
  }, [id, onOpenSubmenu]);

  const closeSub = useCallback(() => {
    onOpenSubmenu?.(null);
  }, [onOpenSubmenu]);

  const focusSelf = useCallback(() => {
    itemRef.current?.focus?.();
  }, []);

  return (
    <>
      <MenuItem
        ref={itemRef}
        data-testid={testId || undefined}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseEnter={openSub}
        onClick={(event) => {
          // Tap/click toggles the flyout instead of closing the whole menu.
          event.stopPropagation();
          if (open) closeSub();
          else openSub();
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            openSub();
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
