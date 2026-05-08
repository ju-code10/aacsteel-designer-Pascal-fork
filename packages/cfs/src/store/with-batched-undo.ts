import {
  getSceneHistoryPauseDepth,
  pauseSceneHistory,
  resumeSceneHistory,
  useScene,
} from '@pascal-app/core'

// Suppresses Zundo history entries for the duration of `fn`. Composes Pascal's
// reference-counted pauseSceneHistory / resumeSceneHistory, so nested calls
// only resume on the outermost boundary.
//
// Use this around system-driven follow-up mutations that should not enter the
// user-facing undo history (e.g. cached aggregates, derived geometry). The
// user-facing mutation that *should* be undoable runs OUTSIDE this wrapper —
// its single useScene mutation produces exactly one Zundo entry.
//
// The full pre-/post-frame `pendingBatchLabel` machinery from §4.9 — which
// folds system-driven follow-ups in the *next* frame into the same history
// step — arrives in Slice 3 with CFSFramingSystem.
export function withBatchedUndo<T>(_label: string, fn: () => T): T {
  pauseSceneHistory(useScene)
  try {
    return fn()
  } finally {
    resumeSceneHistory(useScene)
  }
}

export { getSceneHistoryPauseDepth as currentBatchDepth }
