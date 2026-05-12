import { describe, expect, it } from 'bun:test'
import { topologicalSortByParent } from '../topo-sort'

interface N {
  id: string
  parentId: string | null
}

const cfg = {
  id: (n: N) => n.id,
  parentId: (n: N) => n.parentId,
}

describe('topologicalSortByParent', () => {
  it('sorts a simple parent → child chain top-down', () => {
    const nodes: N[] = [
      { id: 'c', parentId: 'b' },
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
    ]
    const { sorted, cycle } = topologicalSortByParent(nodes, cfg)
    expect(cycle).toEqual([])
    expect(sorted.map((n) => n.id)).toEqual(['a', 'b', 'c'])
  })

  it('keeps independent subtrees in input order at the root', () => {
    const nodes: N[] = [
      { id: 'a', parentId: null },
      { id: 'b', parentId: null },
      { id: 'a1', parentId: 'a' },
      { id: 'b1', parentId: 'b' },
    ]
    const { sorted } = topologicalSortByParent(nodes, cfg)
    // Roots come first; their order matches incoming.set() insertion order
    // which mirrors the input order.
    expect(sorted.map((n) => n.id)).toEqual(['a', 'b', 'a1', 'b1'])
  })

  it('detects a parent cycle and reports every node in / downstream of it', () => {
    const nodes: N[] = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
    ]
    const { sorted, cycle } = topologicalSortByParent(nodes, cfg)
    expect(sorted.length).toBe(0)
    expect(cycle.map((n) => n.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('treats a parent missing from the input set as orphan-root by default', () => {
    const nodes: N[] = [{ id: 'x', parentId: 'parent-not-in-set' }]
    const { sorted } = topologicalSortByParent(nodes, cfg)
    expect(sorted.map((n) => n.id)).toEqual(['x'])
  })

  it('respects isExternalRoot for Pascal site / building style imports', () => {
    const nodes: N[] = [{ id: 'building-1', parentId: 'site-external' }]
    const { sorted } = topologicalSortByParent(nodes, {
      ...cfg,
      isExternalRoot: (_n, parentId) => parentId.startsWith('site-'),
    })
    expect(sorted.map((n) => n.id)).toEqual(['building-1'])
  })
})
