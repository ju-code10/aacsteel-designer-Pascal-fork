// Tiny id-keyed memoization helper for selector functions whose output depends
// only on the input id and the current value at that id. The cache lives for
// the lifetime of the closure; consumers are expected to invalidate by
// recreating the cache (e.g. via Zustand's subscription) rather than by
// explicit clear calls.
//
// Slice 2 ships the helper; consumers will adopt it as derived-collection
// selectors arrive in later slices.
export function createIdMemo<TInput, TOutput>(
  resolve: (input: TInput) => TOutput,
): (input: TInput, key: unknown) => TOutput {
  let lastKey: unknown = Symbol('uninitialized')
  let lastInput: TInput | undefined
  let lastOutput: TOutput

  return (input, key) => {
    if (key !== lastKey || input !== lastInput) {
      lastKey = key
      lastInput = input
      lastOutput = resolve(input)
    }
    return lastOutput
  }
}
