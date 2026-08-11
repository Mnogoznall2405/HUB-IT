import { useMemo } from 'react';
import {
  Avatar,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import CorporateFareOutlinedIcon from '@mui/icons-material/CorporateFareOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import {
  NODE_TYPE_OPTIONS,
  SEMANTIC_LEVEL_LABELS,
  buildSemanticLevelMap,
  nodeCardTitle,
} from './companyStructureModel';
import EmployeeDirectoryPanel from './EmployeeDirectoryPanel';

function initials(value) {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '—';
}

function nodeTypeLabel(node) {
  return NODE_TYPE_OPTIONS.find((option) => option.value === node?.node_type)?.label || 'Подразделение';
}

function hasLeader(node) {
  return (node?.node_type === 'root' || node?.node_type === 'deputy')
    && Boolean(node?.person_employee_code || node?.person_name || node?.person_position);
}

function FocusNodeCard({ node, selected = false, onSelect, onPeople }) {
  const leader = hasLeader(node);
  const peopleCount = Number(node?.subtree_people_count || 0);
  const childCount = Number(node?.child_node_count ?? node?.children?.length ?? 0);
  return (
    <Paper
      data-testid="focus-node-card"
      data-selected={selected ? 'true' : 'false'}
      elevation={0}
      sx={{
        width: '100%',
        maxWidth: selected ? 420 : 300,
        height: selected ? 156 : 136,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 2.5,
        overflow: 'hidden',
        bgcolor: 'background.paper',
        boxShadow: selected
          ? (theme) => `0 0 0 2px ${theme.palette.primary.main}, 0 12px 30px rgba(15, 23, 42, 0.12)`
          : '0 0 0 1px rgba(100, 116, 139, 0.22), 0 6px 18px rgba(15, 23, 42, 0.07)',
      }}
    >
      <Box
        component="button"
        type="button"
        onClick={() => onSelect?.(String(node.id))}
        sx={{
          width: '100%',
          height: selected ? 112 : 92,
          minHeight: selected ? 112 : 92,
          display: 'block',
          overflow: 'hidden',
          border: 0,
          p: selected ? 2 : 1.5,
          bgcolor: 'transparent',
          color: 'text.primary',
          textAlign: 'start',
          cursor: onSelect ? 'pointer' : 'default',
          transition: 'background-color 120ms ease-out',
          '&:hover': onSelect ? { bgcolor: 'action.hover' } : undefined,
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -3 },
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          {leader ? (
            <Avatar src={node.person_photo_url || undefined} alt="" sx={{ width: selected ? 54 : 42, height: selected ? 54 : 42 }}>
              {initials(node.person_name || node.title)}
            </Avatar>
          ) : (
            <Box
              sx={{
                width: 40,
                height: 40,
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
              variant={selected ? 'h6' : 'subtitle2'}
              fontWeight={750}
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
            {leader && node.person_name ? (
              <Typography variant="body2" color="text.secondary" noWrap sx={{ mt: 0.5 }}>{node.person_name}</Typography>
            ) : null}
            {leader && node.person_position && node.person_position !== node.title ? (
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                {node.person_position}
              </Typography>
            ) : null}
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mt: 0.25 }}>
              {nodeTypeLabel(node)}
            </Typography>
          </Box>
        </Stack>
      </Box>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ height: 44, minHeight: 44, flexShrink: 0, px: 1.25, borderTop: '1px solid', borderColor: 'divider' }}
      >
        <Typography variant="caption" color="text.secondary">Внутри: {childCount}</Typography>
        <Button
          size="small"
          startIcon={<GroupsOutlinedIcon />}
          onClick={() => onPeople?.(String(node.id))}
          sx={{ minHeight: 36 }}
        >
          Сотрудники · {peopleCount}
        </Button>
      </Stack>
    </Paper>
  );
}

export default function CompanyStructureFocus({
  tree,
  selectedNode,
  selectedPath,
  people,
  peopleLoading,
  focusedPerson,
  onSelect,
  onPeople,
}) {
  const levelMap = useMemo(() => buildSemanticLevelMap(tree), [tree]);
  const childGroups = useMemo(() => {
    const groups = new Map();
    (Array.isArray(selectedNode?.children) ? selectedNode.children : []).forEach((child) => {
      const level = levelMap.get(String(child.id)) ?? 0;
      if (!groups.has(level)) groups.set(level, []);
      groups.get(level).push(child);
    });
    return [...groups.entries()].sort(([left], [right]) => left - right);
  }, [levelMap, selectedNode]);
  const rootNode = selectedPath[0] || null;
  const showRootContext = rootNode && String(rootNode.id) !== String(selectedNode?.id);

  return (
    <Stack spacing={2.5}>
      <Breadcrumbs separator="›" aria-label="Путь в структуре" sx={{ px: 0.5 }}>
        {selectedPath.map((node, index) => (
          index === selectedPath.length - 1 ? (
            <Typography key={node.id} variant="body2" color="text.primary" fontWeight={650}>
              {nodeCardTitle(node)}
            </Typography>
          ) : (
            <Button
              key={node.id}
              size="small"
              color="inherit"
              onClick={() => onSelect(String(node.id))}
              sx={{ minWidth: 0, px: 0.5, textTransform: 'none' }}
            >
              {nodeCardTitle(node)}
            </Button>
          )
        ))}
      </Breadcrumbs>

      <Stack alignItems="center" spacing={0}>
        {showRootContext ? (
          <>
            <Box sx={{ width: '100%', maxWidth: 300 }}>
              <FocusNodeCard node={rootNode} onSelect={onSelect} onPeople={onPeople} />
            </Box>
            <Box sx={{ width: 1.5, height: 38, bgcolor: 'divider' }} />
            {selectedPath.length > 2 ? (
              <Stack direction="row" flexWrap="wrap" justifyContent="center" gap={0.75} sx={{ mb: 1.5 }}>
                {selectedPath.slice(1, -1).map((node) => (
                  <Chip
                    key={node.id}
                    size="small"
                    icon={<AccountTreeOutlinedIcon />}
                    label={nodeCardTitle(node)}
                    onClick={() => onSelect(String(node.id))}
                  />
                ))}
              </Stack>
            ) : null}
          </>
        ) : null}
        <FocusNodeCard node={selectedNode} selected onSelect={onSelect} onPeople={onPeople} />
      </Stack>

      {childGroups.length ? (
        <Stack spacing={3}>
          {childGroups.map(([level, children], index) => (
            <Box key={level} sx={{ position: 'relative', pt: 3 }}>
              <Box
                aria-hidden="true"
                sx={{
                  position: 'absolute',
                  top: 0,
                  insetInlineStart: '50%',
                  width: 1.5,
                  height: 24,
                  bgcolor: 'divider',
                }}
              />
              <Stack direction="row" justifyContent="center" sx={{ mb: 1.5 }}>
                <Chip
                  size="small"
                  variant="outlined"
                  label={SEMANTIC_LEVEL_LABELS[level] || `Уровень ${level + 1}`}
                />
              </Stack>
              <Box
                data-testid={`focus-level-${level}`}
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  gap: 1.5,
                  alignItems: 'start',
                  maxWidth: 1500,
                  mx: 'auto',
                }}
              >
                {children.map((child) => (
                  <Box
                    key={child.id}
                    sx={{
                      display: 'flex',
                      justifyContent: 'center',
                      minWidth: 0,
                      flex: {
                        xs: '1 1 100%',
                        sm: '0 1 calc(50% - 6px)',
                        md: '0 1 calc(33.333% - 8px)',
                        xl: '0 1 calc(20% - 10px)',
                      },
                    }}
                  >
                    <FocusNodeCard node={child} onSelect={onSelect} onPeople={onPeople} />
                  </Box>
                ))}
              </Box>
              {index < childGroups.length - 1 ? (
                <Box aria-hidden="true" sx={{ width: 1.5, height: 24, bgcolor: 'divider', mx: 'auto', mt: 1.5 }} />
              ) : null}
            </Box>
          ))}
        </Stack>
      ) : (
        <Paper
          variant="outlined"
          sx={{
            width: '100%',
            maxWidth: 1280,
            alignSelf: 'center',
            p: { xs: 1.5, sm: 2, md: 2.5 },
            borderRadius: 3,
            bgcolor: 'background.paper',
          }}
        >
          <EmployeeDirectoryPanel
            people={people}
            loading={peopleLoading}
            focusedPerson={focusedPerson}
          />
        </Paper>
      )}
    </Stack>
  );
}
