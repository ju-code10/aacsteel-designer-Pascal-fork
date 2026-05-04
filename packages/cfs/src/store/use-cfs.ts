'use client'

import { create } from 'zustand'

export interface CFSStoreState {
  isCFSMode: boolean
}

export interface CFSStoreActions {
  setCFSMode: (next: boolean) => void
}

export type CFSStore = CFSStoreState & CFSStoreActions

export const useCFS = create<CFSStore>((set) => ({
  isCFSMode: false,
  setCFSMode: (next) => set({ isCFSMode: next }),
}))
