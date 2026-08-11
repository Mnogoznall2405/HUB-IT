import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  IconButton,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import CorporateFareOutlinedIcon from '@mui/icons-material/CorporateFareOutlined';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import ZoomInOutlinedIcon from '@mui/icons-material/ZoomInOutlined';
import ZoomOutOutlinedIcon from '@mui/icons-material/ZoomOutOutlined';
import {
  NODE_TYPE_OPTIONS,
  collectExpandableIds,
  findNodePath,
  nodeCardTitle,
} from './companyStructureModel';

const TYPE_COLORS = {
  root: '#334155',
  block: '#435f73',
  deputy: '#3f6478',
  directorate: '#496b7c',
  service: '#526f7c',
  department: '#5b737c',
  group: '#65757b',
  other: '#64748b',
};

const DEFAULT_DESKTOP_ZOOM = 0.75;
const MIN_DESKTOP_ZOOM = 0.5;
const MAX_DESKTOP_ZOOM = 1;
const DESKTOP_ZOOM_STEP = 0.05;
const CARD_WIDTH = 196;
const CARD_HEIGHT = 92;
const CANVAS_PADDING = 32;
const HORIZONTAL_GAP = 36;
const LEVEL_GAP = 104;
const COMPACT_WRAP_THRESHOLD = 6;
const COMPACT_MAX_COLUMNS = 5;
const COMPACT_ROW_GAP = 64;
const COMPACT_BUS_GUTTER = 48;

function savedNodePosition(node) {
  if (node?.layout_x == null || node?.layout_y == null) return null;
  const x = Number(node?.layout_x);
  const y = Number(node?.layout_y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return null;
  return { x, y };
}

function treeHasSavedPositions(nodes) {
  return (Array.isArray(nodes) ? nodes : []).some((node) => (
    savedNodePosition(node) || treeHasSavedPositions(node?.children)
  ));
}

export function buildPositionedChartLayout(tree, expandedIds, overrides = {}) {
  const roots = Array.isArray(tree) ? tree : [];
  let nextLeafX = CANVAS_PADDING;
  const nodes = [];
  const edges = [];
  const reservedDescendantRows = new Map();

  const makeItem = (node, depth, autoX, autoY) => {
    const nodeId = String(node.id);
    const children = Array.isArray(node.children) ? node.children : [];
    const manual = overrides[nodeId] || savedNodePosition(node);
    return {
      node,
      nodeId,
      x: manual?.x ?? autoX,
      y: manual?.y ?? autoY,
      autoX,
      autoY,
      manuallyPositioned: Boolean(manual),
      hasChildren: children.length > 0,
      expanded: expandedIds.has(nodeId),
    };
  };

  const rowShape = (itemCount) => {
    const rowCount = itemCount > COMPACT_WRAP_THRESHOLD
      ? Math.ceil(itemCount / COMPACT_MAX_COLUMNS)
      : 1;
    const columnCount = Math.ceil(itemCount / rowCount);
    return {
      rowCount,
      columnCount,
      groupWidth: columnCount * CARD_WIDTH + (columnCount - 1) * HORIZONTAL_GAP,
    };
  };

  const placeRowItems = (items, depth, groupStartX, baseY, shape) => items.map((node, index) => {
    const rowIndex = Math.floor(index / shape.columnCount);
    const rowStartIndex = rowIndex * shape.columnCount;
    const rowItemCount = Math.min(shape.columnCount, items.length - rowStartIndex);
    const rowWidth = rowItemCount * CARD_WIDTH + (rowItemCount - 1) * HORIZONTAL_GAP;
    const rowStartX = groupStartX + (shape.groupWidth - rowWidth) / 2;
    const columnIndex = index - rowStartIndex;
    const item = makeItem(
      node,
      depth,
      rowStartX + columnIndex * (CARD_WIDTH + HORIZONTAL_GAP),
      baseY + rowIndex * (CARD_HEIGHT + COMPACT_ROW_GAP),
    );
    item.compactRowIndex = rowIndex;
    nodes.push(item);
    return item;
  });

  const reserveDescendantGroup = (desiredStartX, groupWidth, rowYs) => {
    let startX = Math.max(CANVAS_PADDING + COMPACT_BUS_GUTTER, desiredStartX);
    let shifted = true;
    while (shifted) {
      shifted = false;
      for (const rowY of rowYs) {
        const intervals = reservedDescendantRows.get(rowY) || [];
        const collision = intervals
          .sort((left, right) => left.start - right.start)
          .find((interval) => (
            startX < interval.end + HORIZONTAL_GAP
            && startX + groupWidth > interval.start - HORIZONTAL_GAP
          ));
        if (collision) {
          startX = collision.end + HORIZONTAL_GAP;
          shifted = true;
          break;
        }
      }
    }
    rowYs.forEach((rowY) => {
      const intervals = reservedDescendantRows.get(rowY) || [];
      intervals.push({ start: startX, end: startX + groupWidth });
      reservedDescendantRows.set(rowY, intervals);
    });
    return startX;
  };

  const descendantBaseY = (baseY, rowCount) => (
    baseY
    + (rowCount - 1) * (CARD_HEIGHT + COMPACT_ROW_GAP)
    + CARD_HEIGHT
    + LEVEL_GAP
  );

  const layoutVisibleDescendants = (parentItem, childDepth, baseY, minimumBusX) => {
    const children = Array.isArray(parentItem.node.children) ? parentItem.node.children : [];
    const visibleChildren = expandedIds.has(parentItem.nodeId) ? children : [];
    if (!visibleChildren.length) return;

    const shape = rowShape(visibleChildren.length);
    const rowYs = Array.from(
      { length: shape.rowCount },
      (_, rowIndex) => baseY + rowIndex * (CARD_HEIGHT + COMPACT_ROW_GAP),
    );
    const desiredStartX = parentItem.x + CARD_WIDTH / 2 - shape.groupWidth / 2;
    const groupStartX = reserveDescendantGroup(desiredStartX, shape.groupWidth, rowYs);
    const childLayouts = placeRowItems(
      visibleChildren,
      childDepth,
      groupStartX,
      baseY,
      shape,
    );
    const branchBusX = Math.max(
      minimumBusX,
      groupStartX + shape.groupWidth + COMPACT_BUS_GUTTER / 2,
    );
    nextLeafX = Math.max(nextLeafX, branchBusX + HORIZONTAL_GAP);
    childLayouts.forEach((child) => edges.push({
      parent: parentItem,
      child,
      routing: 'branch-drop',
      branchBusX,
    }));

    const nextBaseY = descendantBaseY(baseY, shape.rowCount);
    childLayouts.forEach((child) => {
      layoutVisibleDescendants(child, childDepth + 1, nextBaseY, branchBusX);
    });
  };

  const visit = (node, depth) => {
    const nodeId = String(node.id);
    const children = Array.isArray(node.children) ? node.children : [];
    const visibleChildren = expandedIds.has(nodeId) ? children : [];
    if (!visibleChildren.length) {
      const item = makeItem(
        node,
        depth,
        nextLeafX,
        CANVAS_PADDING + depth * (CARD_HEIGHT + LEVEL_GAP),
      );
      nextLeafX += CARD_WIDTH + HORIZONTAL_GAP;
      nodes.push(item);
      return item;
    }

    const shape = rowShape(visibleChildren.length);
    const groupStartX = nextLeafX + COMPACT_BUS_GUTTER;
    const childBaseY = CANVAS_PADDING + (depth + 1) * (CARD_HEIGHT + LEVEL_GAP);
    const childLayouts = placeRowItems(
      visibleChildren,
      depth + 1,
      groupStartX,
      childBaseY,
      shape,
    );
    nextLeafX = groupStartX + shape.groupWidth + HORIZONTAL_GAP;
    const item = makeItem(
      node,
      depth,
      groupStartX + (shape.groupWidth - CARD_WIDTH) / 2,
      CANVAS_PADDING + depth * (CARD_HEIGHT + LEVEL_GAP),
    );
    nodes.push(item);
    childLayouts.forEach((child) => edges.push({
      parent: item,
      child,
      routing: 'compact-row',
      compactGroupId: `${nodeId}:compact-children`,
      compactGroupStartX: groupStartX,
      compactRowIndex: child.compactRowIndex,
    }));

    const nextBaseY = descendantBaseY(childBaseY, shape.rowCount);
    const minimumBusX = groupStartX + shape.groupWidth + COMPACT_BUS_GUTTER / 2;
    childLayouts.forEach((child) => {
      layoutVisibleDescendants(child, depth + 2, nextBaseY, minimumBusX);
    });
    return item;
  };

  roots.forEach((root, index) => {
    visit(root, 0);
    if (index < roots.length - 1) nextLeafX += HORIZONTAL_GAP * 2;
  });

  const width = Math.max(
    760,
    ...nodes.map((item) => item.x + CARD_WIDTH + CANVAS_PADDING),
    ...edges.map((edge) => (edge.branchBusX || 0) + CANVAS_PADDING),
  );
  const height = Math.max(
    440,
    ...nodes.map((item) => item.y + CARD_HEIGHT + 72),
  );
  return { nodes, edges, width, height };
}

function typeLabel(node) {
  return NODE_TYPE_OPTIONS.find((item) => item.value === node?.node_type)?.label || 'Подразделение';
}

function ChartCard({
  node,
  selected,
  onSelect,
  positionEditing = false,
  dragging = false,
  positionInstructionId,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onKeyDown,
}) {
  const accent = TYPE_COLORS[node.node_type] || TYPE_COLORS.other;
  const isPerson = node.node_type === 'root' || node.node_type === 'deputy';
  return (
    <Paper
      component="button"
      type="button"
      variant="outlined"
      onClick={() => onSelect(String(node.id))}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
      aria-pressed={selected}
      aria-describedby={positionEditing ? positionInstructionId : undefined}
      sx={{
        position: 'relative',
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        p: 1.25,
        overflow: 'hidden',
        textAlign: 'left',
        color: 'text.primary',
        bgcolor: 'background.paper',
        borderRadius: 1.75,
        borderColor: selected ? accent : 'divider',
        borderWidth: selected ? 2 : 1,
        cursor: positionEditing ? (dragging ? 'grabbing' : 'grab') : 'pointer',
        touchAction: positionEditing ? 'none' : 'auto',
        boxShadow: selected ? '0 8px 18px rgba(15, 23, 42, 0.14)' : '0 2px 8px rgba(15, 23, 42, 0.07)',
        transition: 'transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease',
        '&:hover': {
          transform: positionEditing ? 'none' : 'translateY(-1px)',
          boxShadow: '0 7px 16px rgba(15, 23, 42, 0.12)',
          borderColor: accent,
        },
        '&:focus-visible': { outline: `3px solid ${accent}45`, outlineOffset: 2 },
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: '0 0 auto 0',
          height: 3,
          bgcolor: accent,
        },
      }}
    >
      <Stack direction="row" spacing={1.1} alignItems="flex-start">
        <Box
          sx={{
            mt: 0.25,
            width: 28,
            height: 28,
            borderRadius: 1.5,
            display: 'grid',
            placeItems: 'center',
            color: accent,
            bgcolor: `${accent}12`,
            flexShrink: 0,
          }}
        >
          {isPerson ? <PersonOutlineIcon fontSize="small" /> : <CorporateFareOutlinedIcon fontSize="small" />}
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            variant="subtitle2"
            fontWeight={700}
            sx={{
              lineHeight: 1.25,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {nodeCardTitle(node)}
          </Typography>
          {isPerson && node.person_name ? (
            <Typography variant="caption" color="text.secondary" noWrap display="block" sx={{ mt: 0.25 }}>
              {node.person_name}
            </Typography>
          ) : null}
          <Typography variant="caption" color="text.secondary" noWrap display="block" sx={{ mt: 0.25 }}>
            {typeLabel(node)}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}

function PositionedDesktopChart({
  tree,
  selectedId,
  expandedIds,
  desktopZoom,
  onSelect,
  onToggle,
  positionEditing,
  onPositionChange,
}) {
  const [positionOverrides, setPositionOverrides] = useState({});
  const [draggingNodeId, setDraggingNodeId] = useState('');
  const [positionStatus, setPositionStatus] = useState('');
  const dragNodeRef = useRef(null);
  const suppressedClickRef = useRef('');
  const instructionId = 'company-structure-position-instructions';
  const layout = useMemo(
    () => buildPositionedChartLayout(tree, expandedIds, positionOverrides),
    [expandedIds, positionOverrides, tree],
  );
  const edgeRouting = useMemo(() => {
    const regularEdges = [];
    const compactGroupsById = new Map();
    const branchGroupsById = new Map();
    layout.edges.forEach((edge) => {
      if (
        edge.routing === 'branch-drop'
        && !edge.parent.manuallyPositioned
        && !edge.child.manuallyPositioned
      ) {
        const groupId = `${edge.parent.nodeId}:branch:${edge.branchBusX}`;
        const group = branchGroupsById.get(groupId) || {
          id: groupId,
          parent: edge.parent,
          busX: edge.branchBusX,
          children: [],
        };
        group.children.push(edge.child);
        branchGroupsById.set(groupId, group);
        return;
      }
      if (
        edge.routing !== 'compact-row'
        || edge.parent.manuallyPositioned
        || edge.child.manuallyPositioned
      ) {
        regularEdges.push(edge);
        return;
      }
      const group = compactGroupsById.get(edge.compactGroupId) || {
        id: edge.compactGroupId,
        parent: edge.parent,
        groupStartX: edge.compactGroupStartX,
        rowsByIndex: new Map(),
      };
      const row = group.rowsByIndex.get(edge.compactRowIndex) || [];
      row.push(edge.child);
      group.rowsByIndex.set(edge.compactRowIndex, row);
      compactGroupsById.set(edge.compactGroupId, group);
    });
    const compactGroups = [...compactGroupsById.values()].map((group) => ({
      ...group,
      rows: [...group.rowsByIndex.entries()]
        .sort(([left], [right]) => left - right)
        .map(([rowIndex, children]) => ({
          rowIndex,
          children: [...children].sort((left, right) => left.x - right.x),
        })),
    }));
    const branchGroups = [...branchGroupsById.values()].map((group) => {
      const rowsByY = new Map();
      group.children.forEach((child) => {
        const row = rowsByY.get(child.y) || [];
        row.push(child);
        rowsByY.set(child.y, row);
      });
      return {
        ...group,
        rows: [...rowsByY.entries()]
          .sort(([left], [right]) => left - right)
          .map(([childY, children]) => ({
            childY,
            children: [...children].sort((left, right) => left.x - right.x),
          })),
      };
    });
    return { regularEdges, compactGroups, branchGroups };
  }, [layout.edges]);

  useEffect(() => {
    setPositionOverrides({});
  }, [tree]);

  const savePosition = (item, position) => {
    setPositionStatus(`Сохраняем позицию «${nodeCardTitle(item.node)}»…`);
    Promise.resolve(onPositionChange?.(item.nodeId, position))
      .then(() => setPositionStatus(`Позиция «${nodeCardTitle(item.node)}» сохранена`))
      .catch(() => {
        setPositionOverrides((current) => {
          const next = { ...current };
          delete next[item.nodeId];
          return next;
        });
        setPositionStatus(`Не удалось сохранить позицию «${nodeCardTitle(item.node)}»`);
      });
  };

  const startCardDrag = (event, item) => {
    if (!positionEditing || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragNodeRef.current = {
      nodeId: item.nodeId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: item.x,
      startY: item.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDraggingNodeId(item.nodeId);
  };

  const moveCard = (event) => {
    const drag = dragNodeRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const deltaX = (event.clientX - drag.startClientX) / desktopZoom;
    const deltaY = (event.clientY - drag.startClientY) / desktopZoom;
    if (Math.abs(deltaX) >= 3 || Math.abs(deltaY) >= 3) drag.moved = true;
    const position = {
      x: Math.max(CANVAS_PADDING, Math.round((drag.startX + deltaX) * 2) / 2),
      y: Math.max(CANVAS_PADDING, Math.round((drag.startY + deltaY) * 2) / 2),
    };
    drag.lastPosition = position;
    setPositionOverrides((current) => ({ ...current, [drag.nodeId]: position }));
  };

  const stopCardDrag = (event, item) => {
    const drag = dragNodeRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.nodeId !== item.nodeId) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragNodeRef.current = null;
    setDraggingNodeId('');
    if (!drag.moved) return;
    const position = drag.lastPosition || positionOverrides[item.nodeId] || { x: item.x, y: item.y };
    suppressedClickRef.current = item.nodeId;
    window.setTimeout(() => {
      if (suppressedClickRef.current === item.nodeId) suppressedClickRef.current = '';
    }, 0);
    savePosition(item, position);
  };

  const selectCard = (nodeId) => {
    if (suppressedClickRef.current === String(nodeId)) return;
    onSelect(nodeId);
  };

  const nudgeCard = (event, item) => {
    if (!positionEditing || !event.altKey) return;
    const deltaByKey = {
      ArrowLeft: [-16, 0],
      ArrowRight: [16, 0],
      ArrowUp: [0, -16],
      ArrowDown: [0, 16],
    };
    const delta = deltaByKey[event.key];
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const position = {
      x: Math.max(CANVAS_PADDING, item.x + delta[0]),
      y: Math.max(CANVAS_PADDING, item.y + delta[1]),
    };
    setPositionOverrides((current) => ({ ...current, [item.nodeId]: position }));
    savePosition(item, position);
  };

  return (
    <Box
      sx={{
        position: 'relative',
        width: layout.width,
        height: layout.height,
        minWidth: layout.width,
        bgcolor: 'background.default',
        backgroundImage: positionEditing
          ? 'radial-gradient(circle, rgba(100, 116, 139, 0.22) 1px, transparent 1px)'
          : 'none',
        backgroundSize: '24px 24px',
      }}
    >
      <Box
        component="span"
        id={instructionId}
        sx={{
          position: 'absolute',
          width: 1,
          height: 1,
          p: 0,
          m: -1,
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        Перетащите карточку мышью. С клавиатуры удерживайте Alt и используйте стрелки.
      </Box>
      <Box
        component="svg"
        aria-hidden="true"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        sx={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          overflow: 'visible',
          color: 'divider',
        }}
      >
        {edgeRouting.regularEdges.map(({ parent, child }) => {
          const parentX = parent.x + CARD_WIDTH / 2;
          const parentY = parent.y + CARD_HEIGHT;
          const childX = child.x + CARD_WIDTH / 2;
          const childY = child.y;
          const middleY = parentY + (childY - parentY) / 2;
          return (
            <path
              key={`${parent.nodeId}-${child.nodeId}`}
              d={`M ${parentX} ${parentY} V ${middleY} H ${childX} V ${childY}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {edgeRouting.compactGroups.map((group) => {
          const parentX = group.parent.x + CARD_WIDTH / 2;
          const parentY = group.parent.y + CARD_HEIGHT;
          const busX = group.groupStartX - COMPACT_BUS_GUTTER / 2;
          const rows = group.rows.map((row) => ({
            ...row,
            busY: Math.min(...row.children.map((child) => child.y)) - 24,
          }));
          const firstBusY = rows[0]?.busY ?? parentY;
          const lastBusY = rows.at(-1)?.busY ?? parentY;
          const leadY = Math.min(parentY + 52, firstBusY);
          return (
            <g key={group.id}>
              <path
                d={`M ${parentX} ${parentY} V ${leadY} H ${busX} V ${lastBusY}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              {rows.map((row) => {
                const lastChildX = row.children.at(-1).x + CARD_WIDTH / 2;
                return (
                  <g key={`${group.id}:row-${row.rowIndex}`}>
                    <path
                      d={`M ${busX} ${row.busY} H ${lastChildX}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                    {row.children.map((child) => {
                      const childX = child.x + CARD_WIDTH / 2;
                      return (
                        <path
                          key={`${group.id}:${child.nodeId}`}
                          d={`M ${childX} ${row.busY} V ${child.y}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          vectorEffect="non-scaling-stroke"
                        />
                      );
                    })}
                  </g>
                );
              })}
            </g>
          );
        })}
        {edgeRouting.branchGroups.map((group) => {
          const parentX = group.parent.x + CARD_WIDTH / 2;
          const parentY = group.parent.y + CARD_HEIGHT;
          const rows = group.rows.map((row) => ({ ...row, busY: row.childY - 24 }));
          const firstBusY = rows[0]?.busY ?? parentY;
          const lastBusY = rows.at(-1)?.busY ?? parentY;
          const leadY = Math.min(parentY + 52, firstBusY);
          return (
            <g key={group.id}>
              <path
                d={`M ${parentX} ${parentY} V ${leadY} H ${group.busX} V ${lastBusY}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              {rows.map((row) => {
                const firstChildX = row.children[0].x + CARD_WIDTH / 2;
                return (
                  <g key={`${group.id}:row-${row.childY}`}>
                    <path
                      d={`M ${group.busX} ${row.busY} H ${firstChildX}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                    {row.children.map((child) => {
                      const childX = child.x + CARD_WIDTH / 2;
                      return (
                        <path
                          key={`${group.id}:${child.nodeId}`}
                          d={`M ${childX} ${row.busY} V ${child.y}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          vectorEffect="non-scaling-stroke"
                        />
                      );
                    })}
                  </g>
                );
              })}
            </g>
          );
        })}
      </Box>
      {layout.nodes.map((item) => (
        <Box
          key={item.nodeId}
          data-node-id={item.nodeId}
          sx={{
            position: 'absolute',
            left: item.x,
            top: item.y,
            width: CARD_WIDTH,
            zIndex: draggingNodeId === item.nodeId ? 4 : 2,
          }}
        >
          <ChartCard
            node={item.node}
            selected={String(selectedId) === item.nodeId}
            onSelect={selectCard}
            positionEditing={positionEditing}
            dragging={draggingNodeId === item.nodeId}
            positionInstructionId={instructionId}
            onPointerDown={(event) => startCardDrag(event, item)}
            onPointerMove={moveCard}
            onPointerUp={(event) => stopCardDrag(event, item)}
            onPointerCancel={(event) => stopCardDrag(event, item)}
            onKeyDown={(event) => nudgeCard(event, item)}
          />
          {item.hasChildren ? (
            <Button
              size="small"
              variant="outlined"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onToggle(item.nodeId)}
              endIcon={item.expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              sx={{
                position: 'absolute',
                top: CARD_HEIGHT + 8,
                left: '50%',
                transform: 'translateX(-50%)',
                borderRadius: 5,
                bgcolor: 'background.paper',
                zIndex: 3,
                whiteSpace: 'nowrap',
              }}
            >
              {item.expanded ? 'Свернуть' : `${item.node.children.length} внутри`}
            </Button>
          ) : null}
        </Box>
      ))}
      <Box
        role="status"
        aria-live="polite"
        sx={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
        }}
      >
        {positionStatus}
      </Box>
    </Box>
  );
}

function MobileBranch({ node, selectedId, expandedIds, onSelect, onToggle, depth = 0 }) {
  const children = Array.isArray(node.children) ? node.children : [];
  const expanded = expandedIds.has(String(node.id));
  return (
    <Box sx={{ position: 'relative', pl: depth ? 2.25 : 0 }}>
      {depth ? (
        <Box sx={{ position: 'absolute', left: 7, top: 0, bottom: 0, width: 2, bgcolor: 'divider' }} />
      ) : null}
      <Stack direction="row" spacing={1} alignItems="center">
        <Box>
          <ChartCard node={node} selected={String(selectedId) === String(node.id)} onSelect={onSelect} />
        </Box>
        {children.length ? (
          <Button size="small" onClick={() => onToggle(String(node.id))} sx={{ minWidth: 38, px: 0 }}>
            {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </Button>
        ) : null}
      </Stack>
      {expanded ? (
        <Stack spacing={1} sx={{ mt: 1 }}>
          {children.map((child) => (
            <MobileBranch
              key={child.id}
              node={child}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onSelect={onSelect}
              onToggle={onToggle}
              depth={depth + 1}
            />
          ))}
        </Stack>
      ) : null}
    </Box>
  );
}

export default function CompanyStructureChart({
  tree,
  selectedId,
  onSelect,
  isMobile,
  toolbarAction = null,
  positionEditing = false,
  onPositionChange,
  onResetPositions,
}) {
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [desktopZoom, setDesktopZoom] = useState(DEFAULT_DESKTOP_ZOOM);
  const [dragging, setDragging] = useState(false);
  const viewportRef = useRef(null);
  const dragRef = useRef(null);
  const hasSavedPositions = useMemo(() => treeHasSavedPositions(tree), [tree]);

  useEffect(() => {
    const path = findNodePath(tree, selectedId);
    setExpandedIds((current) => {
      const next = new Set(current);
      path.slice(0, -1).forEach((node) => next.add(String(node.id)));
      if (tree[0]?.id && next.size === 0) next.add(String(tree[0].id));
      return next;
    });
  }, [selectedId, tree]);

  const toggle = (nodeId) => setExpandedIds((current) => {
    const next = new Set(current);
    if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
    return next;
  });

  const changeDesktopZoom = (delta) => {
    setDesktopZoom((current) => Math.min(
      MAX_DESKTOP_ZOOM,
      Math.max(MIN_DESKTOP_ZOOM, Number((current + delta).toFixed(2))),
    ));
  };

  const startPan = (event) => {
    if (isMobile || event.button !== 0 || event.target.closest?.('button, a, input, [role="button"]')) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    };
    viewport.setPointerCapture?.(event.pointerId);
    setDragging(true);
  };

  const pan = (event) => {
    const state = dragRef.current;
    const viewport = viewportRef.current;
    if (!state || !viewport || state.pointerId !== event.pointerId) return;
    viewport.scrollLeft = state.left - (event.clientX - state.x);
    viewport.scrollTop = state.top - (event.clientY - state.y);
  };

  const stopPan = (event) => {
    const viewport = viewportRef.current;
    if (dragRef.current?.pointerId === event.pointerId) {
      viewport?.releasePointerCapture?.(event.pointerId);
      dragRef.current = null;
      setDragging(false);
    }
  };

  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 2.5,
        overflow: 'hidden',
        bgcolor: 'background.default',
      }}
    >
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        spacing={1}
        useFlexGap
        flexWrap="wrap"
        sx={{ px: 2, py: 1.25, bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <AccountTreeOutlinedIcon color="primary" />
          <Typography variant="subtitle1" fontWeight={700}>Схема подчинённости</Typography>
        </Stack>
        <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
          {toolbarAction}
          {positionEditing ? (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ alignSelf: 'center', px: 0.75 }}
            >
              Перетаскивайте карточки за любое место
            </Typography>
          ) : null}
          {!isMobile ? (
            <Stack
              direction="row"
              alignItems="center"
              role="group"
              aria-label="Масштаб схемы"
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1.5,
                bgcolor: 'background.paper',
              }}
            >
              <IconButton
                size="small"
                aria-label="Отдалить схему"
                onClick={() => changeDesktopZoom(-DESKTOP_ZOOM_STEP)}
                disabled={desktopZoom <= MIN_DESKTOP_ZOOM}
                sx={{ width: 36, height: 36, borderRadius: 1.25 }}
              >
                <ZoomOutOutlinedIcon fontSize="small" />
              </IconButton>
              <Typography
                component="output"
                aria-live="polite"
                aria-label={`Масштаб ${Math.round(desktopZoom * 100)} процентов`}
                variant="caption"
                color="text.secondary"
                sx={{ minWidth: 40, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
              >
                {Math.round(desktopZoom * 100)}%
              </Typography>
              <IconButton
                size="small"
                aria-label="Приблизить схему"
                onClick={() => changeDesktopZoom(DESKTOP_ZOOM_STEP)}
                disabled={desktopZoom >= MAX_DESKTOP_ZOOM}
                sx={{ width: 36, height: 36, borderRadius: 1.25 }}
              >
                <ZoomInOutlinedIcon fontSize="small" />
              </IconButton>
            </Stack>
          ) : null}
          <Button size="small" onClick={() => setExpandedIds(collectExpandableIds(tree))}>
            {isMobile ? 'Всё' : 'Развернуть всё'}
          </Button>
          <Button size="small" color="inherit" onClick={() => setExpandedIds(new Set())}>Свернуть</Button>
          {positionEditing ? (
            <Button
              size="small"
              color="inherit"
              onClick={onResetPositions}
              disabled={!hasSavedPositions}
            >
              Авторасстановка
            </Button>
          ) : null}
        </Stack>
      </Stack>
      <Box
        ref={viewportRef}
        onPointerDown={startPan}
        onPointerMove={pan}
        onPointerUp={stopPan}
        onPointerCancel={stopPan}
        sx={{
          overflow: 'auto',
          p: { xs: 2, md: 3 },
          minHeight: { xs: 360, md: 460 },
          maxHeight: { xs: 620, md: '68vh' },
          cursor: isMobile ? 'auto' : (dragging ? 'grabbing' : 'grab'),
          userSelect: dragging ? 'none' : 'auto',
          bgcolor: 'background.default',
          scrollbarWidth: 'thin',
        }}
      >
        {isMobile ? (
          <Stack spacing={1} alignItems="flex-start">
            {tree.map((node) => (
              <MobileBranch
                key={node.id}
                node={node}
                selectedId={selectedId}
                expandedIds={expandedIds}
                onSelect={onSelect}
                onToggle={toggle}
              />
            ))}
          </Stack>
        ) : (
          <Stack
            direction="row"
            justifyContent="center"
            alignItems="flex-start"
            sx={{ minWidth: 'max-content', zoom: desktopZoom }}
          >
            <PositionedDesktopChart
              tree={tree}
              selectedId={selectedId}
              expandedIds={expandedIds}
              desktopZoom={desktopZoom}
              onSelect={onSelect}
              onToggle={toggle}
              positionEditing={positionEditing}
              onPositionChange={onPositionChange}
            />
          </Stack>
        )}
      </Box>
    </Paper>
  );
}
