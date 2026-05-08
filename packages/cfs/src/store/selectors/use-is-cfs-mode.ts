import { useCFS } from '../use-cfs'

export function useIsCFSMode(): boolean {
  return useCFS((s) => s.isCFSMode)
}
