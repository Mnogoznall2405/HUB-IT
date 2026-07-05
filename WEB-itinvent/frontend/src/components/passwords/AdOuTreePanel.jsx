import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  CircularProgress,
  Collapse,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import { adUsersAPI } from '../../api/adUsers';

function OuTreeNode({
  item,
  depth,
  selectedDn,
  onSelect,
  childrenCache,
  loadingKeys,
  expandedKeys,
  onToggle,
  onLoadChildren,
  onChildrenResolved,
}) {
  const dn = item.dn;
  const isExpanded = expandedKeys.has(dn);
  const isLoading = loadingKeys.has(dn);
  const children = childrenCache[dn] || [];
  const hasChildren = item.has_children !== false;

  const handleToggle = async (event) => {
    event.stopPropagation();
    if (!hasChildren) return;
    const willExpand = !isExpanded;
    onToggle(dn, willExpand);
    if (willExpand && !childrenCache[dn]) {
      const loaded = await onLoadChildren(dn);
      if (!loaded.length) {
        onChildrenResolved(dn, false);
      }
    }
  };

  return (
    <>
      <ListItemButton
        dense
        selected={selectedDn === dn}
        onClick={() => onSelect(dn, item.label)}
        sx={{
          pl: 0.25 + depth * 0.85,
          py: 0,
          minHeight: 26,
          borderRadius: 0.75,
        }}
        data-testid={`password-expiry-ou-node-${depth}`}
      >
        <Box
          component="span"
          onClick={hasChildren ? handleToggle : undefined}
          sx={{
            width: 18,
            height: 18,
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            mr: 0.125,
            color: 'text.secondary',
            cursor: hasChildren ? 'pointer' : 'default',
          }}
        >
          {hasChildren ? (
            isLoading ? <CircularProgress size={11} /> : (isExpanded ? <ExpandMoreIcon sx={{ fontSize: 16 }} /> : <ChevronRightIcon sx={{ fontSize: 16 }} />)
          ) : (
            <Box sx={{ width: 16 }} />
          )}
        </Box>
        <FolderOutlinedIcon sx={{ fontSize: 14, mr: 0.375, flexShrink: 0, color: 'text.secondary' }} />
        <ListItemText
          primary={item.label}
          primaryTypographyProps={{
            variant: 'caption',
            noWrap: true,
            title: item.label,
            sx: { fontSize: '0.75rem', lineHeight: 1.25 },
          }}
          sx={{ my: 0, minWidth: 0 }}
        />
      </ListItemButton>
      {hasChildren ? (
        <Collapse in={isExpanded} timeout="auto" unmountOnExit>
          <List
            disablePadding
            sx={{
              ml: 1.1,
              pl: 0.5,
              borderLeft: '1px solid',
              borderColor: 'divider',
            }}
          >
            {children.map((child) => (
              <OuTreeNode
                key={child.dn}
                item={child}
                depth={depth + 1}
                selectedDn={selectedDn}
                onSelect={onSelect}
                childrenCache={childrenCache}
                loadingKeys={loadingKeys}
                expandedKeys={expandedKeys}
                onToggle={onToggle}
                onLoadChildren={onLoadChildren}
                onChildrenResolved={onChildrenResolved}
              />
            ))}
          </List>
        </Collapse>
      ) : null}
    </>
  );
}

export default function AdOuTreePanel({
  rootItem,
  selectedDn,
  onSelect,
}) {
  const [childrenCache, setChildrenCache] = useState({});
  const [nodeMeta, setNodeMeta] = useState({});
  const [loadingKeys, setLoadingKeys] = useState(() => new Set());
  const [expandedKeys, setExpandedKeys] = useState(() => new Set());
  const [loadingRoot, setLoadingRoot] = useState(false);

  const loadChildren = useCallback(async (parentDn, { force = false } = {}) => {
    if (!parentDn) return [];
    const loadingKey = parentDn;
    setLoadingKeys((prev) => new Set(prev).add(loadingKey));
    try {
      const payload = await adUsersAPI.getOrganizationalUnits(parentDn, { force });
      if (payload?.status === 'error') {
        throw new Error(payload?.error || 'Не удалось загрузить OU');
      }
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setChildrenCache((prev) => ({ ...prev, [parentDn]: items }));
      return items;
    } catch (loadError) {
      throw loadError;
    } finally {
      setLoadingKeys((prev) => {
        const next = new Set(prev);
        next.delete(loadingKey);
        return next;
      });
    }
  }, []);

  const reloadExpandedNodes = useCallback(async ({ force = false } = {}) => {
    if (!rootItem?.dn) return;
    setLoadingRoot(true);
    try {
      if (force) {
        setChildrenCache({});
      }
      const targets = expandedKeys.size ? Array.from(expandedKeys) : [rootItem.dn];
      await Promise.all(targets.map((dn) => loadChildren(dn, { force })));
    } finally {
      setLoadingRoot(false);
    }
  }, [expandedKeys, loadChildren, rootItem?.dn]);

  useEffect(() => {
    if (!rootItem?.dn) return undefined;
    let active = true;

    const boot = async () => {
      setLoadingRoot(true);
      setExpandedKeys(new Set([rootItem.dn]));
      try {
        await loadChildren(rootItem.dn);
      } catch {
        // Parent handles OU errors.
      } finally {
        if (active) setLoadingRoot(false);
      }
    };

    boot();
    return () => {
      active = false;
    };
  }, [loadChildren, rootItem?.dn]);

  const handleToggle = (dn, willExpand) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (willExpand) next.add(dn);
      else next.delete(dn);
      return next;
    });
  };

  const handleLoadChildren = async (parentDn, options) => {
    if (!options?.force && childrenCache[parentDn]) return childrenCache[parentDn];
    return loadChildren(parentDn, options);
  };

  const handleChildrenResolved = (dn, hasChildren) => {
    setNodeMeta((prev) => ({ ...prev, [dn]: { has_children: hasChildren } }));
  };

  const enrichItem = (item) => ({
    ...item,
    has_children: nodeMeta[item.dn]?.has_children ?? item.has_children,
  });

  if (!rootItem?.dn) {
    return null;
  }

  const scopeItem = enrichItem(rootItem);

  return (
    <Box data-testid="password-expiry-ou-tree" sx={{ py: 0 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 0.5, pb: 0.5 }}>
        <Typography
          variant="caption"
          color="text.secondary"
          fontWeight={700}
          sx={{ fontSize: '0.6875rem', letterSpacing: 0.3, textTransform: 'uppercase' }}
        >
          Дерево OU
        </Typography>
        <Tooltip title="Принудительно запросить свежие OU из AD">
          <span>
            <IconButton
              size="small"
              aria-label="Обновить дерево OU"
              data-testid="password-expiry-ou-refresh"
              onClick={() => reloadExpandedNodes({ force: true })}
              disabled={loadingRoot}
              sx={{ p: 0.25 }}
            >
              <RefreshOutlinedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      {loadingRoot ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }} data-testid="password-expiry-ou-loading">
          <CircularProgress size={20} />
        </Box>
      ) : (
        <List dense disablePadding sx={{ py: 0 }}>
          <OuTreeNode
            item={scopeItem}
            depth={0}
            selectedDn={selectedDn}
            onSelect={onSelect}
            childrenCache={childrenCache}
            loadingKeys={loadingKeys}
            expandedKeys={expandedKeys}
            onToggle={handleToggle}
            onLoadChildren={handleLoadChildren}
            onChildrenResolved={handleChildrenResolved}
          />
        </List>
      )}
    </Box>
  );
}
