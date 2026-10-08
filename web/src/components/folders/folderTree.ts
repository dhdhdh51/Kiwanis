import type { Folder } from '../../lib/types';

export interface TreeNode extends Folder {
  depth: number;
  children: TreeNode[];
}

export function buildTree(folders: Folder[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>(folders.map((f) => [f.id, { ...f, depth: 0, children: [] }]));
  const roots: TreeNode[] = [];
  for (const n of nodes.values()) {
    const parent = n.parentId ? nodes.get(n.parentId) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  const sort = (list: TreeNode[], depth: number) => {
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    list.forEach((n) => {
      n.depth = depth;
      sort(n.children, depth + 1);
    });
  };
  sort(roots, 0);
  return roots;
}

/** Depth-first flattened tree, convenient for selects and pickers. */
export function flattenTree(folders: Folder[]): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (list: TreeNode[]) => list.forEach((n) => (out.push(n), walk(n.children)));
  walk(buildTree(folders));
  return out;
}
