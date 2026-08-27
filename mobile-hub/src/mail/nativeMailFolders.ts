import type { MailFolderNode, MailFolderSummary } from '../api/mailApi';
import { MAIL_STANDARD_FOLDERS, mailFolderLabel } from './nativeMailModel';

export type NativeMailFolderOption = {
  id: string;
  label: string;
  pathLabel: string;
  unread: number;
  standard: boolean;
  favorite: boolean;
  depth: number;
};

function nodeId(node: MailFolderNode): string {
  return String(node.id || node.folder_id || node.key || '').trim();
}

function nodeLabel(node: MailFolderNode, id: string): string {
  return String(node.label || node.display_name || node.name || '').trim() || mailFolderLabel(id);
}

export function buildNativeMailFolderOptions(
  tree: MailFolderNode[] = [],
  summary: MailFolderSummary = {},
  { favoritesFirst = false }: { favoritesFirst?: boolean } = {},
): NativeMailFolderOption[] {
  const source = Array.isArray(tree) ? tree : [];
  const nodes = new Map<string, MailFolderNode>();
  source.forEach((node) => {
    const id = nodeId(node);
    if (id && !nodes.has(id)) nodes.set(id, node);
  });

  MAIL_STANDARD_FOLDERS.forEach((folder) => {
    if (!nodes.has(folder.key)) {
      nodes.set(folder.key, {
        id: folder.key,
        label: folder.label,
        well_known_key: folder.key,
        unread: Number(summary[folder.key]?.unread || 0),
      });
    }
  });

  const resolvePath = (id: string): { labels: string[]; depth: number } => {
    const labels: string[] = [];
    const visited = new Set<string>();
    let current = nodes.get(id);
    while (current && labels.length < 6) {
      const currentId = nodeId(current);
      if (!currentId || visited.has(currentId)) break;
      visited.add(currentId);
      labels.unshift(nodeLabel(current, currentId));
      const parentId = String(current.parent_id || '').trim();
      current = parentId ? nodes.get(parentId) : undefined;
    }
    return { labels, depth: Math.max(0, labels.length - 1) };
  };

  const standardOrder = new Map<string, number>(MAIL_STANDARD_FOLDERS.map((folder, index) => [folder.key, index]));
  return [...nodes.entries()]
    .map(([id, node]) => {
      const wellKnown = String(node.well_known_key || '').trim().toLowerCase();
      const standard = standardOrder.has(id) || standardOrder.has(wellKnown);
      const path = resolvePath(id);
      const summaryKey = wellKnown || id;
      return {
        id,
        label: nodeLabel(node, id),
        pathLabel: path.labels.join(' / ') || nodeLabel(node, id),
        unread: Math.max(0, Number(node.unread ?? summary[summaryKey]?.unread ?? 0)),
        standard,
        favorite: Boolean(node.is_favorite),
        depth: path.depth,
      };
    })
    .sort((left, right) => {
      const leftOrder = standardOrder.get(left.id);
      const rightOrder = standardOrder.get(right.id);
      if (leftOrder !== undefined || rightOrder !== undefined) {
        return (leftOrder ?? 100) - (rightOrder ?? 100);
      }
      if (favoritesFirst && left.favorite !== right.favorite) return left.favorite ? -1 : 1;
      return left.pathLabel.localeCompare(right.pathLabel, 'ru');
    });
}
