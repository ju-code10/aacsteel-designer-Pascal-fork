// Bun test preload for the editor app. Mirrors the same shims the cfs
// package uses to keep `@pascal-app/core` importable in Bun's test runtime.
import { mock } from 'bun:test'

type AnyFn = (...args: unknown[]) => unknown
const g = globalThis as unknown as {
  requestAnimationFrame?: (cb: AnyFn) => number
  cancelAnimationFrame?: (id: number) => void
  localStorage?: Storage
}
if (typeof g.requestAnimationFrame !== 'function') {
  let nextId = 1
  g.requestAnimationFrame = (cb) => {
    cb(performance.now())
    return nextId++
  }
  g.cancelAnimationFrame = () => {
    /* no-op */
  }
}

if (typeof g.localStorage === 'undefined') {
  const store = new Map<string, string>()
  g.localStorage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => {
      store.delete(k)
    },
    setItem: (k, v) => {
      store.set(k, String(v))
    },
  } as Storage
}

mock.module('three-mesh-bvh', () => ({
  BVH: class {},
  StaticGeometryGenerator: class {},
  computeBoundsTree: () => null,
  disposeBoundsTree: () => null,
  acceleratedRaycast: () => null,
  CONTAINED: 0,
  INTERSECTED: 1,
  NOT_INTERSECTED: 2,
}))

mock.module('three-bvh-csg', () => ({
  Brush: class {},
  Evaluator: class {
    evaluate() {
      return null
    }
  },
  ADDITION: 0,
  SUBTRACTION: 1,
  INTERSECTION: 2,
  DIFFERENCE: 3,
  HOLLOW_INTERSECTION: 4,
  HOLLOW_SUBTRACTION: 5,
  REVERSE_SUBTRACTION: 6,
}))
