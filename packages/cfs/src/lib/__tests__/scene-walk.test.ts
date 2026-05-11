import { describe, expect, it } from 'bun:test'
import {
  ancestorOfType,
  buildingOf,
  levelOf,
  membersInPanel,
  shortId,
  sortedMembersScene,
  sortedPanelsScene,
  sortedWalls,
  wallOf,
} from '../scene-walk'

interface AnyNode {
  type: string
  id: string
  parentId: string | null
  [k: string]: unknown
}

function makeScene(nodes: AnyNode[]): { nodes: Record<string, unknown> } {
  const map: Record<string, unknown> = {}
  for (const n of nodes) map[n.id] = n
  return { nodes: map }
}

describe('scene-walk ancestry', () => {
  const scene = makeScene([
    { type: 'site', id: 's', parentId: null },
    { type: 'building', id: 'b', parentId: 's', createdAt: '2026-01-01T00:00:00Z' },
    { type: 'level', id: 'lv', parentId: 'b', elevation_m: 0 },
    { type: 'wall', id: 'w', parentId: 'lv' },
    { type: 'cfs_wall_framing', id: 'f', parentId: 'w' },
    {
      type: 'cfs_member',
      id: 'm',
      parentId: 'f',
      role: 'stud',
      sectionId: 'sec',
      start: { x_mm: 0, y_mm: 0, z_mm: 0 },
      end: { x_mm: 0, y_mm: 2700, z_mm: 0 },
      panelId: null,
    },
  ])

  it('finds building / level / wall ancestors from a member', () => {
    expect(buildingOf(scene, 'm')).toBe('b')
    expect(levelOf(scene, 'm')).toBe('lv')
    expect(wallOf(scene, 'f')).toBe('w')
  })

  it('returns null when no ancestor of that type exists', () => {
    expect(ancestorOfType(scene, 'm', 'site')).toBe('s')
    expect(ancestorOfType(scene, 'm', 'nothing')).toBe(null)
  })

  it('shortId returns the last 8 characters', () => {
    expect(shortId('abcdefghij')).toBe('cdefghij')
    expect(shortId('short')).toBe('short')
  })
})

describe('scene-walk stable order', () => {
  it('orders walls by building createdAt then level elevation', () => {
    const scene = makeScene([
      { type: 'site', id: 's', parentId: null },
      { type: 'building', id: 'b1', parentId: 's', createdAt: '2026-02-01T00:00:00Z' },
      { type: 'building', id: 'b2', parentId: 's', createdAt: '2026-01-01T00:00:00Z' },
      { type: 'level', id: 'l1', parentId: 'b1', elevation_m: 0 },
      { type: 'level', id: 'l2', parentId: 'b2', elevation_m: 3 },
      { type: 'level', id: 'l3', parentId: 'b2', elevation_m: 0 },
      { type: 'wall', id: 'wA', parentId: 'l1' },
      { type: 'wall', id: 'wB', parentId: 'l2' },
      { type: 'wall', id: 'wC', parentId: 'l3' },
    ])
    const walls = sortedWalls(scene)
    // b2 first (earlier createdAt), within b2 lower elevation first, then b1.
    expect(walls.map((w) => w.id)).toEqual(['wC', 'wB', 'wA'])
  })

  it('sortedPanelsScene filters sentinels and orders by sequenceNumber within a wall', () => {
    const scene = makeScene([
      { type: 'site', id: 's', parentId: null },
      { type: 'building', id: 'b', parentId: 's' },
      { type: 'level', id: 'lv', parentId: 'b' },
      { type: 'wall', id: 'w', parentId: 'lv' },
      { type: 'cfs_wall_framing', id: 'f', parentId: 'w' },
      {
        type: 'cfs_panel',
        id: 'p2',
        parentId: 'f',
        label: 'P-02',
        sequenceNumber: 2,
        startAlongWall_mm: 1000,
        endAlongWall_mm: 2000,
        isManualBreak: false,
        isPendingSentinel: false,
      },
      {
        type: 'cfs_panel',
        id: 'p1',
        parentId: 'f',
        label: 'P-01',
        sequenceNumber: 1,
        startAlongWall_mm: 0,
        endAlongWall_mm: 1000,
        isManualBreak: false,
        isPendingSentinel: false,
      },
      {
        type: 'cfs_panel',
        id: 'sentinel',
        parentId: 'f',
        label: 'P-?',
        sequenceNumber: 0,
        startAlongWall_mm: 500,
        endAlongWall_mm: 500,
        isManualBreak: true,
        isPendingSentinel: true,
      },
    ])
    const panels = sortedPanelsScene(scene)
    expect(panels.map((p) => p.id)).toEqual(['p1', 'p2'])
  })

  it('membersInPanel sorts by shipping mark lexicographically', () => {
    const scene = makeScene([
      { type: 'site', id: 's', parentId: null },
      { type: 'building', id: 'b', parentId: 's' },
      { type: 'level', id: 'lv', parentId: 'b' },
      { type: 'wall', id: 'w', parentId: 'lv' },
      { type: 'cfs_wall_framing', id: 'f', parentId: 'w' },
      {
        type: 'cfs_member',
        id: 'm1',
        parentId: 'f',
        role: 'stud',
        sectionId: 'sec',
        start: { x_mm: 0, y_mm: 0, z_mm: 0 },
        end: { x_mm: 0, y_mm: 2700, z_mm: 0 },
        panelId: 'panel',
        shippingMark: 'P-01-S05',
      },
      {
        type: 'cfs_member',
        id: 'm2',
        parentId: 'f',
        role: 'stud',
        sectionId: 'sec',
        start: { x_mm: 0, y_mm: 0, z_mm: 0 },
        end: { x_mm: 0, y_mm: 2700, z_mm: 0 },
        panelId: 'panel',
        shippingMark: 'P-01-S01',
      },
    ])
    const ordered = membersInPanel(scene, 'panel')
    expect(ordered.map((m) => m.shippingMark)).toEqual(['P-01-S01', 'P-01-S05'])
  })

  it('sortedMembersScene groups by framing → panel → mark, with orphans last', () => {
    const scene = makeScene([
      { type: 'site', id: 's', parentId: null },
      { type: 'building', id: 'b', parentId: 's' },
      { type: 'level', id: 'lv', parentId: 'b' },
      { type: 'wall', id: 'w', parentId: 'lv' },
      { type: 'cfs_wall_framing', id: 'f', parentId: 'w' },
      {
        type: 'cfs_panel',
        id: 'p1',
        parentId: 'f',
        label: 'P-01',
        sequenceNumber: 1,
        startAlongWall_mm: 0,
        endAlongWall_mm: 1000,
        isManualBreak: false,
        isPendingSentinel: false,
      },
      {
        type: 'cfs_member',
        id: 'orphan',
        parentId: 'f',
        role: 'stud',
        sectionId: 'sec',
        start: { x_mm: 0, y_mm: 0, z_mm: 0 },
        end: { x_mm: 0, y_mm: 2700, z_mm: 0 },
        panelId: null,
      },
      {
        type: 'cfs_member',
        id: 'paneled',
        parentId: 'f',
        role: 'stud',
        sectionId: 'sec',
        start: { x_mm: 0, y_mm: 0, z_mm: 0 },
        end: { x_mm: 0, y_mm: 2700, z_mm: 0 },
        panelId: 'p1',
        shippingMark: 'P-01-S01',
      },
    ])
    const order = sortedMembersScene(scene).map((m) => m.id)
    expect(order).toEqual(['paneled', 'orphan'])
  })
})
