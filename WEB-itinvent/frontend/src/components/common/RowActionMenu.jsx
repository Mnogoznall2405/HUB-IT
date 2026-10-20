import { useCallback, useState } from 'react';
import { Menu } from '@mui/material';

import { renderActionMenuItems } from './ActionMenu';

// Клик по строке/карточке открывает меню действий у курсора (вместо колонки «⋮»).
// Клики по вложенным интерактивным элементам (чекбокс, ссылка на сотрудника,
// значки акта/фото) и выделение текста меню не открывают.
const INTERACTIVE_SELECTOR = 'a, button, input, textarea, select, label, [role="button"], [role="checkbox"], [role="menuitem"]';

export function useRowActionMenu(onAction) {
  const [state, setState] = useState(null);

  const open = useCallback((event, item, actions) => {
    if (!Array.isArray(actions) || actions.length === 0) return;
    const target = event.target;
    if (target?.closest?.(INTERACTIVE_SELECTOR) && target.closest(INTERACTIVE_SELECTOR) !== event.currentTarget) return;
    if (typeof window !== 'undefined' && String(window.getSelection?.() || '').length > 0) return;
    // Единственное действие (только просмотр) — без меню из одного пункта.
    if (actions.length === 1) {
      onAction?.(actions[0], item);
      return;
    }
    setState({ x: event.clientX, y: event.clientY, item, actions });
  }, [onAction]);

  // Enter/Space на сфокусированной строке — меню у её левого края.
  const openFromKeyboard = useCallback((event, item, actions) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    if (!Array.isArray(actions) || actions.length === 0) return;
    if (actions.length === 1) {
      onAction?.(actions[0], item);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setState({ x: rect.left + 24, y: rect.top + rect.height / 2, item, actions });
  }, [onAction]);

  const close = useCallback(() => setState(null), []);

  const menu = (
    <Menu
      open={Boolean(state)}
      onClose={close}
      anchorReference="anchorPosition"
      anchorPosition={state ? { top: state.y, left: state.x } : undefined}
      slotProps={{ paper: { sx: { minWidth: 200, backgroundImage: 'none' } } }}
    >
      {state
        ? renderActionMenuItems(state.actions, (actionType) => {
          const { item } = state;
          close();
          onAction?.(actionType, item);
        })
        : null}
    </Menu>
  );

  return { openRowMenu: open, openRowMenuFromKeyboard: openFromKeyboard, rowMenu: menu };
}

export default useRowActionMenu;
