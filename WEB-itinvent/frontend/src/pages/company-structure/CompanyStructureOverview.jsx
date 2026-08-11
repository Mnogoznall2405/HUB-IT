import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import CenterFocusStrongOutlinedIcon from '@mui/icons-material/CenterFocusStrongOutlined';
import CorporateFareOutlinedIcon from '@mui/icons-material/CorporateFareOutlined';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import { useTheme } from '@mui/material/styles';
import ELK from 'elkjs/lib/elk.bundled.js';
import {
  Background,
  BaseEdge,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  collectVisibleSemanticGraph,
  initialExpandedIdsForBlock,
  nodeCardTitle,
} from './companyStructureModel';
import {
  buildSemanticEdgeRoutes,
  buildSemanticLongEdgePath,
  wrapSemanticBands,
} from './companyStructureLayout';

const elk = new ELK();
const COMPACT_WIDTH = 224;
const COMPACT_HEIGHT = 108;
const LEADER_WIDTH = 252;
const LEADER_HEIGHT = 142;

function initials(value) {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '—';
}

function hasLeader(node) {
  return (node?.node_type === 'root' || node?.node_type === 'deputy')
    && Boolean(node?.person_employee_code || node?.person_name || node?.person_position);
}

function nodeDimensions(node) {
  return hasLeader(node)
    ? { width: LEADER_WIDTH, height: LEADER_HEIGHT }
    : { width: COMPACT_WIDTH, height: COMPACT_HEIGHT };
}

export const OverviewNode = memo(function OverviewNode({ data, selected }) {
  const { node, expanded, onToggle, onFocus, onPeople } = data;
  const childrenCount = Number(node?.child_node_count ?? node?.children?.length ?? 0);
  const peopleCount = Number(node?.subtree_people_count || 0);
  const leader = hasLeader(node);
  return (
    <Paper
      elevation={0}
      sx={{
        width: data.width,
        minHeight: data.height,
        overflow: 'hidden',
        borderRadius: 2.5,
        bgcolor: 'background.paper',
        boxShadow: selected
          ? (theme) => `0 0 0 2px ${theme.palette.primary.main}, 0 10px 30px rgba(15, 23, 42, 0.12)`
          : '0 0 0 1px rgba(100, 116, 139, 0.25), 0 6px 20px rgba(15, 23, 42, 0.08)',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: 'none' }} />
      <Box
        component="button"
        type="button"
        onClick={() => onFocus(String(node.id))}
        sx={{
          display: 'block',
          width: '100%',
          minHeight: leader ? 96 : 65,
          p: 1.5,
          border: 0,
          textAlign: 'start',
          color: 'text.primary',
          bgcolor: 'transparent',
          cursor: 'pointer',
          transition: 'background-color 120ms ease-out',
          '&:hover': { bgcolor: 'action.hover' },
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -3 },
        }}
      >
        <Stack direction="row" spacing={1.25} alignItems="flex-start">
          {leader ? (
            <Avatar
              src={node.person_photo_url || undefined}
              alt=""
              sx={{ width: 44, height: 44, flexShrink: 0, outline: '1px solid rgba(255,255,255,0.1)', outlineOffset: -1 }}
            >
              {initials(node.person_name || node.title)}
            </Avatar>
          ) : (
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: 1.5,
                display: 'grid',
                placeItems: 'center',
                bgcolor: 'action.hover',
                color: 'primary.main',
                flexShrink: 0,
              }}
            >
              <CorporateFareOutlinedIcon fontSize="small" />
            </Box>
          )}
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              variant="subtitle2"
              fontWeight={750}
              sx={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                lineHeight: 1.25,
              }}
            >
              {nodeCardTitle(node)}
            </Typography>
            {leader && node.person_name ? (
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mt: 0.5 }}>
                {node.person_name}
              </Typography>
            ) : null}
          </Box>
        </Stack>
      </Box>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ minHeight: 42, px: 1, borderTop: '1px solid', borderColor: 'divider' }}
      >
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Tooltip title="Сотрудники во всей ветке">
            <Button
              size="small"
              color="inherit"
              startIcon={<GroupsOutlinedIcon fontSize="small" />}
              onClick={() => onPeople(String(node.id))}
              sx={{ minHeight: 36, px: 1, color: 'text.secondary' }}
            >
              {peopleCount}
            </Button>
          </Tooltip>
          {childrenCount ? (
            <Typography variant="caption" color="text.secondary">Внутри {childrenCount}</Typography>
          ) : null}
        </Stack>
        {childrenCount ? (
          <Tooltip title={expanded ? 'Свернуть ветку' : 'Развернуть ветку'}>
            <IconButton
              size="small"
              aria-label={expanded ? `Свернуть ${nodeCardTitle(node)}` : `Развернуть ${nodeCardTitle(node)}`}
              aria-expanded={expanded}
              onClick={() => onToggle(String(node.id))}
              sx={{ width: 36, height: 36 }}
            >
              {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        ) : null}
      </Stack>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: 'none' }} />
    </Paper>
  );
});

const nodeTypes = { orgCard: OverviewNode };

const SemanticLongEdge = memo(function SemanticLongEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  markerEnd,
  style,
}) {
  const path = buildSemanticLongEdgePath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    laneX: Number(data?.laneX ?? sourceX),
  });
  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />;
});

const edgeTypes = { semanticLong: SemanticLongEdge };

function buildElkInput(graph) {
  const children = graph.nodes.map(({ node, nodeId }) => ({
    id: nodeId,
    ...nodeDimensions(node),
  }));
  const edges = [];
  graph.edges.forEach((edge) => {
    let previousId = edge.source;
    const skippedLevels = Math.max(0, edge.targetLevel - edge.sourceLevel - 1);
    for (let index = 0; index < skippedLevels; index += 1) {
      const spacerId = `__spacer__${edge.id}__${index}`;
      children.push({ id: spacerId, width: 1, height: 1 });
      edges.push({ id: `${edge.id}-spacer-${index}`, sources: [previousId], targets: [spacerId] });
      previousId = spacerId;
    }
    edges.push({ id: `${edge.id}-final`, sources: [previousId], targets: [edge.target] });
  });
  return {
    id: 'org-chart',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '44',
      'elk.layered.spacing.nodeNodeBetweenLayers': '92',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.padding': '[top=32,left=32,bottom=32,right=32]',
    },
    children,
    edges,
  };
}

function OverviewCanvas({ tree, blockId, selectedId, onFocus, onRoot, onPeople }) {
  const theme = useTheme();
  const { fitView, getNode, getViewport, setViewport } = useReactFlow();
  const [expandedIds, setExpandedIds] = useState(() => initialExpandedIdsForBlock(tree, blockId));
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [layoutLoading, setLayoutLoading] = useState(true);
  const layoutVersionRef = useRef(0);
  const anchorRef = useRef(null);
  const fittedBlockRef = useRef('');
  const latestTreeRef = useRef(tree);
  latestTreeRef.current = tree;

  useEffect(() => {
    setExpandedIds(initialExpandedIdsForBlock(latestTreeRef.current, blockId));
    fittedBlockRef.current = '';
  }, [blockId]);

  const graph = useMemo(
    () => collectVisibleSemanticGraph(tree, blockId, expandedIds),
    [blockId, expandedIds, tree],
  );

  const toggleNode = useCallback((nodeId) => {
    const currentNode = getNode(nodeId);
    const viewport = getViewport();
    if (currentNode) {
      anchorRef.current = {
        nodeId,
        screenX: (currentNode.position.x + (currentNode.measured?.width || currentNode.width || COMPACT_WIDTH) / 2) * viewport.zoom + viewport.x,
        screenY: (currentNode.position.y + (currentNode.measured?.height || currentNode.height || COMPACT_HEIGHT) / 2) * viewport.zoom + viewport.y,
        zoom: viewport.zoom,
      };
    }
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
      return next;
    });
  }, [getNode, getViewport]);

  useEffect(() => {
    const version = layoutVersionRef.current + 1;
    layoutVersionRef.current = version;
    setLayoutLoading(true);
    elk.layout(buildElkInput(graph)).then((layout) => {
      if (layoutVersionRef.current !== version) return;
      const positioned = new Map((layout.children || []).map((item) => [String(item.id), item]));
      const wrapped = wrapSemanticBands(graph.nodes.map(({ node, nodeId, level }) => {
        const elkPosition = positioned.get(nodeId);
        const dimensions = nodeDimensions(node);
        return {
          id: nodeId,
          level,
          elkX: Number(elkPosition?.x || 0),
          ...dimensions,
        };
      }));
      const nextNodes = graph.nodes.map(({ node, nodeId, level }) => {
        const position = wrapped.positions.get(nodeId) || { x: 0, y: level * 180 };
        const dimensions = nodeDimensions(node);
        return {
          id: nodeId,
          type: 'orgCard',
          position: { x: Number(position.x || 0), y: Number(position.y || 0) },
          width: dimensions.width,
          height: dimensions.height,
          selected: String(selectedId) === nodeId,
          data: {
            node,
            level,
            expanded: expandedIds.has(nodeId),
            onToggle: toggleNode,
            onFocus,
            onPeople,
            ...dimensions,
          },
        };
      });
      const nextEdges = buildSemanticEdgeRoutes(graph, nextNodes).map((edge) => ({
        ...edge,
        style: { stroke: 'rgba(100, 116, 139, 0.55)', strokeWidth: 1.25 },
      }));
      setNodes(nextNodes);
      setEdges(nextEdges);
      setLayoutLoading(false);

      window.requestAnimationFrame(() => {
        const anchor = anchorRef.current;
        const anchoredNode = anchor ? nextNodes.find((item) => item.id === anchor.nodeId) : null;
        if (anchor && anchoredNode) {
          const width = Number(anchoredNode.width || COMPACT_WIDTH);
          const height = Number(anchoredNode.height || COMPACT_HEIGHT);
          void setViewport({
            x: anchor.screenX - (anchoredNode.position.x + width / 2) * anchor.zoom,
            y: anchor.screenY - (anchoredNode.position.y + height / 2) * anchor.zoom,
            zoom: anchor.zoom,
          }, { duration: 0 });
          anchorRef.current = null;
        } else if (fittedBlockRef.current !== graph.blockId) {
          fittedBlockRef.current = graph.blockId;
          void fitView({ padding: 0.18, minZoom: 0.35, maxZoom: 0.9, duration: 0 });
        }
      });
    }).catch(() => {
      if (layoutVersionRef.current === version) setLayoutLoading(false);
    });
  }, [expandedIds, fitView, graph, onFocus, onPeople, selectedId, setViewport, toggleNode]);

  const resetToRoot = () => {
    setExpandedIds(initialExpandedIdsForBlock(tree, blockId));
    (onRoot || onFocus)(graph.rootId);
  };

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden', bgcolor: 'background.default' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        justifyContent="space-between"
        spacing={1}
        sx={{ px: 2, py: 1.25, bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <AccountTreeOutlinedIcon color="primary" />
          <Box>
            <Typography variant="subtitle1" fontWeight={750}>Вертикальный обзор</Typography>
            <Typography variant="caption" color="text.secondary">Подразделения выровнены по смысловым уровням</Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button size="small" startIcon={<HomeOutlinedIcon />} onClick={resetToRoot}>К корню</Button>
          <Button
            size="small"
            startIcon={<CenterFocusStrongOutlinedIcon />}
            onClick={() => fitView({ padding: 0.18, minZoom: 0.35, maxZoom: 0.9, duration: 0 })}
          >
            Показать всё
          </Button>
        </Stack>
      </Stack>
      <Box sx={{ position: 'relative', height: { xs: 520, md: '68vh' }, minHeight: { md: 560 } }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          colorMode={theme.palette.mode}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          panOnScroll
          minZoom={0.3}
          maxZoom={1.2}
          onlyRenderVisibleElements
          fitView={false}
          aria-label="Вертикальная схема подчинённости"
        >
          <Background gap={24} size={1} color="rgba(100, 116, 139, 0.18)" />
          <Controls showInteractive={false} />
        </ReactFlow>
        {layoutLoading ? (
          <Box
            role="status"
            sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}
          >
            <CircularProgress size={28} />
          </Box>
        ) : null}
      </Box>
    </Paper>
  );
}

export default function CompanyStructureOverview(props) {
  return (
    <ReactFlowProvider>
      <OverviewCanvas {...props} />
    </ReactFlowProvider>
  );
}
