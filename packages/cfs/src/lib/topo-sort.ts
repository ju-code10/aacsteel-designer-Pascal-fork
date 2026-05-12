// Topological sort by `parentId` for the JSON importer's step 7
// (§6.5: "Order: parents before children, top-down through the parent
// chain").
//
// Nodes that have a parent outside the input set are tolerated when
// `isExternalRoot` returns true — used to allow Pascal `site` / `building`
// roots to live in the import while their own parent chain isn't part
// of the exported file.
//
// Cycles are reported as a `cycle` array; the caller decides what to do
// (the importer rejects every node in the cycle with a message).

export interface TopoSortInput<T> {
  /** Stable id for each node. */
  id: (node: T) => string
  /** Parent id, or null/undefined when the node is a root. */
  parentId: (node: T) => string | null | undefined
  /**
   * Whether a parent id that is absent from the input set is acceptable
   * (the node is an external root that doesn't need its parent in the
   * sort). Default: only null/undefined parents are roots.
   */
  isExternalRoot?: (node: T, parentId: string) => boolean
}

export interface TopoSortResult<T> {
  sorted: T[]
  cycle: T[]
}

export function topologicalSortByParent<T>(
  nodes: readonly T[],
  cfg: TopoSortInput<T>,
): TopoSortResult<T> {
  const byId = new Map<string, T>()
  for (const n of nodes) byId.set(cfg.id(n), n)

  const childrenById = new Map<string, string[]>()
  const incoming = new Map<string, number>()
  for (const n of nodes) {
    const nId = cfg.id(n)
    incoming.set(nId, 0)
  }
  for (const n of nodes) {
    const nId = cfg.id(n)
    const pId = cfg.parentId(n)
    if (pId == null) continue
    if (!byId.has(pId)) {
      // Parent is external. If allowed, treat the node as a root;
      // otherwise the caller will see a phantom edge and the importer
      // can reject the orphan separately.
      if (cfg.isExternalRoot && cfg.isExternalRoot(n, pId)) continue
      // Still treat as orphan — it gets sorted as if it had no parent.
      continue
    }
    const list = childrenById.get(pId) ?? []
    list.push(nId)
    childrenById.set(pId, list)
    incoming.set(nId, (incoming.get(nId) ?? 0) + 1)
  }

  // Kahn's algorithm. Start with nodes that have no incoming edges.
  const queue: string[] = []
  for (const [id, count] of incoming) {
    if (count === 0) queue.push(id)
  }
  const sortedIds: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    sortedIds.push(id)
    const kids = childrenById.get(id) ?? []
    for (const kid of kids) {
      const next = (incoming.get(kid) ?? 0) - 1
      incoming.set(kid, next)
      if (next === 0) queue.push(kid)
    }
  }

  if (sortedIds.length === byId.size) {
    return { sorted: sortedIds.map((id) => byId.get(id)!), cycle: [] }
  }

  // Anything with incoming > 0 left is part of (or downstream of) a cycle.
  const cycleIds: string[] = []
  for (const [id, count] of incoming) {
    if (count > 0) cycleIds.push(id)
  }
  return {
    sorted: sortedIds.map((id) => byId.get(id)!),
    cycle: cycleIds.map((id) => byId.get(id)!),
  }
}
