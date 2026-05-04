// Bun test preload. Slice 2's tests import `@pascal-app/core` so they can
// drive `useScene` directly. The Pascal core barrel transitively pulls in
// `three-bvh-csg` (via `WallSystem` and friends), whose UMD build fails to
// initialize under Bun's CJS interop with the message
// "The superclass is not a constructor".
//
// We stub those two modules out for the test environment so the rest of the
// barrel evaluates. None of the CFS tests touch CSG or BVH; they only need
// the store and history-control surface from core.
import { mock } from 'bun:test'

// Pascal's updateNodesAction batches dirty-marking via requestAnimationFrame.
// Bun's test runtime doesn't provide one out of the box; substitute a
// synchronous shim so updates flush immediately within tests.
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

// Provide a tiny in-memory localStorage so Zustand's persist middleware does
// not log warnings on every setState during tests. The shim is a Map proxy.
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
