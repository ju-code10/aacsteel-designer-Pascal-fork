import {
  type CFSMember,
  type CFSMemberId,
  type CFSSection,
  cfsMemberLength_mm,
} from '@pascal-app/cfs'
import * as THREE from 'three'
import { getCachedExtrusion } from './extrusion-cache'
import { memberOrientationMatrix } from './member-orientation'
import { getRoleMaterial } from './role-materials'
import { lookupWallFrame } from './wall-frame-lookup'

/**
 * §5.3 — instancing strategy for field studs (lines 541–547).
 *
 * Per wall framing, all field studs that share `(sectionId, orientation_deg)`
 * collapse into a single `THREE.InstancedMesh`. In v1, every field stud on
 * a single wall shares section, orientation, AND length (the wall height),
 * so there is exactly one InstancedMesh per wall in the typical case.
 *
 * Rebuild trigger (line 545): any field stud on this wall becoming dirty
 * causes a full rebuild of the wall's InstancedMesh. Incremental updates
 * are slower than a single buffer rewrite at typical instance counts, so
 * we always full-rebuild.
 *
 * Picking: the InstancedMesh raycasts to an `instanceId`, not a node id.
 * We expose an `instanceIdToMemberId` array on the group's `userData` so
 * the editor's selection layer can resolve clicks back to the member node.
 *
 * The wall's group is the unit of disposal; calling `dispose()` releases
 * the geometry and removes the mesh from its parent.
 */

const MM_PER_METER = 1000

/**
 * Pre-allocated scratch storage for the per-instance pose computation.
 */
const _axisVec = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _scale = new THREE.Vector3(1, 1, 1)
const _mat = new THREE.Matrix4()
const _basis = new THREE.Matrix4()
const _midpoint = new THREE.Vector3()

function memberAxis(member: CFSMember, out: THREE.Vector3): THREE.Vector3 {
  out.set(
    (member.end.x_mm - member.start.x_mm) / MM_PER_METER,
    (member.end.y_mm - member.start.y_mm) / MM_PER_METER,
    (member.end.z_mm - member.start.z_mm) / MM_PER_METER,
  )
  const len = out.length()
  if (len > 0) out.divideScalar(len)
  return out
}

function memberMidpoint_m(member: CFSMember, out: THREE.Vector3): THREE.Vector3 {
  out.set(
    (member.start.x_mm + member.end.x_mm) / 2 / MM_PER_METER,
    (member.start.y_mm + member.end.y_mm) / 2 / MM_PER_METER,
    (member.start.z_mm + member.end.z_mm) / 2 / MM_PER_METER,
  )
  return out
}

export interface InstancedStudGroupHandle {
  /** The Three.js InstancedMesh. Add to the scene. Single draw call per wall. */
  mesh: THREE.InstancedMesh
  /** instanceId → memberId, in the order the matrices were written. */
  instanceIdToMemberId: CFSMemberId[]
  /** Releases the geometry; caller removes the mesh from its parent first. */
  dispose: () => void
}

/**
 * Builds an InstancedMesh for a homogeneous group of field studs (same
 * section, same orientation_deg). Caller is responsible for grouping
 * members by `(sectionId, orientation_deg)` before calling — see
 * `groupFieldStudsByInstance` below.
 */
export function buildInstancedStudGroup(
  studs: readonly CFSMember[],
  section: CFSSection,
): InstancedStudGroupHandle {
  if (studs.length === 0) {
    throw new Error('buildInstancedStudGroup called with empty stud list')
  }
  const orientation_deg = studs[0]!.orientation_deg
  // The geometry is centered on its midpoint; per-instance matrices place
  // each stud at its actual world midpoint and rotate so local +Z aligns
  // with the member axis.
  // We use the FIRST stud's length as the geometry length. v1 invariant:
  // all field studs on the same wall share the same length (wall height).
  // If a future bug breaks that invariant, the rendered length will be
  // wrong for the outliers; the framing system is responsible for keeping
  // field studs uniform.
  const length_mm = cfsMemberLength_mm(studs[0]!)
  const geometry = getCachedExtrusion(section, length_mm, orientation_deg)
  const material = getRoleMaterial('stud')

  const mesh = new THREE.InstancedMesh(geometry, material, studs.length)
  mesh.name = `cfs-field-studs:${section.id}:${Math.round(orientation_deg)}`

  const instanceIdToMemberId: CFSMemberId[] = []
  // Slice 5.2: every stud on a wall shares the same wall frame, but we
  // resolve it once per stud anyway so the call stays correct if the
  // framing system ever batches across walls.
  for (let i = 0; i < studs.length; i++) {
    const m = studs[i]!
    memberMidpoint_m(m, _midpoint)
    memberAxis(m, _axisVec)
    const wallFrame = lookupWallFrame(m)
    memberOrientationMatrix(_axisVec, m.role, wallFrame, _basis)
    _q.setFromRotationMatrix(_basis)
    _mat.compose(_midpoint, _q, _scale)
    mesh.setMatrixAt(i, _mat)
    instanceIdToMemberId.push(m.id)
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingBox()
  mesh.computeBoundingSphere()
  ;(mesh.userData as Record<string, unknown>).instanceIdToMemberId = instanceIdToMemberId
  ;(mesh.userData as Record<string, unknown>).cfsKind = 'field-studs'

  return {
    mesh,
    instanceIdToMemberId,
    dispose: () => geometry.dispose(),
  }
}

/**
 * Groups members by `(sectionId, orientation_deg)`. Only members whose
 * `role === 'stud'` (the v1 instanced role per §5.3 line 541) are included.
 * Other roles are returned in `nonInstanced`.
 */
export function groupFieldStudsByInstance(members: readonly CFSMember[]): {
  groups: Map<string, CFSMember[]>
  nonInstanced: CFSMember[]
} {
  const groups = new Map<string, CFSMember[]>()
  const nonInstanced: CFSMember[] = []
  for (const m of members) {
    if (m.role !== 'stud') {
      nonInstanced.push(m)
      continue
    }
    const key = `${m.sectionId}|${Math.round(m.orientation_deg)}`
    let bucket = groups.get(key)
    if (!bucket) {
      bucket = []
      groups.set(key, bucket)
    }
    bucket.push(m)
  }
  return { groups, nonInstanced }
}
