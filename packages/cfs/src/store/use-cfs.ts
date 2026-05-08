'use client'

import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { CFSProject } from '../schema/cfs-project'
import type { CFSMemberLibrary } from '../schema/cfs-member-library'
import type { CFSMember } from '../schema/cfs-member'
import type { CFSWallFraming } from '../schema/cfs-wall-framing'
import { CFSProjectSettings } from '../schema/primitives'
import type {
  CFSHeaderType,
  CFSProjectSettings as CFSProjectSettingsType,
} from '../schema/primitives'
import type { CFSMemberLibraryId, CFSProjectId } from '../schema/ids'
import { findSiteRootId } from './find-site-root'
import { tryParseLibrary } from '../library/load-ssma'

export type CFSInspectorTab = 'wall' | 'opening' | 'panel' | 'holes' | 'settings'
export type CFSUnitsDisplay = 'metric' | 'imperial'
export type CFSMemberLibraryMap = Record<CFSMemberLibraryId, CFSMemberLibrary>
export type CFSActiveTool = 'cfs-door' | 'cfs-window' | 'cfs-service-hole' | null
export type CFSServiceHoleShape = 'round' | 'oblong'

/** §7.3.2 — settings shared by `ServiceHoleTool` placement and `ServiceHoleGhost` hover preview. */
export interface CFSServiceHoleToolSettings {
  /** Last-used diameter (mm). Default 38 mm = SSMA pre-punch size. */
  lastDiameter_mm: number
  /** Round (default) or oblong (Shift while clicking). */
  shape: CFSServiceHoleShape
  /** When true (Alt held), snap pos to nearest 50 mm multiple. */
  snapToGrid: boolean
  /** Fixed oblong width across the web — SSMA convention is 38 mm. */
  oblongWidth_mm: number
}

export interface CFSStoreState {
  // mode
  isCFSMode: boolean

  // inspector / UI
  inspectorTab: CFSInspectorTab
  hoveredMemberId: string | null
  selectedPanelId: string | null
  selectedHoleId: string | null

  // active CFS tool (separate from Pascal's tool union since we cannot extend it)
  activeTool: CFSActiveTool
  serviceHoleTool: CFSServiceHoleToolSettings

  // libraries
  memberLibraries: CFSMemberLibraryMap
  activeLibraryId: CFSMemberLibraryId | null

  // per-user preferences
  unitsDisplay: CFSUnitsDisplay
  preferredHeaderType: CFSHeaderType

  // transient lifecycle flags
  isLibraryLoading: boolean
  libraryLoadError: string | null
}

export interface CFSStoreActions {
  setCFSMode: (next: boolean) => void

  setInspectorTab: (tab: CFSInspectorTab) => void
  setHoveredMember: (id: string | null) => void
  setSelectedPanel: (id: string | null) => void
  setSelectedHole: (id: string | null) => void

  setActiveTool: (tool: CFSActiveTool) => void
  setServiceHoleDiameter: (diameter_mm: number) => void
  setServiceHoleShape: (shape: CFSServiceHoleShape) => void
  setServiceHoleSnap: (snap: boolean) => void

  loadLibrary: (json: unknown) => Promise<void>
  setActiveLibrary: (id: CFSMemberLibraryId) => void

  setUnitsDisplay: (units: CFSUnitsDisplay) => void
  setPreferredHeaderType: (header: CFSHeaderType) => void
}

export type CFSStore = CFSStoreState & CFSStoreActions

const initialState: CFSStoreState = {
  isCFSMode: false,
  inspectorTab: 'wall',
  hoveredMemberId: null,
  selectedPanelId: null,
  selectedHoleId: null,
  activeTool: null,
  serviceHoleTool: {
    lastDiameter_mm: 38,
    shape: 'round',
    snapToGrid: false,
    oblongWidth_mm: 38,
  },
  memberLibraries: {},
  activeLibraryId: null,
  unitsDisplay: 'imperial',
  preferredHeaderType: 'box',
  isLibraryLoading: false,
  libraryLoadError: null,
}

/** §7.3.2 — clamps for the diameter stepper / scroll-wheel adjustment. */
const SERVICE_HOLE_MIN_DIAMETER_MM = 12
const SERVICE_HOLE_MAX_DIAMETER_MM = 600 // hard cap; the tool further clamps to web depth at point of use

function generateUuid(): string {
  // crypto.randomUUID is available in modern browsers, Node 19+, and Bun.
  // The non-null assertion is safe because the runtimes we ship to all expose it.
  const cryptoRef: { randomUUID?: () => string } = (globalThis as unknown as {
    crypto?: { randomUUID?: () => string }
  }).crypto ?? {}
  if (typeof cryptoRef.randomUUID === 'function') return cryptoRef.randomUUID()
  // Fallback: RFC4122-ish v4 from Math.random for environments without crypto.
  const hex = (n: number) => Math.floor(Math.random() * 16 ** n)
    .toString(16)
    .padStart(n, '0')
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`
}

function nowIso(): string {
  return new Date().toISOString()
}

export const useCFS = create<CFSStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      setCFSMode: (next) => {
        set({ isCFSMode: next })
        if (!next) return

        // First-activation project creation: ensure a singleton CFSProject node.
        const sceneState = useScene.getState()
        const existingProject = Object.values(sceneState.nodes).find(
          (n) => (n as { type?: string }).type === 'cfs_project',
        )
        if (existingProject) return

        const { activeLibraryId, preferredHeaderType, unitsDisplay, memberLibraries } = get()
        if (!activeLibraryId) {
          set({
            libraryLoadError:
              get().libraryLoadError ??
              'Cannot create CFS project: no member library is loaded.',
          })
          return
        }

        const library = memberLibraries[activeLibraryId]
        if (!library) {
          set({ libraryLoadError: `Active library ${activeLibraryId} is not registered.` })
          return
        }

        const studSection = library.sections.find(
          (s) => s.shape === 'C' && s.designation === '362S162-54',
        ) ?? library.sections.find((s) => s.shape === 'C')
        const trackSection = library.sections.find(
          (s) => s.shape === 'U' && s.designation === '362T125-54',
        ) ?? library.sections.find((s) => s.shape === 'U')
        if (!studSection || !trackSection) {
          set({
            libraryLoadError: `Library ${library.id} must include at least one C and one U section.`,
          })
          return
        }

        const siteRootId = findSiteRootId(sceneState)
        if (!siteRootId) {
          set({
            libraryLoadError:
              'Cannot create CFS project: Pascal scene has no root site node yet.',
          })
          return
        }

        const settings: CFSProjectSettingsType = CFSProjectSettings.parse({
          defaultStudSection: studSection.id,
          defaultTrackSection: trackSection.id,
          defaultHeaderType: preferredHeaderType,
          units: unitsDisplay,
        })

        const project = CFSProject.parse({
          type: 'cfs_project',
          id: generateUuid(),
          parentId: siteRootId,
          schemaVersion: '1.0.0',
          name: 'Untitled CFS project',
          settings,
          libraries: [activeLibraryId],
          activeLibraryId,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          metadata: {},
        })

        useScene
          .getState()
          .createNode(project as unknown as AnyNode, siteRootId as unknown as AnyNodeId)
      },

      setInspectorTab: (tab) => set({ inspectorTab: tab }),
      setHoveredMember: (id) => set({ hoveredMemberId: id }),
      setSelectedPanel: (id) => set({ selectedPanelId: id }),
      setSelectedHole: (id) => set({ selectedHoleId: id }),

      setActiveTool: (tool) => set({ activeTool: tool }),
      setServiceHoleDiameter: (diameter_mm) => {
        const clamped = Math.min(
          Math.max(diameter_mm, SERVICE_HOLE_MIN_DIAMETER_MM),
          SERVICE_HOLE_MAX_DIAMETER_MM,
        )
        set((s) => ({
          serviceHoleTool: { ...s.serviceHoleTool, lastDiameter_mm: clamped },
        }))
      },
      setServiceHoleShape: (shape) =>
        set((s) => ({ serviceHoleTool: { ...s.serviceHoleTool, shape } })),
      setServiceHoleSnap: (snap) =>
        set((s) => ({ serviceHoleTool: { ...s.serviceHoleTool, snapToGrid: snap } })),

      loadLibrary: async (json) => {
        set({ isLibraryLoading: true, libraryLoadError: null })
        const result = tryParseLibrary(json)
        if (!result.ok) {
          set({ isLibraryLoading: false, libraryLoadError: result.error })
          return
        }
        const library = result.library
        set((s) => ({
          memberLibraries: { ...s.memberLibraries, [library.id]: library },
          activeLibraryId: s.activeLibraryId ?? library.id,
          isLibraryLoading: false,
          libraryLoadError: null,
        }))
      },

      setActiveLibrary: (id) => {
        const { memberLibraries, activeLibraryId } = get()
        if (!memberLibraries[id]) {
          set({ libraryLoadError: `Library ${id} is not registered.` })
          return
        }
        if (activeLibraryId === id) return
        set({ activeLibraryId: id })

        // Cross-store dirty propagation (§4.8): every CFSWallFraming and every
        // CFSMember in the scene re-resolves its sectionId against the new
        // library on the next frame. Slice 2 implementation is a full sweep;
        // the appendix flags this for profiling in larger scenes.
        const scene = useScene.getState()
        for (const node of Object.values(scene.nodes)) {
          const t = (node as { type?: string }).type
          if (t === 'cfs_wall_framing' || t === 'cfs_member') {
            const nodeId = (node as unknown as CFSWallFraming | CFSMember).id
            scene.markDirty(nodeId as unknown as AnyNodeId)
          }
        }
      },

      setUnitsDisplay: (units) => set({ unitsDisplay: units }),
      setPreferredHeaderType: (header) => set({ preferredHeaderType: header }),
    }),
    {
      name: 'aacsteel.cfs',
      partialize: (s) => ({
        unitsDisplay: s.unitsDisplay,
        preferredHeaderType: s.preferredHeaderType,
        activeLibraryId: s.activeLibraryId,
        serviceHoleTool: s.serviceHoleTool,
      }),
    },
  ),
)

// Re-export the project-id type for consumers that need it on selectors.
export type { CFSProjectId }
