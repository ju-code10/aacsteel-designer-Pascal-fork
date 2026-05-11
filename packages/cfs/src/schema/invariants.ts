import type { CFSMemberLibrary } from './cfs-member-library'
import type { CFSMember } from './cfs-member'
import type { CFSOpening } from './cfs-opening'
import type { CFSPanel } from './cfs-panel'
import type { CFSProject } from './cfs-project'
import type { CFSServiceHole } from './cfs-service-hole'
import type { CFSWallFraming } from './cfs-wall-framing'
import type { CFSConnection } from './cfs-connection'
import { cfsMemberLength_mm } from './cfs-member'

export type AnyCFSNode =
  | CFSProject
  | CFSWallFraming
  | CFSMember
  | CFSOpening
  | CFSPanel
  | CFSServiceHole
  | CFSConnection

export interface CFSInvariantContext {
  /** All CFS scene nodes keyed by id. */
  nodes: Record<string, AnyCFSNode>
  /** All known libraries keyed by id. The validator only needs the active project's set. */
  libraries: Record<string, CFSMemberLibrary>
  /** Optional wall-length lookup for opening overflow checks. */
  wallLength_mm?: (parentWallId: string) => number | undefined
}

export interface CFSInvariantViolation {
  rule: string
  nodeId?: string
  message: string
}

function sectionExistsIn(libraries: Record<string, CFSMemberLibrary>, sectionId: string): boolean {
  for (const lib of Object.values(libraries)) {
    if (lib.sections.some((s) => s.id === sectionId)) return true
  }
  return false
}

export function checkCFSInvariants(ctx: CFSInvariantContext): CFSInvariantViolation[] {
  const violations: CFSInvariantViolation[] = []
  const nodes = ctx.nodes

  const project = Object.values(nodes).find(
    (n): n is CFSProject => n.type === 'cfs_project',
  )

  // Build library set reachable from the active project, falling back to all libraries
  // if no project (e.g. partial scene during validation).
  const reachableLibraries: Record<string, CFSMemberLibrary> = {}
  if (project) {
    for (const libId of project.libraries) {
      const lib = ctx.libraries[libId]
      if (lib) reachableLibraries[libId] = lib
    }
    if (!project.libraries.includes(project.activeLibraryId)) {
      violations.push({
        rule: 'project.activeLibraryInLibraries',
        nodeId: project.id,
        message: `activeLibraryId ${project.activeLibraryId} not present in libraries`,
      })
    }
  } else {
    Object.assign(reachableLibraries, ctx.libraries)
  }

  for (const node of Object.values(nodes)) {
    switch (node.type) {
      case 'cfs_member': {
        const m = node
        if (!sectionExistsIn(reachableLibraries, m.sectionId)) {
          violations.push({
            rule: 'member.sectionResolves',
            nodeId: m.id,
            message: `sectionId ${m.sectionId} not found in any reachable library`,
          })
        }
        const parent = nodes[m.parentId]
        if (!parent || parent.type !== 'cfs_wall_framing') {
          violations.push({
            rule: 'member.parentExists',
            nodeId: m.id,
            message: `parentId ${m.parentId} does not reference a CFSWallFraming`,
          })
        }
        if (m.panelId !== null) {
          const panel = nodes[m.panelId]
          if (!panel || panel.type !== 'cfs_panel') {
            violations.push({
              rule: 'member.panelExists',
              nodeId: m.id,
              message: `panelId ${m.panelId} does not reference a CFSPanel`,
            })
          } else if (panel.parentId !== m.parentId) {
            violations.push({
              rule: 'member.panelSameFraming',
              nodeId: m.id,
              message: `panel ${panel.id} belongs to a different framing`,
            })
          }
        }
        if (cfsMemberLength_mm(m) <= 0) {
          violations.push({
            rule: 'member.nonZeroLength',
            nodeId: m.id,
            message: 'start and end are coincident',
          })
        }
        break
      }
      case 'cfs_opening': {
        const o = node
        const parent = nodes[o.parentId]
        if (!parent || parent.type !== 'cfs_wall_framing') {
          violations.push({
            rule: 'opening.parentExists',
            nodeId: o.id,
            message: `parentId ${o.parentId} does not reference a CFSWallFraming`,
          })
        }
        if (o.openingType === 'window' && (o.sillHeight_mm === undefined || o.sillHeight_mm <= 0)) {
          violations.push({
            rule: 'opening.windowSillHeight',
            nodeId: o.id,
            message: 'window opening requires positive sillHeight_mm',
          })
        }
        if (parent && parent.type === 'cfs_wall_framing' && ctx.wallLength_mm) {
          const wallLen = ctx.wallLength_mm(parent.parentId)
          if (
            wallLen !== undefined &&
            o.positionAlongWall_mm + o.roughDimensions.width_mm > wallLen
          ) {
            violations.push({
              rule: 'opening.fitsWithinWall',
              nodeId: o.id,
              message: `opening extends past wall length (${wallLen} mm)`,
            })
          }
        }
        break
      }
      case 'cfs_panel': {
        const p = node
        const parent = nodes[p.parentId]
        if (!parent || parent.type !== 'cfs_wall_framing') {
          violations.push({
            rule: 'panel.parentExists',
            nodeId: p.id,
            message: `parentId ${p.parentId} does not reference a CFSWallFraming`,
          })
        }
        // §7.3.3 sentinels are transient zero-width markers; they're allowed
        // to violate end > start until the panelization pass replaces them.
        if (!p.isPendingSentinel && p.endAlongWall_mm <= p.startAlongWall_mm) {
          violations.push({
            rule: 'panel.endAfterStart',
            nodeId: p.id,
            message: 'endAlongWall_mm must exceed startAlongWall_mm',
          })
        }
        break
      }
      case 'cfs_service_hole': {
        const h = node
        const parent = nodes[h.parentId]
        if (!parent || parent.type !== 'cfs_member') {
          violations.push({
            rule: 'hole.parentExists',
            nodeId: h.id,
            message: `parentId ${h.parentId} does not reference a CFSMember`,
          })
        }
        if (h.shape === 'oblong') {
          if (h.oblongLength_mm === undefined || h.oblongLength_mm <= h.diameter_mm) {
            violations.push({
              rule: 'hole.oblongLength',
              nodeId: h.id,
              message: 'oblong hole requires oblongLength_mm > diameter_mm',
            })
          }
        }
        if (parent && parent.type === 'cfs_member') {
          const memberLen = cfsMemberLength_mm(parent)
          if (h.positionAlongMember_mm + h.diameter_mm / 2 > memberLen) {
            violations.push({
              rule: 'hole.fitsWithinMember',
              nodeId: h.id,
              message: `hole extends past member length (${memberLen.toFixed(1)} mm)`,
            })
          }
        }
        break
      }
      case 'cfs_connection': {
        const c = node
        const parent = nodes[c.parentId]
        if (!parent || parent.type !== 'cfs_wall_framing') {
          violations.push({
            rule: 'connection.parentExists',
            nodeId: c.id,
            message: `parentId ${c.parentId} does not reference a CFSWallFraming`,
          })
          break
        }
        const memberFramings = new Set<string>()
        for (const memberId of c.memberIds) {
          const m = nodes[memberId]
          if (!m || m.type !== 'cfs_member') {
            violations.push({
              rule: 'connection.memberExists',
              nodeId: c.id,
              message: `member ${memberId} not found`,
            })
            continue
          }
          memberFramings.add(m.parentId)
        }
        if (memberFramings.size > 1) {
          violations.push({
            rule: 'connection.membersSameFraming',
            nodeId: c.id,
            message: 'connected members span multiple framings',
          })
        }
        break
      }
      // cfs_project, cfs_wall_framing: no per-node cross-schema checks beyond
      // those above (project.activeLibraryInLibraries handled prior to switch).
      default:
        break
    }
  }

  // Panel non-overlap: per framing, no two real panels overlap. Sentinels
  // (§7.3.3) are excluded — they are zero-width markers replaced by the
  // panelization pass before any consumer reads the layout.
  const panelsByFraming = new Map<string, CFSPanel[]>()
  for (const node of Object.values(nodes)) {
    if (node.type !== 'cfs_panel') continue
    if (node.isPendingSentinel) continue
    const list = panelsByFraming.get(node.parentId) ?? []
    list.push(node)
    panelsByFraming.set(node.parentId, list)
  }
  for (const [framingId, panels] of panelsByFraming) {
    const sorted = [...panels].sort((a, b) => a.startAlongWall_mm - b.startAlongWall_mm)
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1]
      const curr = sorted[i]
      if (!prev || !curr) continue
      if (curr.startAlongWall_mm < prev.endAlongWall_mm) {
        violations.push({
          rule: 'panel.noOverlap',
          nodeId: curr.id,
          message: `panels in framing ${framingId} overlap`,
        })
      }
    }
  }

  return violations
}
