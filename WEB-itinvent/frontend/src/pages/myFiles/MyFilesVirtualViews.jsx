import { Box } from '@mui/material';

import {
  MY_FILES_FILE_CARD_HEIGHT,
  MY_FILES_FOLDER_CARD_HEIGHT,
} from '../../components/myFiles/myFilesVisual';
import { useElementWidth, useWindowVirtualRows } from './useWindowVirtualRows';

// The virtualizers own their scroll-range state HERE — inside the small list /
// grid components — not in the page component. A range change on scroll
// re-renders just the mounted slice (~40 rows) instead of the whole MyFiles
// tree; that is what keeps scroll-driven commits cheap.

// Window-virtualized document-flow list: renders rows[start..end] between two
// spacer boxes whose heights preserve the page scroll height.
export function VirtualListRows({ rows, rowHeight, renderRow, overscan = 8 }) {
  const v = useWindowVirtualRows({ itemCount: rows.length, rowHeight, overscan, trackWidth: false });
  return (
    <Box ref={v.containerRef} data-testid="my-files-rows">
      {v.topSpacerHeight > 0 ? (
        <Box aria-hidden="true" data-testid="my-files-rows-spacer-top" sx={{ height: v.topSpacerHeight }} />
      ) : null}
      {rows.slice(v.start, v.end).map(renderRow)}
      {v.bottomSpacerHeight > 0 ? (
        <Box aria-hidden="true" data-testid="my-files-rows-spacer-bottom" sx={{ height: v.bottomSpacerHeight }} />
      ) : null}
    </Box>
  );
}

// Measures its own content width and passes it to children — drives the grid
// column-count math below without forcing width state up into the page.
export function MeasuredBox({ children, sx, ...props }) {
  const [ref, width] = useElementWidth();
  return (
    <Box ref={ref} sx={sx} {...props}>
      {children(width)}
    </Box>
  );
}

// Grid virtualized by ROWS: column count mirrors the CSS
// repeat(auto-fill, minmax(N,1fr)) rule — floor((width+gap)/(N+gap)).
function VirtualGridSection({ items, width, minCardWidth, gapPx, cardHeight, renderItem, spacerPrefix, sx }) {
  const cols = Math.max(1, Math.floor((width + gapPx) / (minCardWidth + gapPx)) || 1);
  const v = useWindowVirtualRows({
    itemCount: Math.ceil(items.length / cols),
    rowHeight: cardHeight + gapPx,
    overscan: 4,
  });
  return (
    <Box ref={v.containerRef} sx={sx}>
      {v.topSpacerHeight > 0 ? (
        <Box aria-hidden="true" data-testid={`${spacerPrefix}-top`} sx={{ height: v.topSpacerHeight }} />
      ) : null}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fill, minmax(${minCardWidth}px, 1fr))`,
          gap: `${gapPx}px`,
        }}
      >
        {items.slice(v.start * cols, v.end * cols).map(renderItem)}
      </Box>
      {v.bottomSpacerHeight > 0 ? (
        <Box aria-hidden="true" data-testid={`${spacerPrefix}-bottom`} sx={{ height: v.bottomSpacerHeight }} />
      ) : null}
    </Box>
  );
}

export function VirtualFolderGrid(props) {
  return (
    <VirtualGridSection
      {...props}
      minCardWidth={220}
      gapPx={8}
      cardHeight={MY_FILES_FOLDER_CARD_HEIGHT}
      spacerPrefix="my-files-grid-spacer-folders"
    />
  );
}

export function VirtualFileGrid(props) {
  return (
    <VirtualGridSection
      {...props}
      minCardWidth={190}
      gapPx={12}
      cardHeight={MY_FILES_FILE_CARD_HEIGHT}
      spacerPrefix="my-files-grid-spacer-files"
    />
  );
}
