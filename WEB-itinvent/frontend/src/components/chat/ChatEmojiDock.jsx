import { Suspense, lazy, memo, useLayoutEffect, useRef, useState } from 'react';
import { Box, CircularProgress, IconButton, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';

const LazyChatEmojiPanel = lazy(() => import('./ChatEmojiPanel'));

// Режим дока выбирается по ФАКТИЧЕСКОЙ ширине контейнера треда
// (`chat-thread-pane-wrap`), а не по viewport: sidebar, dock и правая
// инфо-панель отнимают место одновременно, и при фиксированном
// breakpoint переписка сжималась бы до нерабочей ширины.
// Колонка включается только если после дока остаётся >= MIN_THREAD_WIDTH
// для переписки — иначе overlay поверх колонки треда.
const DOCK_COLUMN_WIDTH = 360;
const MIN_THREAD_WIDTH = 470;
const DOCK_COLUMN_MIN_WRAP = DOCK_COLUMN_WIDTH + MIN_THREAD_WIDTH;

export const EMOJI_DOCK_LAYOUT = {
  columnWidth: DOCK_COLUMN_WIDTH,
  minThreadWidth: MIN_THREAD_WIDTH,
  minWrapWidthForColumn: DOCK_COLUMN_MIN_WRAP,
};

const dockFallback = (
  <Box sx={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
    <CircularProgress size={24} />
  </Box>
);

const ChatEmojiDock = memo(function ChatEmojiDock({
  theme,
  ui,
  currentUserId,
  onInsertEmoji,
  onSendSticker,
  onClose,
  hidden = false,
}) {
  const rootRef = useRef(null);
  const [asColumn, setAsColumn] = useState(false);
  const panelBg = ui.composerBg || ui.panelBg || theme.palette.background.paper;
  const borderColor = ui.borderSoft || theme.palette.divider;

  // Transition-guard при переключении видимости. Внутри пикера у
  // epr-header/epr-body (0.5s) и поискового input (0.2s) transition:all —
  // visibility входит в «all». Если переходы активны в момент смены
  // visibility, браузер стартует visibility-transition: на закрытие элемент
  // держится видимым до конца перехода (input кликабелен поверх переписки
  // ещё ~0.2-0.5 с), на открытие computed visibility остаётся hidden до
  // первого тика перехода — внутренности панели вспыхивали на 1-2 кадра
  // (~20-40 мс при джанке) позже самого дока (probe #88 v2). Поэтому на
  // сам коммит переключения переходы в поддереве гасятся полностью, а
  // guard снимается только после того, как смена visibility разрешена
  // в стили: обратной анимации возникнуть не может, в устоявшемся состоянии
  // все анимации пикера нетронуты.
  const [transitionGuard, setTransitionGuard] = useState(false);
  const [prevHidden, setPrevHidden] = useState(hidden);
  if (hidden !== prevHidden) {
    setPrevHidden(hidden);
    setTransitionGuard(true);
  }

  useLayoutEffect(() => {
    if (!transitionGuard) return undefined;
    // Принудительное разрешение стилей, пока переходы подавлены: смена
    // visibility фиксируется без transition у всех элементов поддерева.
    // Без этого шага снятие guard могло бы слиться с переключением в один
    // style recalc — и переход всё равно бы стартовал. Зависимость от hidden
    // обязательна: при быстром close→reopen в один кадр guard остаётся true
    // и эффект по нему не перезапустился бы — а устаревший rAF снял бы guard
    // до разрешения стилей повторного открытия.
    void rootRef.current?.offsetHeight;
    const raf = requestAnimationFrame(() => setTransitionGuard(false));
    return () => cancelAnimationFrame(raf);
  }, [hidden, transitionGuard]);

  useLayoutEffect(() => {
    const wrap = rootRef.current?.parentElement;
    if (!wrap) return undefined;
    const evaluate = () => {
      // Ширина wrap задаётся внешним flex-раскладом и не зависит от режима
      // дока — измерение не зацикливается на переключении column/overlay.
      setAsColumn(wrap.clientWidth >= DOCK_COLUMN_MIN_WRAP);
    };
    evaluate();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(evaluate);
      observer.observe(wrap);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', evaluate);
    return () => window.removeEventListener('resize', evaluate);
  }, []);

  return (
    <Box
      ref={rootRef}
      data-testid="chat-emoji-dock"
      data-layout={asColumn ? 'column' : 'overlay'}
      role="dialog"
      aria-label="Эмодзи и стикеры"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onClose?.();
      }}
      sx={{
        // Keep-alive: скрытие без display:none. display:none обнуляет layout
        // поддерева — при unhide emoji-picker-react заново прогонял каскад
        // виртуализации (scroll/IO/замеры размеров, ~2×1000 fibers по замерам
        // issue #88). visibility:hidden + вывод из flex-потока сохраняют
        // геометрию и скролл панели: при повторном открытии внутри пикера
        // не перерендеривается ничего, браузеру остаётся только paint.
        display: 'flex',
        visibility: hidden ? 'hidden' : 'visible',
        flexDirection: 'column',
        minHeight: 0,
        flexShrink: 0,
        bgcolor: panelBg,
        borderLeft: `1px solid ${borderColor}`,
        ...(hidden || transitionGuard
          ? {
              // У элементов emoji-picker-react transition:all (поисковый input,
              // epr-header/epr-body). При скрытии дока их унаследованная
              // visibility тоже анимировалась: transition к hidden держит
              // элемент видимым до конца перехода — input оставался
              // отрисованным и кликабельным поверх переписки на ~0.2-0.5 с
              // после закрытия (probe #88). Симметрично при открытии переход
              // держал бы элементы скрытыми до первого тика анимации
              // (~20-40 мс лага внутренностей панели, probe #88 v2). Поэтому
              // в скрытом состоянии visibility и переходы гасятся у всего
              // поддерева, а на сам коммит переключения guard держит переходы
              // погашенными, пока смена visibility не разрешится в стили.
              // В устоявшемся открытом состоянии правило не действует —
              // анимации пикера не тронуты.
              '& *': {
                ...(hidden ? { visibility: 'hidden !important' } : {}),
                transition: 'none !important',
              },
            }
          : {}),
        ...(asColumn
          ? {
              width: DOCK_COLUMN_WIDTH,
              ...(hidden
                ? {
                    // В column-режиме скрытый док выходит из flex-потока
                    // (переписка занимает всю ширину), но держит тот же
                    // прямоугольник у правого края — внутренний layout
                    // панели не меняется.
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    bottom: 0,
                  }
                : {}),
            }
          : {
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              width: 'min(360px, 92%)',
              zIndex: 12,
              boxShadow: `-16px 0 40px ${alpha('#0f172a', theme.palette.mode === 'dark' ? 0.5 : 0.18)}`,
            }),
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pl: 2,
          pr: 1,
          py: 0.5,
          borderBottom: `1px solid ${borderColor}`,
          flexShrink: 0,
        }}
      >
        <Typography
          component="h2"
          sx={{
            fontSize: 13,
            fontWeight: 700,
            color: ui.textSecondary || theme.palette.text.secondary,
            letterSpacing: 0.2,
          }}
        >
          Эмодзи и стикеры
        </Typography>
        <IconButton
          size="small"
          onClick={onClose}
          aria-label="Закрыть панель эмодзи и стикеров"
          data-testid="chat-emoji-dock-close"
          sx={{ width: 36, height: 36 }}
        >
          <CloseRoundedIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Suspense fallback={dockFallback}>
          <LazyChatEmojiPanel
            open
            desktopDocked
            theme={theme}
            ui={ui}
            currentUserId={currentUserId}
            onInsertEmoji={onInsertEmoji}
            onSendSticker={onSendSticker}
            onClose={onClose}
            visible={!hidden}
          />
        </Suspense>
      </Box>
    </Box>
  );
});

export default ChatEmojiDock;
