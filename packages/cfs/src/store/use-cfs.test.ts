import { beforeEach, describe, expect, it } from 'bun:test'
import { useCFS } from './use-cfs'

describe('useCFS', () => {
  beforeEach(() => {
    useCFS.setState({ isCFSMode: false })
  })

  it('defaults to isCFSMode === false', () => {
    expect(useCFS.getState().isCFSMode).toBe(false)
  })

  it('flips via setCFSMode(true)', () => {
    useCFS.getState().setCFSMode(true)
    expect(useCFS.getState().isCFSMode).toBe(true)
  })

  it('flips back via setCFSMode(false)', () => {
    useCFS.getState().setCFSMode(true)
    useCFS.getState().setCFSMode(false)
    expect(useCFS.getState().isCFSMode).toBe(false)
  })

  it('exposes setCFSMode as a stable function reference across reads', () => {
    const a = useCFS.getState().setCFSMode
    const b = useCFS.getState().setCFSMode
    expect(a).toBe(b)
  })
})
