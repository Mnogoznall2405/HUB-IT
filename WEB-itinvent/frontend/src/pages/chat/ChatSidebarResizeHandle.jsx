import { useRef } from 'react';
import { Box } from '@mui/material';
import { CHAT_SIDEBAR_MIN, CHAT_SIDEBAR_DEFAULT } from './chatSidebarSizing';

export default function ChatSidebarResizeHandle({ width, maxWidth, onWidthChange, onCollapse }) {
  const drag = useRef(null);
  const changeWidth = (next) => onWidthChange(Math.min(maxWidth, Math.max(CHAT_SIDEBAR_MIN, next)));
  return (
    <Box
      role="separator"
      aria-label="Ширина списка чатов"
      aria-orientation="vertical"
      aria-valuemin={CHAT_SIDEBAR_MIN}
      aria-valuemax={maxWidth}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = { x: event.clientX, width };
      }}
      onPointerMove={(event) => {
        if (drag.current) changeWidth(drag.current.width + event.clientX - drag.current.x);
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }}
      onDoubleClick={() => changeWidth(CHAT_SIDEBAR_DEFAULT)}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return;
        event.preventDefault();
        if (event.key === 'Enter') onCollapse(true);
        else changeWidth(event.key === 'Home' ? CHAT_SIDEBAR_MIN : event.key === 'End' ? maxWidth : width + (event.key === 'ArrowLeft' ? -16 : 16));
      }}
      sx={{
        position: 'absolute', right: -4, top: 0, bottom: 0, width: 8, zIndex: 4,
        cursor: 'col-resize', touchAction: 'none',
        '&:hover, &:focus-visible': { bgcolor: 'primary.main', opacity: 0.55, outline: 'none' },
      }}
    />
  );
}
