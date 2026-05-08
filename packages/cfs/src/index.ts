export * from './schema'
export { cfsMemberLength_mm } from './schema/cfs-member'
export {
  useCFS,
  type CFSStore,
  type CFSStoreActions,
  type CFSStoreState,
  type CFSInspectorTab,
  type CFSUnitsDisplay,
  type CFSMemberLibraryMap,
  type CFSActiveTool,
  type CFSServiceHoleShape,
  type CFSServiceHoleToolSettings,
} from './store/use-cfs'
export { withBatchedUndo, currentBatchDepth } from './store/with-batched-undo'
export { findSiteRootId } from './store/find-site-root'
export {
  findCFSProjectId,
  getCFSProject,
  useCFSProject,
  getProjectSettings,
  updateProjectSettings,
  useProjectSettings,
  getActiveLibrary,
  useActiveLibrary,
  getSectionById,
  useSectionById,
  useIsCFSMode,
  useWallFramingSelection,
  useMembersByRole,
  type WallFramingSelection,
  createIdMemo,
} from './store/selectors'
export {
  useOpeningsForFraming,
  getOpeningsForFraming,
} from './store/selectors/use-openings-for-framing'
export {
  formatZodError,
  parseLibrary,
  ssmaLibraryJson,
  tryParseLibrary,
} from './library/load-ssma'
export { CFSFramingSystem } from './systems/framing-system'
export { CFSWallWatcher } from './systems/wall-watcher'
export { CFSOpeningWatcher } from './systems/opening-watcher'
export { CFSServiceHoleSystem } from './systems/service-hole-system'
export { runFramingPass } from './systems/framing-pass'
export { runServiceHolePass, verdictsEquivalent } from './systems/service-hole-pass'
export {
  processDirtyWalls,
  sweepWallsForFraming,
} from './systems/wall-watcher-logic'
export {
  propagateDirtyOpenings,
  propagateDeletedOpenings,
} from './systems/opening-watcher-logic'
export {
  computeOpeningLayout,
  type OpeningInputForLayout,
  type OpeningLayoutInput,
  type OpeningLayoutResult,
} from './lib/opening-layout'
export { computeHeaderGeometry } from './lib/header-geometry'
export { coalesceOpenings, fieldStudExcluded } from './lib/opening-coalesce'
export {
  type Polygon2D,
  sectionPolygon,
  UnsupportedSectionShapeError,
} from './lib/section-polygon'
export {
  type PrePunch,
  type ServiceHoleValidatorInput,
  validateServiceHole,
  expandPrePunches,
  holeLengthAlongMember,
  checkR1End,
  checkR2Width,
  checkR3Spacing,
  checkR4Stiffener,
} from './lib/service-hole-validator'
export {
  AISI_R1,
  AISI_R2,
  AISI_R3,
  AISI_R4,
  R1_MIN_END_DISTANCE_MM,
  R2_MAX_WIDTH_FRACTION_OF_WEB,
  R3_SPACING_MULTIPLIER,
  R4_STIFFENER_THRESHOLD_FRACTION,
} from './lib/aisi-thresholds'
