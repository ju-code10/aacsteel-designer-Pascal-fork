/**
 * Opening framing layout (§1.4).
 *
 * Pure function that, given a wall geometry, an opening list, sections, and
 * a header type, returns the desired set of `DesiredMember` records for
 * king studs, jamb studs, header members, sill (windows only), sill-track
 * (windows only), cripples-above, cripples-below, plus chord-promotion flags
 * and a list of field-stud x positions to remove.
 *
 * The framing-pass orchestrator combines this output with the chord/track/
 * field-stud baseline produced by the existing Slice 3 layout.
 *
 * Slice 7 note: panelization treats the wall as one continuous span here.
 * Splitting an opening's framing across a panel break is a Slice 7 concern;
 * this layout does not consult panel breaks. See `forbidden-break-zones` in
 * `panelization-system.tsx` (Slice 7) — opening intervals are forbidden.
 */

import type { CFSSection } from '../schema/cfs-member-library'
import type { CFSHeaderType, CFSMemberRole } from '../schema/primitives'
import type { CFSSectionId } from '../schema/ids'
import { computeHeaderGeometry } from './header-geometry'
import {
  coalesceOpenings,
  fieldStudExcluded,
  type OpeningFrameInput,
} from './opening-coalesce'

export interface OpeningLayoutDesiredMember {
  /** Opaque key for tracking which opening generated this member; framing-pass uses it to populate `generatedMemberIds`. */
  sourceOpeningId: string
  role: CFSMemberRole
  sectionId: CFSSectionId
  /** Wall-local x of the start. */
  startX_mm: number
  startY_mm: number
  /** Wall-local x of the end. */
  endX_mm: number
  endY_mm: number
}

export interface OpeningInputForLayout {
  id: string
  openingType: 'door' | 'window'
  positionAlongWall_mm: number
  width_mm: number
  height_mm: number
  /** Required for windows; ignored for doors. */
  sillHeight_mm?: number
  /** Per-opening header type override. Falls back to defaultHeaderType. */
  headerType?: CFSHeaderType
}

export interface OpeningLayoutInput {
  wallLength_mm: number
  wallHeight_mm: number
  studSpacing_mm: number
  studSection: CFSSection
  trackSection: CFSSection
  defaultHeaderType: CFSHeaderType
  /** Already validated to be inside the wall. Sorted by positionAlongWall_mm. */
  openings: OpeningInputForLayout[]
}

export interface OpeningLayoutResult {
  members: OpeningLayoutDesiredMember[]
  promoteStartChordToKing: boolean
  promoteEndChordToKing: boolean
  /** x positions of field studs the layout has consumed; framing-pass removes any candidate within tolerance. */
  fieldStudExclusionRanges: { startX_mm: number; endX_mm: number }[]
  /** Per-opening generated-member traceability. */
  generatedMemberIdsByOpening: Map<string, string[]>
  /** Openings the layout could not place (e.g. too wide for the wall, sill above wall). */
  invalidOpeningIds: string[]
}

const TOLERANCE_MM = 1

function headHeightOf(op: OpeningInputForLayout): number {
  if (op.openingType === 'door') return op.height_mm
  return (op.sillHeight_mm ?? 0) + op.height_mm
}

function isOpeningValid(op: OpeningInputForLayout, wallLength_mm: number): boolean {
  if (op.positionAlongWall_mm < -TOLERANCE_MM) return false
  if (op.positionAlongWall_mm + op.width_mm > wallLength_mm + TOLERANCE_MM) return false
  if (op.width_mm <= 0) return false
  if (op.height_mm <= 0) return false
  if (op.openingType === 'window' && (op.sillHeight_mm ?? 0) <= 0) return false
  return true
}

/**
 * Returns x positions of field-stud candidates that fall in `(left, right)`.
 * Inclusive range with tolerance is checked by the caller; this helper just
 * generates the standard candidate set so we can filter cripples by the
 * standard wall spacing.
 */
function fieldStudCandidatesAlongWall(
  spacing_mm: number,
  length_mm: number,
): number[] {
  const out: number[] = []
  for (let x = spacing_mm; x < length_mm; x += spacing_mm) out.push(x)
  if (out.length === 0) return out
  const half = spacing_mm / 2
  const last = out[out.length - 1]!
  if (length_mm - last <= half) out.pop()
  return out
}

export function computeOpeningLayout(input: OpeningLayoutInput): OpeningLayoutResult {
  const {
    wallLength_mm,
    wallHeight_mm,
    studSpacing_mm,
    studSection,
    trackSection,
    defaultHeaderType,
    openings,
  } = input

  const members: OpeningLayoutDesiredMember[] = []
  const generatedMemberIdsByOpening = new Map<string, string[]>()
  const invalidOpeningIds: string[] = []

  // Filter out invalid openings up front. Each invalid opening is reported.
  const valid: OpeningInputForLayout[] = []
  for (const op of openings) {
    if (!isOpeningValid(op, wallLength_mm)) {
      invalidOpeningIds.push(op.id)
    } else {
      valid.push(op)
      generatedMemberIdsByOpening.set(op.id, [])
    }
  }

  if (valid.length === 0) {
    return {
      members,
      promoteStartChordToKing: false,
      promoteEndChordToKing: false,
      fieldStudExclusionRanges: [],
      generatedMemberIdsByOpening,
      invalidOpeningIds,
    }
  }

  const halfFlange = studSection.properties.flangeWidth_mm / 2

  // Build the input shape coalesce expects.
  const frames: OpeningFrameInput[] = valid.map((op) => {
    const ropLeft = op.positionAlongWall_mm
    const ropRight = ropLeft + op.width_mm
    return {
      openingId: op.id,
      ropLeftX_mm: ropLeft,
      ropRightX_mm: ropRight,
      kingLeftX_mm: ropLeft - halfFlange,
      kingRightX_mm: ropRight + halfFlange,
      jambLeftX_mm: ropLeft + halfFlange,
      jambRightX_mm: ropRight - halfFlange,
    }
  })

  const coalesced = coalesceOpenings({
    openings: frames,
    wallLength_mm,
    studSpacing_mm,
  })

  // Track which opening each member belongs to. Use a sentinel id for kings so
  // generatedMemberIdsByOpening attribution works; the framing-pass turns the
  // sentinel into a concrete member id at create time.
  let sentinelCounter = 0
  const sentinel = (): string => {
    sentinelCounter += 1
    return `__opening_member_${sentinelCounter}__`
  }

  // Emit kings (full height).
  for (const king of coalesced.kings) {
    const id = sentinel()
    const owner = king.openingIds[0]!
    members.push({
      sourceOpeningId: owner,
      role: 'king-stud',
      sectionId: studSection.id,
      startX_mm: king.x_mm,
      startY_mm: 0,
      endX_mm: king.x_mm,
      endY_mm: wallHeight_mm,
    })
    for (const oid of king.openingIds) {
      const list = generatedMemberIdsByOpening.get(oid) ?? []
      list.push(id)
      generatedMemberIdsByOpening.set(oid, list)
    }
  }

  // Emit jambs (full height) per opening.
  for (const jamb of coalesced.jambs) {
    const id = sentinel()
    members.push({
      sourceOpeningId: jamb.openingId,
      role: 'jamb-stud',
      sectionId: studSection.id,
      startX_mm: jamb.x_mm,
      startY_mm: 0,
      endX_mm: jamb.x_mm,
      endY_mm: wallHeight_mm,
    })
    const list = generatedMemberIdsByOpening.get(jamb.openingId) ?? []
    list.push(id)
    generatedMemberIdsByOpening.set(jamb.openingId, list)
  }

  // Per-opening: header, sill (window), sill-track (window), cripples.
  const fieldStuds = fieldStudCandidatesAlongWall(studSpacing_mm, wallLength_mm)

  for (const op of valid) {
    const ropLeft = op.positionAlongWall_mm
    const ropRight = ropLeft + op.width_mm
    const jambLeftX = ropLeft + halfFlange
    const jambRightX = ropRight - halfFlange
    const headHeight = headHeightOf(op)

    // Header.
    const headerType = op.headerType ?? defaultHeaderType
    const header = computeHeaderGeometry({
      type: headerType,
      studSection,
      trackSection,
      jambLeftX_mm: jambLeftX,
      jambRightX_mm: jambRightX,
      headHeight_mm: headHeight,
    })

    for (const hm of header.members) {
      const id = sentinel()
      const y = hm.baselineY_mm + hm.offsetY_mm
      members.push({
        sourceOpeningId: op.id,
        role: hm.role,
        sectionId: hm.sectionId,
        startX_mm: hm.startX_mm,
        startY_mm: y,
        endX_mm: hm.endX_mm,
        endY_mm: y,
      })
      const list = generatedMemberIdsByOpening.get(op.id) ?? []
      list.push(id)
      generatedMemberIdsByOpening.set(op.id, list)
    }

    // Cripples above: candidates within (jambLeftX, jambRightX), from
    // headHeight + headerDepth up to wallHeight. Skip if no room.
    const cripplesAboveBaseY = headHeight + header.depth_mm
    if (cripplesAboveBaseY < wallHeight_mm - TOLERANCE_MM) {
      for (const fx of fieldStuds) {
        if (fx <= jambLeftX + TOLERANCE_MM) continue
        if (fx >= jambRightX - TOLERANCE_MM) continue
        const id = sentinel()
        members.push({
          sourceOpeningId: op.id,
          role: 'cripple',
          sectionId: studSection.id,
          startX_mm: fx,
          startY_mm: cripplesAboveBaseY,
          endX_mm: fx,
          endY_mm: wallHeight_mm,
        })
        const list = generatedMemberIdsByOpening.get(op.id) ?? []
        list.push(id)
        generatedMemberIdsByOpening.set(op.id, list)
      }
    }

    // Window-only: sill, sill-track, cripples below.
    if (op.openingType === 'window') {
      const sillY = op.sillHeight_mm ?? 0
      // Sill (single C-section spanning the jambs).
      members.push({
        sourceOpeningId: op.id,
        role: 'sill',
        sectionId: studSection.id,
        startX_mm: jambLeftX,
        startY_mm: sillY,
        endX_mm: jambRightX,
        endY_mm: sillY,
      })
      generatedMemberIdsByOpening.get(op.id)!.push(sentinel())

      // Sill track sits immediately above the sill.
      const sillTrackY = sillY + studSection.properties.thickness_mm
      members.push({
        sourceOpeningId: op.id,
        role: 'sill-track',
        sectionId: trackSection.id,
        startX_mm: jambLeftX,
        startY_mm: sillTrackY,
        endX_mm: jambRightX,
        endY_mm: sillTrackY,
      })
      generatedMemberIdsByOpening.get(op.id)!.push(sentinel())

      // Cripples below: from y=0 up to sillY, at field-stud x positions
      // inside (jambLeftX, jambRightX). Skip if no room.
      if (sillY > TOLERANCE_MM) {
        for (const fx of fieldStuds) {
          if (fx <= jambLeftX + TOLERANCE_MM) continue
          if (fx >= jambRightX - TOLERANCE_MM) continue
          members.push({
            sourceOpeningId: op.id,
            role: 'cripple',
            sectionId: studSection.id,
            startX_mm: fx,
            startY_mm: 0,
            endX_mm: fx,
            endY_mm: sillY,
          })
          generatedMemberIdsByOpening.get(op.id)!.push(sentinel())
        }
      }
    }
  }

  return {
    members,
    promoteStartChordToKing: coalesced.promoteStartChordToKing,
    promoteEndChordToKing: coalesced.promoteEndChordToKing,
    fieldStudExclusionRanges: coalesced.fieldStudExclusionRanges,
    generatedMemberIdsByOpening,
    invalidOpeningIds,
  }
}

export { fieldStudExcluded }
