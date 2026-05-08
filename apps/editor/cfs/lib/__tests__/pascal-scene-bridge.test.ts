import { afterEach, describe, expect, it } from 'bun:test'
import { sceneRegistry } from '@pascal-app/core'
import * as THREE from 'three'
import {
  _resetSceneCache,
  attachToPascalScene,
  detachFromPascalScene,
  getPascalScene,
} from '../pascal-scene-bridge'

afterEach(() => {
  sceneRegistry.clear()
  _resetSceneCache()
})

describe('pascal-scene-bridge', () => {
  it('returns null when no Pascal node has been registered yet', () => {
    expect(getPascalScene()).toBeNull()
  })

  it('finds the scene by walking up the parent chain of any registered Object3D', () => {
    const scene = new THREE.Scene()
    const wallMesh = new THREE.Mesh()
    scene.add(wallMesh)
    sceneRegistry.nodes.set('wall-1', wallMesh)
    expect(getPascalScene()).toBe(scene)
  })

  it('caches the scene reference across calls', () => {
    const scene = new THREE.Scene()
    const obj = new THREE.Object3D()
    scene.add(obj)
    sceneRegistry.nodes.set('node-1', obj)
    const a = getPascalScene()
    sceneRegistry.nodes.clear() // Pascal-side reset
    // Cached value is still returned (the Scene object itself is still alive).
    const b = getPascalScene()
    expect(a).toBe(b)
  })

  it('attachToPascalScene adds the group to Pascal\'s scene', () => {
    const scene = new THREE.Scene()
    sceneRegistry.nodes.set('seed', scene.add(new THREE.Object3D()).children[0]!)
    const group = new THREE.Group()
    expect(attachToPascalScene(group)).toBe(true)
    expect(group.parent).toBe(scene)
    expect(group.name).toBe('cfs-root-group')
  })

  it('attachToPascalScene returns false when the scene is not yet available', () => {
    const group = new THREE.Group()
    expect(attachToPascalScene(group)).toBe(false)
    expect(group.parent).toBeNull()
  })

  it('attachToPascalScene is idempotent (already-attached group stays put)', () => {
    const scene = new THREE.Scene()
    sceneRegistry.nodes.set('seed', scene.add(new THREE.Object3D()).children[0]!)
    const group = new THREE.Group()
    attachToPascalScene(group)
    const childCountBefore = scene.children.length
    expect(attachToPascalScene(group)).toBe(true)
    expect(scene.children.length).toBe(childCountBefore)
  })

  it('attachToPascalScene moves a group from one scene to another', () => {
    const sceneA = new THREE.Scene()
    sceneRegistry.nodes.set('seedA', sceneA.add(new THREE.Object3D()).children[0]!)
    const group = new THREE.Group()
    attachToPascalScene(group)

    sceneRegistry.nodes.clear()
    _resetSceneCache()
    const sceneB = new THREE.Scene()
    sceneRegistry.nodes.set('seedB', sceneB.add(new THREE.Object3D()).children[0]!)
    expect(attachToPascalScene(group)).toBe(true)
    expect(group.parent).toBe(sceneB)
    expect(sceneA.children).not.toContain(group)
  })

  it('detachFromPascalScene removes the group from its parent', () => {
    const scene = new THREE.Scene()
    sceneRegistry.nodes.set('seed', scene.add(new THREE.Object3D()).children[0]!)
    const group = new THREE.Group()
    attachToPascalScene(group)
    detachFromPascalScene(group)
    expect(group.parent).toBeNull()
  })

  it('detachFromPascalScene is safe on a never-attached group', () => {
    expect(() => detachFromPascalScene(new THREE.Group())).not.toThrow()
  })
})
