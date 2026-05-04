import { beforeEach, describe, expect, it } from 'bun:test'
import { getSceneHistoryPauseDepth, useScene } from '@pascal-app/core'
import { withBatchedUndo } from './with-batched-undo'

describe('withBatchedUndo', () => {
  beforeEach(() => {
    useScene.temporal.getState().clear()
    useScene.setState({
      nodes: {},
      rootNodeIds: [],
      dirtyNodes: new Set(),
      collections: {},
    })
  })

  it('runs fn and resumes pause depth to 0', () => {
    expect(getSceneHistoryPauseDepth()).toBe(0)
    const out = withBatchedUndo('test', () => 42)
    expect(out).toBe(42)
    expect(getSceneHistoryPauseDepth()).toBe(0)
  })

  it('nested calls only resume on the outermost boundary', () => {
    let inside = -1
    withBatchedUndo('outer', () => {
      withBatchedUndo('inner', () => {
        inside = getSceneHistoryPauseDepth()
      })
      // After inner resumes the depth must still be 1 (outer is still paused).
      expect(getSceneHistoryPauseDepth()).toBe(1)
    })
    expect(inside).toBe(2)
    expect(getSceneHistoryPauseDepth()).toBe(0)
  })

  it('throwing inside fn still resumes', () => {
    expect(() =>
      withBatchedUndo('throws', () => {
        throw new Error('boom')
      }),
    ).toThrow(/boom/)
    expect(getSceneHistoryPauseDepth()).toBe(0)
  })

  it('mutations inside the wrapper do not produce undo entries', () => {
    const before = useScene.temporal.getState().pastStates.length
    withBatchedUndo('suppress-history', () => {
      useScene.setState((s) => ({
        nodes: {
          ...s.nodes,
          ['scratch']: { type: 'site', id: 'scratch' } as never,
        },
      }))
    })
    const after = useScene.temporal.getState().pastStates.length
    expect(after).toBe(before)
  })
})
