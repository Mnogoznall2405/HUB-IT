import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import CompanyStructureOverview, { OverviewNode } from './CompanyStructureOverview';

const { elkLayoutSpy, reactFlowMocks } = vi.hoisted(() => ({
  elkLayoutSpy: vi.fn(() => new Promise(() => {})),
  reactFlowMocks: {
    fitView: vi.fn(),
    getNode: vi.fn(() => null),
    getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
    setViewport: vi.fn(),
  },
}));

vi.mock('elkjs/lib/elk.bundled.js', () => ({
  default: class ElkMock {
    layout(...args) {
      return elkLayoutSpy(...args);
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
  useReactFlow: () => reactFlowMocks,
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

  it('does not re-run elk.layout when callbacks or the selection change identity', () => {
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

    const renderOverview = (selectedId) => (
      <ThemeProvider theme={createTheme({ palette: { mode: 'dark' } })}>
        <CompanyStructureOverview
          tree={tree}
          blockId="admin"
          selectedId={selectedId}
          onFocus={vi.fn()}
          onRoot={vi.fn()}
          onPeople={vi.fn()}
        />
      </ThemeProvider>
    );

    elkLayoutSpy.mockClear();
    const { rerender } = render(renderOverview('admin'));
    const initialCalls = elkLayoutSpy.mock.calls.length;

    rerender(renderOverview('root'));
    rerender(renderOverview('root'));

    expect(elkLayoutSpy).toHaveBeenCalledTimes(initialCalls);
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
