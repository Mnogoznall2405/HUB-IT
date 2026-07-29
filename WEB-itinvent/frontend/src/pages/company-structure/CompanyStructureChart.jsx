import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import CorporateFareOutlinedIcon from '@mui/icons-material/CorporateFareOutlined';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
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

function typeLabel(node) {
  return NODE_TYPE_OPTIONS.find((item) => item.value === node?.node_type)?.label || 'Подразделение';
}

function ChartCard({ node, selected, onSelect }) {
  const accent = TYPE_COLORS[node.node_type] || TYPE_COLORS.other;
  const isPerson = node.node_type === 'root' || node.node_type === 'deputy';
  return (
    <Paper
      component="button"
      type="button"
      variant="outlined"
      onClick={() => onSelect(String(node.id))}
      aria-pressed={selected}
      sx={{
        position: 'relative',
        width: 196,
        height: 92,
        p: 1.25,
        overflow: 'hidden',
        textAlign: 'left',
        color: 'text.primary',
        bgcolor: 'background.paper',
        borderRadius: 1.75,
        borderColor: selected ? accent : 'divider',
        borderWidth: selected ? 2 : 1,
        cursor: 'pointer',
        boxShadow: selected ? '0 8px 18px rgba(15, 23, 42, 0.14)' : '0 2px 8px rgba(15, 23, 42, 0.07)',
        transition: 'transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease',
        '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 7px 16px rgba(15, 23, 42, 0.12)', borderColor: accent },
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
          {node.person_name ? (
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

function DesktopBranch({ node, selectedId, expandedIds, onSelect, onToggle }) {
  const children = Array.isArray(node.children) ? node.children : [];
  const hasChildren = children.length > 0;
  const expanded = expandedIds.has(String(node.id));
  return (
    <Stack alignItems="center" spacing={0} sx={{ width: 'max-content' }}>
      <ChartCard node={node} selected={String(selectedId) === String(node.id)} onSelect={onSelect} />
      {hasChildren ? (
        <>
          <Box sx={{ width: 2, height: 14, bgcolor: 'divider' }} />
          <Button
            size="small"
            variant="outlined"
            onClick={() => onToggle(String(node.id))}
            endIcon={expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            sx={{ borderRadius: 5, bgcolor: 'background.paper', zIndex: 1 }}
          >
            {expanded ? 'Свернуть' : `${children.length} внутри`}
          </Button>
          {expanded ? (
            <Box sx={{ position: 'relative', pt: 2.5 }}>
              {children.length > 1 ? (
                <Box
                  sx={{
                    position: 'absolute',
                    top: 10,
                    left: 98,
                    right: 98,
                    height: 2,
                    bgcolor: 'divider',
                  }}
                />
              ) : null}
              <Stack direction="row" spacing={2} alignItems="flex-start">
                {children.map((child) => (
                  <Stack key={child.id} alignItems="center">
                    <Box sx={{ width: 2, height: 12, bgcolor: 'divider' }} />
                    <DesktopBranch
                      node={child}
                      selectedId={selectedId}
                      expandedIds={expandedIds}
                      onSelect={onSelect}
                      onToggle={onToggle}
                    />
                  </Stack>
                ))}
              </Stack>
            </Box>
          ) : null}
        </>
      ) : null}
    </Stack>
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

export default function CompanyStructureChart({ tree, selectedId, onSelect, isMobile, toolbarAction = null }) {
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [dragging, setDragging] = useState(false);
  const viewportRef = useRef(null);
  const dragRef = useRef(null);

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
          <Button size="small" onClick={() => setExpandedIds(collectExpandableIds(tree))}>
            {isMobile ? 'Всё' : 'Развернуть всё'}
          </Button>
          <Button size="small" color="inherit" onClick={() => setExpandedIds(new Set())}>Свернуть</Button>
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
          <Stack direction="row" justifyContent="center" alignItems="flex-start" sx={{ minWidth: 'max-content' }}>
            {tree.map((node) => (
              <DesktopBranch
                key={node.id}
                node={node}
                selectedId={selectedId}
                expandedIds={expandedIds}
                onSelect={onSelect}
                onToggle={toggle}
              />
            ))}
          </Stack>
        )}
      </Box>
    </Paper>
  );
}
