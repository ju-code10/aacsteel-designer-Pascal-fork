// §6.5 — JSONExporter and JSONImporter. The persistence and portability
// deliverable. Export the CFS-aware scene to a JSON file; import it back
// to reconstruct the scene.
//
// Library: native `JSON.parse` / `JSON.stringify` + the schemas defined
// in §3. No third-party dependency on the round-trip path.

import type { useScene as UseScene } from '@pascal-app/core'
import { ZodError } from 'zod'
import type { CFSMember } from '../schema/cfs-member'
import type { CFSProject } from '../schema/cfs-project'
import {
  AACSteelSceneFile,
  CURRENT_SCENE_FILE_VERSION,
} from '../schema/scene-file'
import type { SceneLike } from '../lib/scene-walk'
import { isCFSNodeType, schemaFor } from '../lib/schema-for'
import { isPascalSiteOrBuilding } from '../lib/is-pascal-root'
import { topologicalSortByParent } from '../lib/topo-sort'
import { ExporterError } from './preflight'

const PACKAGE_VERSION = '1.0.0'

// ── Exporter ────────────────────────────────────────────────────────────────

export interface JSONExportResult {
  blob: Blob
  fileText: string
  schemaVersion: string
  pascalNodeCount: number
  cfsNodeCount: number
}

export function exportJSON(
  scene: SceneLike,
  project: CFSProject | null,
  options: { exportedAt?: Date } = {},
): JSONExportResult {
  if (!project) {
    throw new ExporterError(
      'no-project',
      'No CFS project in this scene. Toggle CFS mode on first.',
    )
  }
  const exportedAt = options.exportedAt ?? new Date()

  // Sort by id so two exports of the same scene produce byte-identical
  // JSON regardless of source insertion order (§6.5 JSON-10 invariant).
  const pascalNodes: Record<string, unknown> = {}
  const cfsNodes: Record<string, unknown> = {}
  const sortedEntries = Object.entries(scene.nodes).sort(([a], [b]) =>
    a.localeCompare(b),
  )
  for (const [id, node] of sortedEntries) {
    const type = (node as { type?: unknown } | null)?.type
    if (isCFSNodeType(type)) cfsNodes[id] = node
    else pascalNodes[id] = node
  }

  const file = {
    schemaVersion: CURRENT_SCENE_FILE_VERSION,
    generator: {
      tool: 'AACSteel-Designer' as const,
      version: PACKAGE_VERSION,
      exportedAt: exportedAt.toISOString(),
    },
    pascalNodes,
    cfsNodes,
  }

  // Deep-sort object keys so the file is byte-stable across re-exports
  // regardless of how the source node objects were assembled (§6.5 JSON-10).
  const text = JSON.stringify(file, sortedKeysReplacer, 2)
  const blob = new Blob([text], { type: 'application/json' })
  return {
    blob,
    fileText: text,
    schemaVersion: file.schemaVersion,
    pascalNodeCount: Object.keys(pascalNodes).length,
    cfsNodeCount: Object.keys(cfsNodes).length,
  }
}

// ── Importer ────────────────────────────────────────────────────────────────

export type ImportStatus = 'success' | 'partial' | 'failure'

export interface ImportResult {
  status: ImportStatus
  messages: string[]
  importedNodeCount: number
  rejectedNodeCount: number
}

// Migration table — v2 populates this map; v1 ships empty per §6.5 step 2.
// Each migration is a pure function that returns a v1-shaped file.
const MIGRATIONS: Record<string, (file: AACSteelSceneFile) => AACSteelSceneFile> = {}

interface SceneStoreLike {
  getState(): {
    nodes: Record<string, unknown>
    createNode: (node: unknown, parentId: unknown) => unknown
  }
}

interface CFSStoreLike {
  getState(): {
    memberLibraries: Record<string, { sections: Array<{ id: string }> }>
    setCFSMode: (on: boolean) => void
    setActiveLibrary?: (id: string) => void
  }
}

/**
 * Inject `withBatch` so tests can call this without depending on Pascal's
 * undo machinery. The editor passes `withBatchedUndo`.
 */
export function importJSON(
  raw: unknown,
  scene: SceneStoreLike | typeof UseScene,
  cfs: CFSStoreLike,
  options: { withBatch?: (label: string, fn: () => void) => void } = {},
): ImportResult {
  const messages: string[] = []

  // 1. Structural validation.
  let parsed: AACSteelSceneFile
  try {
    parsed = AACSteelSceneFile.parse(raw)
  } catch (err) {
    return failure([zodMessage(err)])
  }

  // 2. Schema version dispatch.
  if (parsed.schemaVersion !== CURRENT_SCENE_FILE_VERSION) {
    const migrate = MIGRATIONS[parsed.schemaVersion]
    if (!migrate) {
      return failure([
        `Cannot import schema version ${parsed.schemaVersion}; current is ${CURRENT_SCENE_FILE_VERSION}.`,
      ])
    }
    parsed = migrate(parsed)
  }

  // 3. Singleton CFSProject check.
  const cfsValues = Object.values(parsed.cfsNodes)
  const projectsInFile = cfsValues.filter(
    (n) => (n as { type?: unknown })?.type === 'cfs_project',
  )
  if (projectsInFile.length > 1) {
    return failure(['Multiple cfs_project nodes in file (§4.4 forbids).'])
  }

  // 4. Per-node Zod validation.
  type Validated = { id: string; node: Record<string, unknown> }
  const validated = new Map<string, Validated>()
  const rejected = new Set<string>()
  const entries: Array<[string, unknown]> = [
    ...Object.entries(parsed.pascalNodes),
    ...Object.entries(parsed.cfsNodes),
  ]
  for (const [id, node] of entries) {
    const schema = schemaFor((node as { type?: unknown })?.type)
    if (schema) {
      try {
        const v = schema.parse(node)
        validated.set(id, { id, node: v as Record<string, unknown> })
      } catch (err) {
        rejected.add(id)
        messages.push(`node ${id}: ${zodMessage(err)}`)
      }
    } else {
      // Unknown / non-CFS type: accept opaquely. Pascal-side schemas live
      // upstream and we don't validate against them.
      validated.set(id, { id, node: node as Record<string, unknown> })
    }
  }

  // 5. Transitive parent rejection.
  let changed = true
  while (changed) {
    changed = false
    for (const { id, node } of [...validated.values()]) {
      const parentId = node['parentId']
      if (parentId == null) continue
      if (typeof parentId !== 'string') continue
      if (validated.has(parentId)) continue
      if (isPascalSiteOrBuilding(node)) continue
      validated.delete(id)
      rejected.add(id)
      messages.push(`node ${id}: parent ${parentId} missing or rejected`)
      changed = true
    }
  }

  // 6. Library guard (warn, do not reject).
  const allSectionIds = new Set<string>()
  const loadedLibs = cfs.getState().memberLibraries ?? {}
  for (const lib of Object.values(loadedLibs)) {
    for (const s of lib.sections) allSectionIds.add(s.id)
  }
  for (const { id, node } of validated.values()) {
    if (node['type'] !== 'cfs_member') continue
    const sectionId = (node as Partial<CFSMember>).sectionId
    if (typeof sectionId !== 'string') continue
    if (!allSectionIds.has(sectionId)) {
      messages.push(`member ${id}: section ${sectionId} not loaded`)
    }
  }

  // 7. Apply via the scene store. Topologically sort so parents land
  // before their children.
  const sorted = topologicalSortByParent([...validated.values()], {
    id: (v) => v.id,
    parentId: (v) =>
      typeof v.node['parentId'] === 'string'
        ? (v.node['parentId'] as string)
        : null,
    isExternalRoot: (v) => isPascalSiteOrBuilding(v.node),
  })

  if (sorted.cycle.length > 0) {
    for (const v of sorted.cycle) {
      rejected.add(v.id)
      messages.push(`node ${v.id}: parent-chain cycle`)
    }
  }

  const runBody = () => {
    const state = scene.getState() as ReturnType<SceneStoreLike['getState']>
    for (const v of sorted.sorted) {
      const parentId = v.node['parentId']
      state.createNode(v.node, parentId ?? null)
    }
  }
  if (options.withBatch) {
    options.withBatch('import scene', runBody)
  } else {
    runBody()
  }

  // 8. Sync useCFS.
  const project = projectsInFile[0] as CFSProject | undefined
  if (project) {
    cfs.getState().setCFSMode(true)
    const setActiveLibrary = cfs.getState().setActiveLibrary
    if (setActiveLibrary && loadedLibs[project.activeLibraryId as unknown as string]) {
      setActiveLibrary(project.activeLibraryId as unknown as string)
    }
  }

  return {
    status: rejected.size === 0 ? 'success' : 'partial',
    messages,
    importedNodeCount: sorted.sorted.length,
    rejectedNodeCount: rejected.size,
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function failure(messages: string[]): ImportResult {
  return {
    status: 'failure',
    messages,
    importedNodeCount: 0,
    rejectedNodeCount: 0,
  }
}

function sortedKeysReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v).sort()) out[k] = v[k]
    return out
  }
  return value
}

function zodMessage(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
  }
  if (err instanceof Error) return err.message
  return 'Unknown error'
}
