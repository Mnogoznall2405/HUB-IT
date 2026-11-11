import { describe, expect, it } from 'vitest';
import {
  buildSemanticEdgeRoutes,
  buildSemanticLongEdgePath,
  wrapSemanticBands,
} from './companyStructureLayout';

describe('wrapSemanticBands', () => {
  it('wraps fifteen departments and keeps the next semantic band below them', () => {
    const departments = Array.from({ length: 15 }, (_, index) => ({
      id: `department-${index}`,
      level: 4,
      elkX: index * 250,
      width: 224,
      height: 108,
    }));
    const group = { id: 'group', level: 5, elkX: 0, width: 224, height: 108 };

    const result = wrapSemanticBands([...departments, group], { maxColumns: 5 });
    const departmentRows = new Set(departments.map((item) => result.positions.get(item.id).y));
    const lowestDepartmentY = Math.max(...departments.map((item) => result.positions.get(item.id).y));

    expect(departmentRows.size).toBe(3);
    expect(result.positions.get('group').y).toBeGreaterThan(lowestDepartmentY + 108);
    expect(result.width).toBeLessThan(1500);
  });

  it('centres a short row inside the widest semantic band', () => {
    const result = wrapSemanticBands([
      { id: 'leader', level: 2, elkX: 0, width: 252, height: 142 },
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `unit-${index}`,
        level: 3,
        elkX: index,
        width: 224,
        height: 108,
      })),
    ]);

    const leader = result.positions.get('leader');
    expect(leader.x).toBeGreaterThan(32);
  });

  it('routes a direct department of a block around unrelated deputies', () => {
    const graph = {
      nodes: [
        { nodeId: 'block', level: 1 },
        { nodeId: 'director', level: 2 },
        { nodeId: 'murzin', level: 2 },
        { nodeId: 'deputy', level: 2 },
        { nodeId: 'management', level: 4 },
      ],
      edges: [{
        id: 'block-management',
        source: 'block',
        target: 'management',
        sourceLevel: 1,
        targetLevel: 4,
      }],
    };
    const nodes = [
      { id: 'block', position: { x: 342, y: 32 }, width: 224, height: 108 },
      { id: 'director', position: { x: 32, y: 232 }, width: 252, height: 142 },
      { id: 'murzin', position: { x: 328, y: 232 }, width: 252, height: 142 },
      { id: 'deputy', position: { x: 624, y: 232 }, width: 252, height: 142 },
      { id: 'management', position: { x: 342, y: 466 }, width: 224, height: 108 },
    ];

    const [edge] = buildSemanticEdgeRoutes(graph, nodes);
    const path = buildSemanticLongEdgePath({
      sourceX: 454,
      sourceY: 140,
      targetX: 454,
      targetY: 466,
      laneX: edge.data.laneX,
    });

    expect(edge.type).toBe('semanticLong');
    expect(edge.data.laneX).toBeGreaterThan(284);
    expect(edge.data.laneX).toBeLessThan(328);
    expect(path).toContain(`H ${edge.data.laneX}`);
    expect(path).not.toBe('M 454 140 V 466');
  });
});
