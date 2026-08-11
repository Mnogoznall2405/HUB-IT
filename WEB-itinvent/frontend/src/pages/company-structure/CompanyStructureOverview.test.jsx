import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import CompanyStructureOverview, { OverviewNode } from './CompanyStructureOverview';

vi.mock('elkjs/lib/elk.bundled.js', () => ({
  default: class ElkMock {
    layout() {
      return new Promise(() => {});
    }
  },
}));

vi.mock('@xyflow/react', () => ({
  Background: () => null,
  BaseEdge: () => null,
  Controls: () => null,
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
  ReactFlow: ({ children, colorMode }) => (
    <div data-testid="company-structure-flow" data-color-mode={colorMode || ''}>
      {children}
    </div>
  ),
  ReactFlowProvider: ({ children }) => children,
  useReactFlow: () => ({
    fitView: vi.fn(),
    getNode: vi.fn(() => null),
    getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
    setViewport: vi.fn(),
  }),
}));

describe('CompanyStructureOverview theme', () => {
  it('passes the dark MUI appearance to React Flow controls', () => {
    const tree = [{
      id: 'root',
      node_type: 'root',
      title: 'Генеральный директор',
      children: [{
        id: 'admin',
        node_type: 'block',
        title: 'Административный блок',
        children: [],
      }],
    }];

    render(
      <ThemeProvider theme={createTheme({ palette: { mode: 'dark' } })}>
        <CompanyStructureOverview
          tree={tree}
          blockId="admin"
          selectedId="admin"
          onFocus={vi.fn()}
          onPeople={vi.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('company-structure-flow')).toHaveAttribute('data-color-mode', 'dark');
  });

  it('does not show the node type inside an overview card', () => {
    render(
      <ThemeProvider theme={createTheme({ palette: { mode: 'dark' } })}>
        <OverviewNode
          selected
          data={{
            node: {
              id: 'root',
              node_type: 'root',
              title: 'Генеральный директор',
              person_name: 'Водопьянов Юрий Леонидович',
              person_position: 'Генеральный директор',
              child_node_count: 2,
              subtree_people_count: 666,
            },
            expanded: true,
            onToggle: vi.fn(),
            onFocus: vi.fn(),
            onPeople: vi.fn(),
            width: 252,
            height: 142,
          }}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText('Водопьянов Юрий Леонидович')).toBeInTheDocument();
    expect(screen.queryByText('Корень / Гендир')).not.toBeInTheDocument();
  });
});
