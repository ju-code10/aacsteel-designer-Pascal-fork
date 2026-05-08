import type { CFSMemberRole } from '@pascal-app/cfs'
import * as THREE from 'three'

/**
 * §5.3 — role-based materials. Per spec line 537, v1 uses
 * `MeshStandardMaterial` with metallic 0.9 and roughness 0.6 to suggest
 * galvanized steel; the role-color table is sourced from §6.3 (DXF layer
 * colors), translated from AutoCAD Color Index numbers to RGB hexes:
 *
 *   - track (top/bottom): gray (ACI 8)
 *   - field stud:         blue (ACI 5)
 *   - chord stud:         dark blue (ACI 4 in spec; we read it as a darker
 *                         blue than field studs to match the §1.2 hint
 *                         "end studs dark blue")
 *   - king stud:          cyan (ACI 4 in spec; we use cyan to keep king
 *                         visually distinct from chord while honoring §6.3)
 *   - jamb stud:          green (ACI 3)
 *   - header:             red (ACI 1)
 *   - sill / sill-track:  red (ACI 1) — same as header per §6.3
 *   - cripple:            yellow (ACI 2)
 *
 * Per spec line 539, material instances are shared across members of the
 * same role — the cache below produces one instance per role for the
 * lifetime of the page. There are exactly 10 roles (`CFSMemberRole`), so the
 * cache size is bounded.
 *
 * The spec note that "build slice 9 confirms exact hex values" means these
 * v1 picks are provisional; this file is the single source of truth so any
 * slice-9 polish only edits one constant.
 */

const ROLE_COLOR_HEX: Record<CFSMemberRole, number> = {
  'top-track': 0x9aa0a8,
  'bottom-track': 0x9aa0a8,
  stud: 0x3b66ff,
  'chord-stud': 0x143a8a,
  'king-stud': 0x2bb6c4,
  'jamb-stud': 0x2bb845,
  header: 0xd6453b,
  sill: 0xd6453b,
  'sill-track': 0xd6453b,
  cripple: 0xe0c44b,
}

let cache: Map<CFSMemberRole, THREE.MeshStandardMaterial> | null = null

function buildMaterial(role: CFSMemberRole): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(ROLE_COLOR_HEX[role]),
    metalness: 0.9,
    roughness: 0.6,
    name: `cfs-role:${role}`,
  })
}

export function getRoleMaterial(role: CFSMemberRole): THREE.MeshStandardMaterial {
  if (cache === null) cache = new Map()
  let m = cache.get(role)
  if (!m) {
    m = buildMaterial(role)
    cache.set(role, m)
  }
  return m
}

export function roleColorHex(role: CFSMemberRole): number {
  return ROLE_COLOR_HEX[role]
}

/**
 * Disposes every cached material and clears the cache. Call only when the
 * editor unloads the CFS systems entirely (page navigation, scene reset).
 * Disposal is idempotent — calling again on an empty cache is a no-op.
 */
export function disposeRoleMaterials(): void {
  if (cache === null) return
  for (const m of cache.values()) m.dispose()
  cache.clear()
  cache = null
}

/** Test-only: read the cache size without exposing the cache itself. */
export function _roleMaterialCacheSize(): number {
  return cache?.size ?? 0
}
