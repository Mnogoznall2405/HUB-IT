/**
 * Keeps ELK's left-to-right ordering, but wraps a crowded semantic level into
 * bounded rows. A following semantic level always starts below the tallest
 * row of the previous level.
 */
export function wrapSemanticBands(
  items,
  {
    maxColumns = 5,
    horizontalGap = 44,
    verticalGap = 28,
    bandGap = 92,
    padding = 32,
  } = {},
) {
  const safeColumns = Math.max(1, Number(maxColumns) || 1);
  const levels = new Map();

  (Array.isArray(items) ? items : []).forEach((item) => {
    const level = Number(item?.level || 0);
    if (!levels.has(level)) levels.set(level, []);
    levels.get(level).push(item);
  });

  const sortedLevels = [...levels.entries()].sort(([left], [right]) => left - right);
  const levelRows = sortedLevels.map(([level, levelItems]) => {
    const orderedItems = [...levelItems].sort((left, right) => {
      const xDifference = Number(left?.elkX || 0) - Number(right?.elkX || 0);
      return xDifference || String(left?.id || '').localeCompare(String(right?.id || ''), 'ru');
    });
    const rows = [];
    for (let index = 0; index < orderedItems.length; index += safeColumns) {
      const rowItems = orderedItems.slice(index, index + safeColumns);
      const width = rowItems.reduce(
        (total, item, itemIndex) => total + Number(item.width || 0) + (itemIndex ? horizontalGap : 0),
        0,
      );
      const height = Math.max(...rowItems.map((item) => Number(item.height || 0)), 0);
      rows.push({ items: rowItems, width, height });
    }
    return { level, rows, width: Math.max(...rows.map((row) => row.width), 0) };
  });

  const contentWidth = Math.max(...levelRows.map((entry) => entry.width), 0);
  const positions = new Map();
  let y = padding;

  levelRows.forEach((entry, levelIndex) => {
    entry.rows.forEach((row, rowIndex) => {
      let x = padding + (contentWidth - row.width) / 2;
      row.items.forEach((item) => {
        positions.set(String(item.id), { x, y });
        x += Number(item.width || 0) + horizontalGap;
      });
      y += row.height;
      if (rowIndex < entry.rows.length - 1) y += verticalGap;
    });
    if (levelIndex < levelRows.length - 1) y += bandGap;
  });

  return {
    positions,
    width: contentWidth + padding * 2,
    height: y + padding,
  };
}

function nodeBounds(node) {
  const left = Number(node?.position?.x || 0);
  const width = Number(node?.width || node?.measured?.width || 0);
  return { left, right: left + width };
}

function findFreeVerticalLane(obstacles, preferredX, minimumGap = 24) {
  if (!obstacles.length) return preferredX;

  const intervals = obstacles
    .map(nodeBounds)
    .sort((left, right) => left.left - right.left);
  const merged = [];
  intervals.forEach((interval) => {
    const previous = merged[merged.length - 1];
    if (previous && interval.left <= previous.right) {
      previous.right = Math.max(previous.right, interval.right);
    } else {
      merged.push({ ...interval });
    }
  });

  const candidates = [
    merged[0].left - minimumGap,
    merged[merged.length - 1].right + minimumGap,
  ];
  for (let index = 1; index < merged.length; index += 1) {
    const leftEdge = merged[index - 1].right;
    const rightEdge = merged[index].left;
    if (rightEdge - leftEdge >= minimumGap) {
      candidates.push(leftEdge + (rightEdge - leftEdge) / 2);
    }
  }

  return candidates.sort((left, right) => {
    const distanceDifference = Math.abs(left - preferredX) - Math.abs(right - preferredX);
    return distanceDifference || left - right;
  })[0];
}

export function buildSemanticEdgeRoutes(graph, positionedNodes) {
  const nodesById = new Map(
    (Array.isArray(positionedNodes) ? positionedNodes : [])
      .map((node) => [String(node?.id || ''), node]),
  );
  const levelsById = new Map(
    (Array.isArray(graph?.nodes) ? graph.nodes : [])
      .map((item) => [String(item?.nodeId || ''), Number(item?.level || 0)]),
  );

  return (Array.isArray(graph?.edges) ? graph.edges : []).map((edge) => {
    const baseEdge = {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
    };
    const sourceLevel = Number(edge?.sourceLevel ?? levelsById.get(String(edge.source)) ?? 0);
    const targetLevel = Number(edge?.targetLevel ?? levelsById.get(String(edge.target)) ?? 0);
    if (targetLevel - sourceLevel <= 1) return baseEdge;

    const source = nodesById.get(String(edge.source));
    const target = nodesById.get(String(edge.target));
    if (!source || !target) return baseEdge;

    const sourceBounds = nodeBounds(source);
    const targetBounds = nodeBounds(target);
    const preferredX = (
      (sourceBounds.left + sourceBounds.right) / 2
      + (targetBounds.left + targetBounds.right) / 2
    ) / 2;
    const obstacles = [...nodesById.values()].filter((node) => {
      const level = levelsById.get(String(node.id));
      return level > sourceLevel && level < targetLevel;
    });

    return {
      ...baseEdge,
      type: 'semanticLong',
      data: {
        laneX: findFreeVerticalLane(obstacles, preferredX),
      },
    };
  });
}

export function buildSemanticLongEdgePath({
  sourceX,
  sourceY,
  targetX,
  targetY,
  laneX,
  stub = 36,
}) {
  const verticalDistance = Math.max(0, Number(targetY) - Number(sourceY));
  const safeStub = Math.min(Number(stub) || 36, Math.max(12, verticalDistance / 4));
  const sourceTurnY = Number(sourceY) + safeStub;
  const targetTurnY = Number(targetY) - safeStub;
  return [
    `M ${Number(sourceX)} ${Number(sourceY)}`,
    `V ${sourceTurnY}`,
    `H ${Number(laneX)}`,
    `V ${targetTurnY}`,
    `H ${Number(targetX)}`,
    `V ${Number(targetY)}`,
  ].join(' ');
}
