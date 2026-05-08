import {
  type CFSMember,
  type CFSSection,
  cfsMemberLength_mm,
  type CFSServiceHole,
} from '@pascal-app/cfs'
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg'
import * as THREE from 'three'
import { getCachedExtrusion } from './extrusion-cache'
import { getRoleMaterial } from './role-materials'

/**
 * §5.3 — orchestrator for one CFSMember's mesh.
 *
 * Produces a Three.js Mesh whose geometry is the section profile extruded
 * along the member centerline (Layer 2), with any service holes cut
 * through the web via CSG (Layer 3). Material is the role-shared instance
 * from `role-materials.ts`. The mesh is centered on the geometry origin
 * (member midpoint); the caller positions and rotates it to align with
 * the member's `start` / `end`.
 *
 * §5.3 line 533 fast path: members with no holes use the base extrusion
 * directly with no CSG cost. CSG re-applies on every dirty pass for members
 * that have holes; cache is per-base only (the cut result is per-instance
 * and per-edit, so it isn't worth caching beyond the lifetime of the dirty
 * pass).
 */

const MM_PER_METER = 1000
const csgEvaluator = new Evaluator()

export interface BuildCfsMeshInput {
  member: CFSMember
  section: CFSSection
  /** Service holes on this member, in any order. Empty for the fast path. */
  holes: readonly CFSServiceHole[]
}

export interface BuildCfsMeshResult {
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

/**
 * Builds the Mesh-ready geometry + material for a single member. The caller
 * owns the returned `geometry` and must `dispose()` it when the mesh is
 * removed. The `material` is shared (cached) and must NOT be disposed by
 * the caller — `disposeRoleMaterials()` handles that at scene unload.
 */
export function buildCfsMesh(input: BuildCfsMeshInput): BuildCfsMeshResult {
  const { member, section, holes } = input
  const length_mm = cfsMemberLength_mm(member)

  const base = getCachedExtrusion(section, length_mm, member.orientation_deg)

  const geometry = holes.length === 0 ? base : applyServiceHoles(base, section, holes, length_mm)

  return {
    geometry,
    material: getRoleMaterial(member.role),
  }
}

/**
 * §5.3 layer 3 — service-hole CSG.
 *
 * For each hole, constructs a cutter prism whose axis is perpendicular to
 * the member's web (parallel to the section's flange direction = local X
 * after the orientation_deg=0 mapping in extrusion-cache.ts). The cutter is
 * twice the flange width long so it cuts cleanly through the web regardless
 * of the cross-section's exact thickness.
 *
 * Round holes use a cylinder. Oblong holes use a plain box of
 * `oblongLength × diameter` as a v1 approximation; rounded ends are a v2
 * polish item recorded in the appendix backlog.
 *
 * Position along the member axis (local Z) is `hole.positionAlongMember_mm`,
 * relative to the member's `start`. Since the geometry is centered on the
 * midpoint, we subtract `length / 2` to get the local Z offset.
 *
 * In the test environment, `three-bvh-csg` is mocked (see
 * `apps/editor/test-setup.ts`) and `csgEvaluator.evaluate()` returns null.
 * We handle that gracefully by falling back to the base geometry — tests
 * verify the hole iteration path was taken without depending on real CSG
 * output.
 */
function applyServiceHoles(
  base: THREE.BufferGeometry,
  section: CFSSection,
  holes: readonly CFSServiceHole[],
  length_mm: number,
): THREE.BufferGeometry {
  const length_m = length_mm / MM_PER_METER
  const halfLen = length_m / 2
  const flangeWidth_m = section.properties.flangeWidth_mm / MM_PER_METER
  const cutterDepth = flangeWidth_m * 2 // twice the flange width per spec line 531

  const cutters: THREE.BufferGeometry[] = []

  // The whole CSG path is wrapped because under the bun:test mock the Brush
  // and Evaluator are stubbed (see apps/editor/test-setup.ts) and any call
  // into Three.js Object3D methods on the stubbed Brush throws. In real
  // browser execution the path runs end-to-end. On any error we fall back to
  // the base extrusion so the member still renders — visually missing the
  // hole, but never crashing the system.
  try {
    let result: Brush = new Brush(base.clone())
    result.updateMatrixWorld()

    for (const hole of holes) {
      const cutterGeom = buildHoleCutterGeometry(hole, cutterDepth)
      cutters.push(cutterGeom)

      const cutterBrush = new Brush(cutterGeom)
      // Position the cutter:
      //   - Along the member axis (local Z): hole.positionAlongMember_mm
      //     from the member start, then offset by -halfLen because the
      //     geometry is centered.
      //   - Across the web (local X = flange direction): centered at 0,
      //     the web centerline.
      //   - Web depth (local Y): centered at 0.
      const z_local = hole.positionAlongMember_mm / MM_PER_METER - halfLen
      cutterBrush.position.set(0, 0, z_local)
      // Rotate the cutter so its axis (built along Y) points along local X
      // (flange direction). 90° rotation about Z achieves this.
      cutterBrush.rotation.set(0, 0, Math.PI / 2)
      cutterBrush.updateMatrixWorld()

      const evaluated = csgEvaluator.evaluate(result, cutterBrush, SUBTRACTION) as Brush | null
      if (!evaluated) {
        cleanupCsgArtifacts(result, cutters)
        return base
      }
      result = evaluated
    }

    const out = (result.geometry as THREE.BufferGeometry).clone()
    out.computeVertexNormals()
    out.computeBoundingBox()
    out.computeBoundingSphere()

    cleanupCsgArtifacts(result, cutters)
    base.dispose()
    return out
  } catch {
    for (const c of cutters) c.dispose()
    return base
  }
}

function cleanupCsgArtifacts(brush: Brush | null, cutters: THREE.BufferGeometry[]): void {
  if (brush?.geometry && (brush.geometry as THREE.BufferGeometry).dispose) {
    ;(brush.geometry as THREE.BufferGeometry).dispose()
  }
  for (const c of cutters) c.dispose()
}

function buildHoleCutterGeometry(hole: CFSServiceHole, depth_m: number): THREE.BufferGeometry {
  const diameter_m = hole.diameter_mm / MM_PER_METER
  if (hole.shape === 'round') {
    // Cylinder built along its Y axis by default; we'll rotate when placed.
    return new THREE.CylinderGeometry(diameter_m / 2, diameter_m / 2, depth_m, 24)
  }
  // 'oblong': use a plain box of (oblongLength × diameter) along the member,
  // by depth across the web. Rounded ends are a v2 polish item.
  const oblongLen_m = (hole.oblongLength_mm ?? hole.diameter_mm) / MM_PER_METER
  return new THREE.BoxGeometry(oblongLen_m, depth_m, diameter_m)
}
