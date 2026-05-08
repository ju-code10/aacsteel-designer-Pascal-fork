import { beforeEach, describe, expect, it } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import { useScene } from '@pascal-app/core'
import { CFSOpening } from '../../../schema/cfs-opening'
import { getOpeningsForFraming } from '../use-openings-for-framing'

const FRAMING_ID = '00000000-0000-4000-8aaa-aaaaaaaaaaaa'

let nextUuid = 0
function uuid(): string {
  nextUuid += 1
  const seg = nextUuid.toString(16).padStart(12, '0')
  return `00000000-0000-4000-8a00-${seg}`
}

function reset(): void {
  useScene.setState({
    nodes: {},
    rootNodeIds: [],
    dirtyNodes: new Set(),
    collections: {},
  })
  useScene.temporal.getState().clear()
  nextUuid = 0
}

function makeOpening(framingId: string, position_mm: number, id = uuid()) {
  return CFSOpening.parse({
    type: 'cfs_opening',
    id,
    parentId: framingId,
    openingType: 'door',
    positionAlongWall_mm: position_mm,
    roughDimensions: { width_mm: 900, height_mm: 2100 },
    headerTypeOverride: null,
    generatedMemberIds: [],
  })
}

describe('getOpeningsForFraming', () => {
  beforeEach(reset)

  it('returns child openings sorted by positionAlongWall_mm', () => {
    const a = makeOpening(FRAMING_ID, 1800)
    const b = makeOpening(FRAMING_ID, 600)
    const c = makeOpening(FRAMING_ID, 3000)
    useScene.setState((s) => ({
      nodes: {
        ...s.nodes,
        [a.id]: a as unknown as AnyNode as never,
        [b.id]: b as unknown as AnyNode as never,
        [c.id]: c as unknown as AnyNode as never,
      },
    }))
    const result = getOpeningsForFraming(
      useScene.getState().nodes as unknown as Record<string, AnyNode>,
      FRAMING_ID,
    )
    expect(result.map((o) => o.positionAlongWall_mm)).toEqual([600, 1800, 3000])
  })

  it('returns [] when there are no children', () => {
    expect(
      getOpeningsForFraming(
        useScene.getState().nodes as unknown as Record<string, AnyNode>,
        FRAMING_ID,
      ),
    ).toEqual([])
  })

  it('ignores openings parented to other framings', () => {
    const mine = makeOpening(FRAMING_ID, 600)
    const theirs = makeOpening('11111111-1111-4111-8111-111111111111', 1200)
    useScene.setState((s) => ({
      nodes: {
        ...s.nodes,
        [mine.id]: mine as unknown as AnyNode as never,
        [theirs.id]: theirs as unknown as AnyNode as never,
      },
    }))
    const result = getOpeningsForFraming(
      useScene.getState().nodes as unknown as Record<string, AnyNode>,
      FRAMING_ID,
    )
    expect(result.length).toBe(1)
    expect(result[0]!.id).toBe(mine.id)
  })
})
