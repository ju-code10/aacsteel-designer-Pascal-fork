import { afterEach, describe, expect, it } from 'bun:test'
import { sceneRegistry } from '@pascal-app/core'
import * as THREE from 'three'
import {
  _lastAppliedMode,
  _wallVisibilityCacheSize,
  applyWallVisibility,
  resetWallVisibilityCache,
} from '../wall-visibility'

afterEach(() => {
  sceneRegistry.clear()
  resetWallVisibilityCache()
})

function registerWall(id: string, opts: { visible?: boolean } = {}): THREE.Object3D {
  const obj = new THREE.Object3D()
  if (opts.visible !== undefined) obj.visible = opts.visible
  sceneRegistry.nodes.set(id, obj)
  sceneRegistry.byType.wall.add(id)
  return obj
}

describe('applyWallVisibility', () => {
  it('hides every Pascal wall when CFS mode is on', () => {
    const a = registerWall('wall_a')
    const b = registerWall('wall_b')
    applyWallVisibility(true)
    expect(a.visible).toBe(false)
    expect(b.visible).toBe(false)
  })

  it('restores original visibility when CFS mode is toggled off', () => {
    const a = registerWall('wall_a', { visible: true })
    const b = registerWall('wall_b', { visible: false }) // user manually hid this
    applyWallVisibility(true)
    expect(a.visible).toBe(false)
    expect(b.visible).toBe(false)

    applyWallVisibility(false)
    expect(a.visible).toBe(true)
    expect(b.visible).toBe(false) // user's hidden setting preserved
  })

  it('captures original visibility once across repeated toggle-on calls', () => {
    const a = registerWall('wall_a', { visible: true })
    applyWallVisibility(true)
    // Simulate someone else mutating visible while CFS mode is on.
    a.visible = true
    applyWallVisibility(true)
    // Original is still 'true' (the original cached on first call).
    applyWallVisibility(false)
    expect(a.visible).toBe(true)
  })

  it('handles walls registered after CFS mode is on (re-apply)', () => {
    applyWallVisibility(true)
    expect(_wallVisibilityCacheSize()).toBe(0) // no walls yet
    const c = registerWall('wall_c', { visible: true })
    applyWallVisibility(true) // re-apply on next scene change
    expect(c.visible).toBe(false)
  })

  it('drops cache entries for walls that have left the registry', () => {
    registerWall('wall_a', { visible: true })
    applyWallVisibility(true)
    expect(_wallVisibilityCacheSize()).toBe(1)
    sceneRegistry.byType.wall.delete('wall_a')
    sceneRegistry.nodes.delete('wall_a')
    applyWallVisibility(true)
    expect(_wallVisibilityCacheSize()).toBe(0)
  })

  it('records the last-applied mode (idempotence aid)', () => {
    expect(_lastAppliedMode()).toBeNull()
    applyWallVisibility(true)
    expect(_lastAppliedMode()).toBe(true)
    applyWallVisibility(false)
    expect(_lastAppliedMode()).toBe(false)
  })

  it('resetWallVisibilityCache clears state', () => {
    registerWall('wall_a', { visible: true })
    applyWallVisibility(true)
    expect(_wallVisibilityCacheSize()).toBe(1)
    resetWallVisibilityCache()
    expect(_wallVisibilityCacheSize()).toBe(0)
    expect(_lastAppliedMode()).toBeNull()
  })

  it('does not affect non-wall meshes', () => {
    const slab = new THREE.Object3D()
    sceneRegistry.nodes.set('slab_a', slab)
    sceneRegistry.byType.slab.add('slab_a')
    applyWallVisibility(true)
    expect(slab.visible).toBe(true)
  })
})
