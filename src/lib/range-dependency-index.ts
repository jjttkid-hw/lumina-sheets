/** Inclusive rectangle coordinates. Bounds are not expanded into member cells. */
export interface DependencyRectangle {
  firstRow: number;
  lastRow: number;
  firstCol: number;
  lastCol: number;
}
interface Entry extends DependencyRectangle {
  handle: number;
  owner: string;
}
interface Node extends Entry {
  left: Node | null;
  right: Node | null;
  height: number;
  bounds: DependencyRectangle;
}
export interface RangeQueryResult {
  owners: Set<string>;
  /** Actual per-rectangle point containment checks after subtree pruning. */
  candidateChecks: number;
  /** All visited nodes, including rejected subtree bounding boxes. */
  nodeVisits: number;
}
const height = (node: Node | null) => node?.height ?? 0;
const compare = (a: Entry, b: Entry) =>
  a.firstRow - b.firstRow || a.firstCol - b.firstCol || a.handle - b.handle;
const contains = (range: DependencyRectangle, row: number, col: number) =>
  row >= range.firstRow && row <= range.lastRow && col >= range.firstCol && col <= range.lastCol;
function refresh(node: Node): Node {
  node.height = 1 + Math.max(height(node.left), height(node.right));
  const left = node.left?.bounds;
  const right = node.right?.bounds;
  node.bounds = {
    firstRow: Math.min(node.firstRow, left?.firstRow ?? Infinity, right?.firstRow ?? Infinity),
    lastRow: Math.max(node.lastRow, left?.lastRow ?? -Infinity, right?.lastRow ?? -Infinity),
    firstCol: Math.min(node.firstCol, left?.firstCol ?? Infinity, right?.firstCol ?? Infinity),
    lastCol: Math.max(node.lastCol, left?.lastCol ?? -Infinity, right?.lastCol ?? -Infinity),
  };
  return node;
}
function rotateLeft(node: Node): Node {
  const next = node.right!;
  node.right = next.left;
  next.left = refresh(node);
  return refresh(next);
}
function rotateRight(node: Node): Node {
  const next = node.left!;
  node.left = next.right;
  next.right = refresh(node);
  return refresh(next);
}
function balance(node: Node): Node {
  refresh(node);
  const skew = height(node.left) - height(node.right);
  if (skew > 1) {
    if (height(node.left!.left) < height(node.left!.right)) node.left = rotateLeft(node.left!);
    return rotateRight(node);
  }
  if (skew < -1) {
    if (height(node.right!.right) < height(node.right!.left)) node.right = rotateRight(node.right!);
    return rotateLeft(node);
  }
  return node;
}
function insert(node: Node | null, entry: Entry): Node {
  if (!node) return { ...entry, left: null, right: null, height: 1, bounds: { ...entry } };
  if (compare(entry, node) < 0) node.left = insert(node.left, entry);
  else node.right = insert(node.right, entry);
  return balance(node);
}
function remove(node: Node | null, entry: Entry): Node | null {
  if (!node) return null;
  const order = compare(entry, node);
  if (order < 0) node.left = remove(node.left, entry);
  else if (order > 0) node.right = remove(node.right, entry);
  else {
    if (!node.left) return node.right;
    if (!node.right) return node.left;
    let next = node.right;
    while (next.left) next = next.left;
    const { handle, owner, firstRow, lastRow, firstCol, lastCol } = next;
    Object.assign(node, { handle, owner, firstRow, lastRow, firstCol, lastCol });
    node.right = remove(node.right, next);
  }
  return balance(node);
}

/**
 * Dynamic point lookup over inclusive rectangles, one AVL node per rectangle.
 * Subtree bounding boxes prune queries in both dimensions. Insertion/removal
 * are O(log n); point queries can still be O(n) for overlapping/wide envelopes.
 */
export class RangeDependencyIndex {
  private root: Node | null = null;
  private entries = new Map<number, Entry>();
  private byOwner = new Map<string, Set<number>>();
  private nextHandle = 1;

  get size(): number {
    return this.entries.size;
  }
  get nodeCount(): number {
    return this.entries.size;
  }

  add(owner: string, rectangle: DependencyRectangle): number {
    const { firstRow, lastRow, firstCol, lastCol } = rectangle;
    if (
      ![firstRow, lastRow, firstCol, lastCol].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      ) ||
      firstRow > lastRow ||
      firstCol > lastCol
    )
      throw new RangeError('Invalid dependency rectangle');
    const handle = this.nextHandle++;
    const entry: Entry = { owner, handle, firstRow, lastRow, firstCol, lastCol };
    this.root = insert(this.root, entry);
    this.entries.set(handle, entry);
    let handles = this.byOwner.get(owner);
    if (!handles) this.byOwner.set(owner, (handles = new Set()));
    handles.add(handle);
    return handle;
  }

  remove(handle: number): boolean {
    const entry = this.entries.get(handle);
    if (!entry) return false;
    this.root = remove(this.root, entry);
    this.entries.delete(handle);
    const handles = this.byOwner.get(entry.owner);
    handles?.delete(handle);
    if (handles?.size === 0) this.byOwner.delete(entry.owner);
    return true;
  }

  removeOwner(owner: string): number {
    const handles = this.byOwner.get(owner);
    if (!handles) return 0;
    const count = handles.size;
    for (const handle of [...handles]) this.remove(handle);
    return count;
  }

  query(row: number, col: number): RangeQueryResult {
    const result: RangeQueryResult = { owners: new Set(), candidateChecks: 0, nodeVisits: 0 };
    if (!Number.isSafeInteger(row) || !Number.isSafeInteger(col) || row < 0 || col < 0)
      return result;
    const pending: Node[] = this.root ? [this.root] : [];
    while (pending.length) {
      const node = pending.pop()!;
      result.nodeVisits++;
      if (!contains(node.bounds, row, col)) continue;
      result.candidateChecks++;
      if (contains(node, row, col)) result.owners.add(node.owner);
      if (node.left) pending.push(node.left);
      if (node.right) pending.push(node.right);
    }
    return result;
  }

  clear(): void {
    this.root = null;
    this.entries.clear();
    this.byOwner.clear();
    // Handles remain monotonic, so stale handles cannot delete later entries.
  }
}
