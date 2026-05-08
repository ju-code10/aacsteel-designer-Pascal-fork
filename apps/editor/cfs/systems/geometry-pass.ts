import { sceneRegistry, useScene } from '@pascal-app/core'
import {
  type CFSMember,
  type CFSMemberId,
  type CFSSection,
  type CFSServiceHole,
  type CFSServiceHoleId,
  type CFSWallFramingId,
  cfsMemberLength_mm,
  getActiveLibrary,
  useCFS,
} from '@pascal-app/cfs'
import * as THREE from 'three'
import { buildCfsMesh } from '../lib/build-cfs-mesh'
import { memberOrientationMatrix } from '../lib/member-orientation'
import {
  attachToPascalScene,
  detachFromPascalScene,
} from '../lib/pascal-scene-bridge'
import {
  buildInstancedStudGroup,
  groupFieldStudsByInstance,
  type InstancedStudGroupHandle,
} from '../lib/instanced-stud-group'
import { lookupWallFrame } from '../lib/wall-frame-lookup'

/**
 * The pure pass run by `CFSGeometrySystem` on every relevant store update.
 * Split from the React component so the diffing/rebuild logic can be
 * unit-tested without mounting React or R3F.
 *
 * Semantics:
 *   1. Read current scene + library state.
 *   2. If CFS mode is off, hide the root group and return.
 *   3. Compute desired (member, section, holes) trios for every CFSMember.
 *   4. Diff against `ctx.rendered` (non-instanced) and `ctx.studGroups`
 *      (per-wall InstancedMeshes); add/update/remove as needed.
 *   5. Re-attach the root group to Pascal's scene if it isn't there yet.
 *
 * The pass is idempotent: calling it twice in a row with no scene changes
 * is a no-op (verified by the signature checks).
 */

const MM_PER_METER = 1000

interface RenderedMember {
  mesh: THREE.Mesh
  signature: string
}

export interface GeometryPassContext {
  rootGroup: THREE.Group
  rendered: Map<CFSMemberId, RenderedMember>
  studGroups: Map<CFSWallFramingId, InstancedStudGroupHandle>
  studSignatures: Map<CFSWallFramingId, string>
}

const _axis = new THREE.Vector3()
const _midpoint = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _basis = new THREE.Matrix4()

function memberAxis(m: CFSMember, out: THREE.Vector3): THREE.Vector3 {
  out.set(
    (m.end.x_mm - m.start.x_mm) / MM_PER_METER,
    (m.end.y_mm - m.start.y_mm) / MM_PER_METER,
    (m.end.z_mm - m.start.z_mm) / MM_PER_METER,
  )
  const len = out.length()
  if (len > 0) out.divideScalar(len)
  return out
}

function memberMidpoint_m(m: CFSMember, out: THREE.Vector3): THREE.Vector3 {
  out.set(
    (m.start.x_mm + m.end.x_mm) / 2 / MM_PER_METER,
    (m.start.y_mm + m.end.y_mm) / 2 / MM_PER_METER,
    (m.start.z_mm + m.end.z_mm) / 2 / MM_PER_METER,
  )
  return out
}

/**
 * Tracks every input that affects a non-instanced member's mesh. If the
 * signature is unchanged across passes, the mesh is reused as-is.
 */
function memberSignature(
  m: CFSMember,
  section: CFSSection,
  holes: readonly CFSServiceHole[],
): string {
  const lenInt = Math.round(cfsMemberLength_mm(m))
  const orientInt = Math.round(m.orientation_deg)
  const holeKey = holes
    .map(
      (h) =>
        `${h.id}:${Math.round(h.positionAlongMember_mm)}:${Math.round(h.diameter_mm)}:${h.shape}`,
    )
    .sort()
    .join(',')
  return [
    section.id,
    lenInt,
    orientInt,
    m.role,
    m.start.x_mm,
    m.start.y_mm,
    m.start.z_mm,
    m.end.x_mm,
    m.end.y_mm,
    m.end.z_mm,
    holeKey,
  ].join('|')
}

function studGroupSignature(studs: readonly CFSMember[]): string {
  // The InstancedMesh rebuilds whenever ANY field stud on the wall changes
  // (per spec line 545). Signature includes every stud's identity and pose.
  const parts: string[] = []
  for (const s of studs) {
    parts.push(
      `${s.id}:${s.sectionId}:${Math.round(s.orientation_deg)}:${s.start.x_mm},${s.start.y_mm},${s.start.z_mm}:${s.end.x_mm},${s.end.y_mm},${s.end.z_mm}`,
    )
  }
  return parts.sort().join('|')
}

function placeMesh(mesh: THREE.Mesh, m: CFSMember): void {
  memberMidpoint_m(m, _midpoint)
  memberAxis(m, _axis)
  // Slice 5.2 — role-aware orientation. Looks up the parent Pascal wall
  // so vertical studs orient web-along-wall-length, top-tracks open
  // their U-channel downward, etc. See member-orientation.ts for the rule
  // table.
  const wallFrame = lookupWallFrame(m)
  memberOrientationMatrix(_axis, m.role, wallFrame, _basis)
  _q.setFromRotationMatrix(_basis)
  mesh.position.copy(_midpoint)
  mesh.quaternion.copy(_q)
  mesh.updateMatrixWorld()
}

export function runGeometryPass(ctx: GeometryPassContext): void {
  const sceneState = useScene.getState()
  const cfsState = useCFS.getState()
  const library = getActiveLibrary(cfsState)

  // CFS mode off, or library not yet hydrated: hide everything but keep
  // ctx alive so the next mode-on toggle is fast.
  if (!cfsState.isCFSMode || !library) {
    ctx.rootGroup.visible = false
    return
  }
  ctx.rootGroup.visible = true

  const sections = new Map<string, CFSSection>()
  for (const s of library.sections) sections.set(s.id, s)

  const allMembers: CFSMember[] = []
  const holesByParent = new Map<CFSMemberId, CFSServiceHole[]>()
  for (const node of Object.values(sceneState.nodes)) {
    if ((node as { type?: string }).type === 'cfs_member') {
      allMembers.push(node as unknown as CFSMember)
    } else if ((node as { type?: string }).type === 'cfs_service_hole') {
      const hole = node as unknown as CFSServiceHole
      let bucket = holesByParent.get(hole.parentId)
      if (!bucket) {
        bucket = []
        holesByParent.set(hole.parentId, bucket)
      }
      bucket.push(hole)
    }
  }

  // ─── Group members by wall framing for instancing ────────────────────
  const membersByFraming = new Map<CFSWallFramingId, CFSMember[]>()
  for (const m of allMembers) {
    let bucket = membersByFraming.get(m.parentId)
    if (!bucket) {
      bucket = []
      membersByFraming.set(m.parentId, bucket)
    }
    bucket.push(m)
  }

  const desiredNonInstancedIds = new Set<CFSMemberId>()
  const desiredFramings = new Set<CFSWallFramingId>()

  for (const [framingId, members] of membersByFraming) {
    desiredFramings.add(framingId)
    const { groups, nonInstanced } = groupFieldStudsByInstance(members)

    // ── Per-framing field-stud InstancedMesh ─────────────────────────
    if (groups.size === 0) {
      // No field studs on this wall (e.g., very short wall + opening only).
      const existing = ctx.studGroups.get(framingId)
      if (existing) {
        if (existing.mesh.parent) existing.mesh.parent.remove(existing.mesh)
        existing.dispose()
        ctx.studGroups.delete(framingId)
        ctx.studSignatures.delete(framingId)
      }
    } else {
      // v1: collapse all groups into one — typically there's only one
      // (sectionId, orientation_deg) bucket per wall. If multiple, pick
      // the largest and treat the others as non-instanced (a v2 polish
      // item would emit one InstancedMesh per group).
      let largest: CFSMember[] = []
      for (const bucket of groups.values()) {
        if (bucket.length > largest.length) largest = bucket
      }
      // Move the non-largest field studs into the non-instanced bucket so
      // they still render — just less efficiently. This avoids losing
      // members when a wall mixes section types.
      for (const bucket of groups.values()) {
        if (bucket === largest) continue
        for (const m of bucket) nonInstanced.push(m)
      }

      const studsSig = studGroupSignature(largest)
      const previousSig = ctx.studSignatures.get(framingId)
      if (previousSig !== studsSig) {
        // Rebuild the wall's InstancedMesh.
        const existing = ctx.studGroups.get(framingId)
        if (existing) {
          if (existing.mesh.parent) existing.mesh.parent.remove(existing.mesh)
          existing.dispose()
        }
        const section = sections.get(largest[0]!.sectionId)
        if (section) {
          const handle = buildInstancedStudGroup(largest, section)
          ctx.rootGroup.add(handle.mesh)
          ctx.studGroups.set(framingId, handle)
          ctx.studSignatures.set(framingId, studsSig)
          // Register the InstancedMesh under a synthetic id (instanced
          // members don't have individual scene-registry entries, so we
          // expose the wall-scoped instanced mesh under the framing id
          // namespaced by the kind).
          sceneRegistry.nodes.set(`cfs-instanced-studs:${framingId}`, handle.mesh)
        }
      }
    }

    // ── Per-member non-instanced meshes ──────────────────────────────
    for (const m of nonInstanced) {
      desiredNonInstancedIds.add(m.id)
      const section = sections.get(m.sectionId)
      if (!section) continue // section deleted from library mid-edit; skip
      const holes = holesByParent.get(m.id) ?? []
      const sig = memberSignature(m, section, holes)
      const existing = ctx.rendered.get(m.id)
      if (existing && existing.signature === sig) {
        // Up to date — only re-place in case the framing dirtied it for
        // unrelated reasons. placeMesh is cheap.
        placeMesh(existing.mesh, m)
        continue
      }
      // Build new (or rebuild changed).
      const { geometry, material } = buildCfsMesh({ member: m, section, holes })
      if (existing) {
        existing.mesh.geometry.dispose()
        existing.mesh.geometry = geometry
        existing.mesh.material = material
        placeMesh(existing.mesh, m)
        existing.signature = sig
      } else {
        const mesh = new THREE.Mesh(geometry, material)
        mesh.name = `cfs-member:${m.id}`
        mesh.userData.cfsMemberId = m.id
        mesh.userData.cfsRole = m.role
        placeMesh(mesh, m)
        ctx.rootGroup.add(mesh)
        ctx.rendered.set(m.id, { mesh, signature: sig })
        sceneRegistry.nodes.set(m.id, mesh)
      }
    }
  }

  // ─── Remove stale non-instanced members ──────────────────────────────
  for (const [id, r] of ctx.rendered) {
    if (!desiredNonInstancedIds.has(id)) {
      if (r.mesh.parent) r.mesh.parent.remove(r.mesh)
      r.mesh.geometry.dispose()
      ctx.rendered.delete(id)
      sceneRegistry.nodes.delete(id)
    }
  }
  // ─── Remove stud groups whose framing is gone ────────────────────────
  for (const [framingId, sg] of ctx.studGroups) {
    if (!desiredFramings.has(framingId)) {
      if (sg.mesh.parent) sg.mesh.parent.remove(sg.mesh)
      sg.dispose()
      ctx.studGroups.delete(framingId)
      ctx.studSignatures.delete(framingId)
      sceneRegistry.nodes.delete(`cfs-instanced-studs:${framingId}`)
    }
  }

  // ─── Attach root group to Pascal's scene if not already attached ─────
  if (!ctx.rootGroup.parent) {
    attachToPascalScene(ctx.rootGroup)
  }
}

export function teardownGeometryPassContext(ctx: GeometryPassContext): void {
  for (const r of ctx.rendered.values()) {
    if (r.mesh.parent) r.mesh.parent.remove(r.mesh)
    r.mesh.geometry.dispose()
    sceneRegistry.nodes.delete(r.mesh.userData.cfsMemberId as string)
  }
  ctx.rendered.clear()
  for (const [framingId, sg] of ctx.studGroups) {
    if (sg.mesh.parent) sg.mesh.parent.remove(sg.mesh)
    sg.dispose()
    sceneRegistry.nodes.delete(`cfs-instanced-studs:${framingId}`)
  }
  ctx.studGroups.clear()
  ctx.studSignatures.clear()
  detachFromPascalScene(ctx.rootGroup)
}

export function createGeometryPassContext(): GeometryPassContext {
  const rootGroup = new THREE.Group()
  rootGroup.name = 'cfs-root-group'
  return {
    rootGroup,
    rendered: new Map(),
    studGroups: new Map(),
    studSignatures: new Map(),
  }
}
