import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CompanyStructureChart, { buildPositionedChartLayout } from './CompanyStructureChart';

const tree = [
  {
    id: 'root',
    node_type: 'root',
    title: 'Генеральный директор',
    children: [],
  },
];

describe('CompanyStructureChart zoom', () => {
  it('wraps a large sibling group into balanced centered rows', () => {
    const children = Array.from({ length: 13 }, (_, index) => ({
      id: `department-${index + 1}`,
      parent_id: 'root',
      node_type: 'department',
      title: `Отдел ${index + 1}`,
      children: [],
    }));
    const layout = buildPositionedChartLayout(
      [{ ...tree[0], children }],
      new Set(['root']),
    );
    const childItems = layout.nodes.filter((item) => item.nodeId.startsWith('department-'));
    const rows = [...new Set(childItems.map((item) => item.y))]
      .sort((left, right) => left - right)
      .map((rowY) => childItems.filter((item) => item.y === rowY));
    const rootItem = layout.nodes.find((item) => item.nodeId === 'root');
    const rootCenter = rootItem.x + 98;

    expect(rows.map((row) => row.length)).toEqual([5, 5, 3]);
    rows.forEach((row) => {
      const rowCenter = (row[0].x + row.at(-1).x + 196) / 2;
      expect(rowCenter).toBe(rootCenter);
    });
    expect(layout.width).toBeLessThan(1500);
    expect(layout.edges.every((edge) => edge.routing === 'compact-row')).toBe(true);
  });

  it('keeps sibling rows stable when one card reveals its children', () => {
    const children = Array.from({ length: 7 }, (_, index) => ({
      id: `stable-department-${index + 1}`,
      parent_id: 'root',
      node_type: 'department',
      title: `Стабильный отдел ${index + 1}`,
      children: index === 3 ? [{
        id: 'nested-department',
        parent_id: `stable-department-${index + 1}`,
        node_type: 'department',
        title: 'Дочерний отдел',
        children: [],
      }] : [],
    }));
    const positionedTree = [{ ...tree[0], children }];
    const collapsedLayout = buildPositionedChartLayout(positionedTree, new Set(['root']));
    const expandedLayout = buildPositionedChartLayout(
      positionedTree,
      new Set(['root', 'stable-department-4']),
    );
    const siblingPositions = (layout) => Object.fromEntries(
      layout.nodes
        .filter((item) => item.nodeId.startsWith('stable-department-'))
        .map((item) => [item.nodeId, { x: item.x, y: item.y }]),
    );

    expect(siblingPositions(expandedLayout)).toEqual(siblingPositions(collapsedLayout));
    const nestedItem = expandedLayout.nodes.find((item) => item.nodeId === 'nested-department');
    const siblingBottom = Math.max(
      ...expandedLayout.nodes
        .filter((item) => item.nodeId.startsWith('stable-department-'))
        .map((item) => item.y + 92),
    );
    expect(nestedItem.y).toBeGreaterThan(siblingBottom);
    expect(expandedLayout.edges.find((edge) => edge.child === nestedItem)).toMatchObject({
      routing: 'branch-drop',
    });
  });

  it('uses the compact positioned canvas in the regular desktop view', () => {
    const children = Array.from({ length: 7 }, (_, index) => ({
      id: `regular-department-${index + 1}`,
      parent_id: 'root',
      node_type: 'department',
      title: `Обычный отдел ${index + 1}`,
      children: [],
    }));
    const { container } = render(
      <CompanyStructureChart
        tree={[{ ...tree[0], children }]}
        selectedId="root"
        onSelect={vi.fn()}
        isMobile={false}
      />,
    );

    expect(container.querySelectorAll('[data-node-id]')).toHaveLength(8);
    const connectorPaths = [...container.querySelectorAll('svg path')];
    expect(connectorPaths.length).toBeGreaterThan(7);
    expect(connectorPaths.every((path) => !path.getAttribute('d').includes('NaN'))).toBe(true);
  });

  it('uses saved card coordinates while keeping hierarchy edges', () => {
    const positionedTree = [{
      ...tree[0],
      layout_x: 120,
      layout_y: 48,
      children: [{
        id: 'child',
        parent_id: 'root',
        node_type: 'department',
        title: 'Отдел',
        layout_x: 420,
        layout_y: 260,
        children: [],
      }],
    }];

    const layout = buildPositionedChartLayout(positionedTree, new Set(['root']));

    expect(layout.nodes.find((item) => item.nodeId === 'root')).toMatchObject({ x: 120, y: 48 });
    expect(layout.nodes.find((item) => item.nodeId === 'child')).toMatchObject({ x: 420, y: 260 });
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0].parent.nodeId).toBe('root');
    expect(layout.edges[0].child.nodeId).toBe('child');
  });

  it('saves a manually dragged card position in logical canvas coordinates', async () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    const onPositionChange = vi.fn().mockResolvedValue(undefined);
    const positionedTree = [{ ...tree[0], layout_x: 100, layout_y: 80 }];
    render(
      <CompanyStructureChart
        tree={positionedTree}
        selectedId="root"
        onSelect={vi.fn()}
        isMobile={false}
        positionEditing
        onPositionChange={onPositionChange}
        onResetPositions={vi.fn()}
      />,
    );

    const card = screen.getByRole('button', { name: new RegExp(tree[0].title) });
    fireEvent.pointerDown(card, { button: 0, clientX: 100, clientY: 100, pointerId: 7 });
    fireEvent.pointerMove(card, { clientX: 140, clientY: 130, pointerId: 7 });
    fireEvent.pointerUp(card, { clientX: 140, clientY: 130, pointerId: 7 });

    await waitFor(() => expect(onPositionChange).toHaveBeenCalledWith('root', { x: 153.5, y: 120 }));
    vi.unstubAllGlobals();
  });

  it('starts zoomed out and allows stronger desktop zoom out', () => {
    render(
      <CompanyStructureChart
        tree={tree}
        selectedId="root"
        onSelect={vi.fn()}
        isMobile={false}
      />,
    );

    expect(screen.getByRole('group', { name: 'Масштаб схемы' })).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();

    const zoomOut = screen.getByRole('button', { name: 'Отдалить схему' });
    fireEvent.click(zoomOut);
    expect(screen.getByText('70%')).toBeInTheDocument();

    for (let index = 0; index < 4; index += 1) fireEvent.click(zoomOut);
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(zoomOut).toBeDisabled();
  });

  it('keeps zoom controls out of the mobile hierarchy', () => {
    render(
      <CompanyStructureChart
        tree={tree}
        selectedId="root"
        onSelect={vi.fn()}
        isMobile
      />,
    );

    expect(screen.queryByRole('group', { name: 'Масштаб схемы' })).not.toBeInTheDocument();
  });
});
