import { describe, expect, it } from 'bun:test'
import { computeWallTrim, type JunctionPeer } from '../corner-trim'

const east = { x: 1, z: 0 }
const north = { x: 0, z: 1 }
const WEB_92 = 92 // through-wall web depth for a 362-series stud (mm)
const WEB_152 = 152 // through-wall web depth for a 600-series stud (mm)

function p(x: number, z: number, y = 0) {
  return { x_mm: x, y_mm: y, z_mm: z }
}

// A reference horizontal wall A: 3000mm long along +x, anchored at origin.
const aStart = p(0, 0)
const aEnd = p(3000, 0)

describe('computeWallTrim — L corner', () => {
  it('free wall with no peers has zero trim', () => {
    const trim = computeWallTrim({
      ownFramingId: 'a',
      ownSceneIndex: 0,
      ownStart: aStart,
      ownEnd: aEnd,
      ownDirection: east,
      peers: [],
    })
    expect(trim.startTrim_mm).toBe(0)
    expect(trim.endTrim_mm).toBe(0)
    expect(trim.startJunction.kind).toBe('free')
    expect(trim.endJunction.kind).toBe('free')
    expect(trim.tPosts).toHaveLength(0)
  })

  it('first-placed wall A runs THROUGH at the shared corner', () => {
    // Wall A placed first (sceneIndex 0), wall B placed second (1).
    // B starts at A's end, runs perpendicular (north). A should be through.
    const peerB: JunctionPeer = {
      framingId: 'b',
      sceneIndex: 1,
      start: aEnd,
      end: p(3000, 3000),
      direction: north,
      studWebDepth_mm: WEB_92,
    }
    const trimA = computeWallTrim({
      ownFramingId: 'a',
      ownSceneIndex: 0,
      ownStart: aStart,
      ownEnd: aEnd,
      ownDirection: east,
      peers: [peerB],
    })
    expect(trimA.startJunction.kind).toBe('free')
    expect(trimA.endJunction.kind).toBe('L-through')
    expect(trimA.startTrim_mm).toBe(0)
    expect(trimA.endTrim_mm).toBe(0)
  })

  it('second-placed wall B is the BUTT at the shared corner', () => {
    // Same scene, viewed from B's perspective.
    const peerA: JunctionPeer = {
      framingId: 'a',
      sceneIndex: 0,
      start: aStart,
      end: aEnd,
      direction: east,
      studWebDepth_mm: WEB_92,
    }
    const trimB = computeWallTrim({
      ownFramingId: 'b',
      ownSceneIndex: 1,
      ownStart: aEnd,
      ownEnd: p(3000, 3000),
      ownDirection: north,
      peers: [peerA],
    })
    expect(trimB.startJunction.kind).toBe('L-butt')
    expect(trimB.startTrim_mm).toBe(WEB_92)
    expect(trimB.endJunction.kind).toBe('free')
    expect(trimB.endTrim_mm).toBe(0)
    expect(trimB.startJunction.butt?.peerFramingId).toBe('a')
  })

  it('placement order swap inverts the through/butt assignment', () => {
    // Now B (sceneIndex 0) is first-placed; A (sceneIndex 1) is the butt.
    const peerA: JunctionPeer = {
      framingId: 'a',
      sceneIndex: 1,
      start: aStart,
      end: aEnd,
      direction: east,
      studWebDepth_mm: WEB_92,
    }
    const peerBFromA: JunctionPeer = {
      framingId: 'b',
      sceneIndex: 0,
      start: aEnd,
      end: p(3000, 3000),
      direction: north,
      studWebDepth_mm: WEB_92,
    }
    const trimA = computeWallTrim({
      ownFramingId: 'a',
      ownSceneIndex: 1,
      ownStart: aStart,
      ownEnd: aEnd,
      ownDirection: east,
      peers: [peerBFromA],
    })
    expect(trimA.endJunction.kind).toBe('L-butt')
    expect(trimA.endTrim_mm).toBe(WEB_92)
    const trimB = computeWallTrim({
      ownFramingId: 'b',
      ownSceneIndex: 0,
      ownStart: aEnd,
      ownEnd: p(3000, 3000),
      ownDirection: north,
      peers: [peerA],
    })
    expect(trimB.startJunction.kind).toBe('L-through')
    expect(trimB.startTrim_mm).toBe(0)
  })

  it('trim amount is the THROUGH wall web depth, not own', () => {
    // Through wall uses a deep 600-series section (WEB_152); butting wall
    // uses a 362-series (WEB_92). The butt trim should be 152, not 92.
    const peerThrough: JunctionPeer = {
      framingId: 'a',
      sceneIndex: 0,
      start: aStart,
      end: aEnd,
      direction: east,
      studWebDepth_mm: WEB_152,
    }
    const trimButt = computeWallTrim({
      ownFramingId: 'b',
      ownSceneIndex: 1,
      ownStart: aEnd,
      ownEnd: p(3000, 3000),
      ownDirection: north,
      peers: [peerThrough],
    })
    expect(trimButt.startTrim_mm).toBe(WEB_152)
  })

  it('collinear walls sharing an endpoint do not trim each other', () => {
    // A and B both run east, joined head-to-tail at (3000, 0). This is the
    // collinear-shared case — chord ownership is handled by corner-detect's
    // smallest-id rule, not by trimming.
    const peerB: JunctionPeer = {
      framingId: 'b',
      sceneIndex: 1,
      start: aEnd,
      end: p(6000, 0),
      direction: east,
      studWebDepth_mm: WEB_92,
    }
    const trimA = computeWallTrim({
      ownFramingId: 'a',
      ownSceneIndex: 0,
      ownStart: aStart,
      ownEnd: aEnd,
      ownDirection: east,
      peers: [peerB],
    })
    expect(trimA.endJunction.kind).toBe('collinear-shared')
    expect(trimA.endTrim_mm).toBe(0)
  })

  it('peers on a different level do not affect this wall', () => {
    const peerUpper: JunctionPeer = {
      framingId: 'b',
      sceneIndex: 1,
      start: p(3000, 0, 2700),
      end: p(3000, 3000, 2700),
      direction: north,
      studWebDepth_mm: WEB_92,
    }
    const trimA = computeWallTrim({
      ownFramingId: 'a',
      ownSceneIndex: 0,
      ownStart: aStart,
      ownEnd: aEnd,
      ownDirection: east,
      peers: [peerUpper],
    })
    expect(trimA.endJunction.kind).toBe('free')
    expect(trimA.endTrim_mm).toBe(0)
  })
})

describe('computeWallTrim — T junction', () => {
  it('peer butts into our interior → T-post emitted, we are NOT trimmed', () => {
    // A runs east, 3000mm. B runs north starting at the middle of A.
    const peerB: JunctionPeer = {
      framingId: 'b',
      sceneIndex: 1,
      start: p(1500, 0),
      end: p(1500, 3000),
      direction: north,
      studWebDepth_mm: WEB_92,
    }
    const trimA = computeWallTrim({
      ownFramingId: 'a',
      ownSceneIndex: 0,
      ownStart: aStart,
      ownEnd: aEnd,
      ownDirection: east,
      peers: [peerB],
    })
    expect(trimA.startTrim_mm).toBe(0)
    expect(trimA.endTrim_mm).toBe(0)
    expect(trimA.tPosts).toHaveLength(1)
    expect(trimA.tPosts[0]!.positionAlongWall_mm).toBeCloseTo(1500)
    expect(trimA.tPosts[0]!.peerFramingId).toBe('b')
  })

  it('our endpoint lands on a peer interior → we are T-butt, trimmed', () => {
    // B's start (1500, 0) lands on A's interior; from B's POV that's a T-butt.
    // Trim amount should be A's stud web depth.
    const peerA: JunctionPeer = {
      framingId: 'a',
      sceneIndex: 0,
      start: aStart,
      end: aEnd,
      direction: east,
      studWebDepth_mm: WEB_92,
    }
    const trimB = computeWallTrim({
      ownFramingId: 'b',
      ownSceneIndex: 1,
      ownStart: p(1500, 0),
      ownEnd: p(1500, 3000),
      ownDirection: north,
      peers: [peerA],
    })
    expect(trimB.startJunction.kind).toBe('T-butt')
    expect(trimB.startTrim_mm).toBe(WEB_92)
    expect(trimB.startJunction.butt?.peerFramingId).toBe('a')
    expect(trimB.endJunction.kind).toBe('free')
  })

  it('placement order does not change T classification — geometry decides', () => {
    // Same as the previous test but with B (the T-butt) placed first.
    // It is still T-butt because its endpoint lies on A's interior.
    const peerA: JunctionPeer = {
      framingId: 'a',
      sceneIndex: 1, // A placed second
      start: aStart,
      end: aEnd,
      direction: east,
      studWebDepth_mm: WEB_92,
    }
    const trimB = computeWallTrim({
      ownFramingId: 'b',
      ownSceneIndex: 0, // B placed first
      ownStart: p(1500, 0),
      ownEnd: p(1500, 3000),
      ownDirection: north,
      peers: [peerA],
    })
    expect(trimB.startJunction.kind).toBe('T-butt')
    expect(trimB.startTrim_mm).toBe(WEB_92)
  })

  it('peer endpoint very close to our endpoint is NOT a T-junction', () => {
    // A peer endpoint within plan-tolerance of our endpoint is an L-corner,
    // not a T-junction. (Otherwise an L would be double-classified.)
    const peerB: JunctionPeer = {
      framingId: 'b',
      sceneIndex: 1,
      start: aEnd, // exactly at A's end → L-corner
      end: p(3000, 3000),
      direction: north,
      studWebDepth_mm: WEB_92,
    }
    const trimA = computeWallTrim({
      ownFramingId: 'a',
      ownSceneIndex: 0,
      ownStart: aStart,
      ownEnd: aEnd,
      ownDirection: east,
      peers: [peerB],
    })
    expect(trimA.tPosts).toHaveLength(0)
    expect(trimA.endJunction.kind).toBe('L-through')
  })

  it('two peers butting into one wall produce two T-posts', () => {
    const peerB: JunctionPeer = {
      framingId: 'b',
      sceneIndex: 1,
      start: p(1000, 0),
      end: p(1000, 3000),
      direction: north,
      studWebDepth_mm: WEB_92,
    }
    const peerC: JunctionPeer = {
      framingId: 'c',
      sceneIndex: 2,
      start: p(2000, 0),
      end: p(2000, -3000),
      direction: { x: 0, z: -1 },
      studWebDepth_mm: WEB_92,
    }
    const trimA = computeWallTrim({
      ownFramingId: 'a',
      ownSceneIndex: 0,
      ownStart: aStart,
      ownEnd: aEnd,
      ownDirection: east,
      peers: [peerB, peerC],
    })
    expect(trimA.tPosts).toHaveLength(2)
    expect(trimA.tPosts[0]!.positionAlongWall_mm).toBeCloseTo(1000)
    expect(trimA.tPosts[1]!.positionAlongWall_mm).toBeCloseTo(2000)
  })
})
