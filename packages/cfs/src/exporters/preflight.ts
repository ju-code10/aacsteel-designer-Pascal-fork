// §6.0 — preflight checks shared by every exporter, plus the dry-run
// variant the UI uses to grey out menu items (§7.5).
//
// On the real export path, the preflight throws a typed `ExporterError`
// (caught by the caller; the UI surfaces the message in the error banner).
// On the dry-run path, the same code returns the first failure as a string
// or `null` if all checks pass. No side effects either way.

import type { CFSMember } from '../schema/cfs-member'
import type { CFSMemberLibrary } from '../schema/cfs-member-library'
import type { CFSPanel } from '../schema/cfs-panel'
import type { CFSProject } from '../schema/cfs-project'
import { isRealPanel } from '../schema/cfs-panel'
import type { SceneLike } from '../lib/scene-walk'

export class ExporterError extends Error {
  readonly code:
    | 'no-library'
    | 'no-project'
    | 'unresolved-sections'
    | 'no-panels'
    | 'unpaneled-members'
  constructor(
    code:
      | 'no-library'
      | 'no-project'
      | 'unresolved-sections'
      | 'no-panels'
      | 'unpaneled-members',
    message: string,
  ) {
    super(message)
    this.code = code
    this.name = 'ExporterError'
  }
}

export interface PreflightOptions {
  requirePanels: boolean
}

interface NodeBase {
  type?: string
  parentId?: string | null
}

function membersInScene(scene: SceneLike): CFSMember[] {
  const out: CFSMember[] = []
  for (const node of Object.values(scene.nodes)) {
    if ((node as NodeBase).type === 'cfs_member') out.push(node as CFSMember)
  }
  return out
}

function realPanelsInScene(scene: SceneLike): CFSPanel[] {
  const out: CFSPanel[] = []
  for (const node of Object.values(scene.nodes)) {
    if ((node as NodeBase).type === 'cfs_panel') {
      const p = node as CFSPanel
      if (isRealPanel(p)) out.push(p)
    }
  }
  return out
}

/**
 * The shared check. Returns null on success, or a `{ code, message }`
 * tuple on the first failure encountered (in the same order §6.0 lists
 * them, so the message is predictable across exporters).
 */
export function checkPreflight(
  scene: SceneLike,
  library: CFSMemberLibrary | null,
  project: CFSProject | null,
  options: PreflightOptions,
): { code: ExporterError['code']; message: string } | null {
  if (!library) {
    return {
      code: 'no-library',
      message:
        'No member library is loaded. Refresh the page or check the SSMA catalog.',
    }
  }
  if (!project) {
    return {
      code: 'no-project',
      message: 'No CFS project in this scene. Toggle CFS mode on first.',
    }
  }

  const sectionIds = new Set(library.sections.map((s) => s.id))
  const members = membersInScene(scene)
  let unresolvedCount = 0
  for (const m of members) {
    if (!sectionIds.has(m.sectionId)) unresolvedCount++
  }
  if (unresolvedCount > 0) {
    return {
      code: 'unresolved-sections',
      message: `${unresolvedCount} members reference unresolved sections. Open the inspector to fix.`,
    }
  }

  if (options.requirePanels) {
    const panels = realPanelsInScene(scene)
    if (panels.length === 0) {
      return {
        code: 'no-panels',
        message: 'This scene has not been panelized. Click Panelize on each wall first.',
      }
    }
    let unpaneled = 0
    for (const m of members) {
      if (m.panelId === null) unpaneled++
    }
    if (unpaneled > 0) {
      return {
        code: 'unpaneled-members',
        message: `${unpaneled} members are not assigned to a panel. Re-run panelization.`,
      }
    }
  }

  return null
}

/** Real-export entry point — throws on failure. */
export function preflight(
  scene: SceneLike,
  library: CFSMemberLibrary | null,
  project: CFSProject | null,
  options: PreflightOptions,
): { library: CFSMemberLibrary; project: CFSProject } {
  const fail = checkPreflight(scene, library, project, options)
  if (fail) throw new ExporterError(fail.code, fail.message)
  // After checkPreflight succeeded, library and project are non-null.
  return { library: library as CFSMemberLibrary, project: project as CFSProject }
}

/** Dry-run for the UI — returns the message string or null. */
export function previewPreflight(
  scene: SceneLike,
  library: CFSMemberLibrary | null,
  project: CFSProject | null,
  options: PreflightOptions,
): string | null {
  const fail = checkPreflight(scene, library, project, options)
  return fail?.message ?? null
}
