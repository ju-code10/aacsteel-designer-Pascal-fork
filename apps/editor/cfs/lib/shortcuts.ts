// §7.6 — the canonical shortcut map. Both `use-cfs-shortcuts.ts` (binding)
// and `ShortcutsPanel.tsx` (help surface) render from this single source.
// Tooltips on toolbar buttons reference the same labels so the binding,
// the help panel, and the tooltip can never drift apart.

import { IS_MAC, PRIMARY_MOD_LABEL } from './platform'

export type ShortcutCategory = 'mode' | 'tools' | 'edit' | 'export' | 'help'

export interface ShortcutDef {
  /** Stable id for this shortcut. Used by tooltip rendering to look up the
   *  binding for a button without hard-coding letters. */
  id: ShortcutId
  category: ShortcutCategory
  /** Display label, e.g. `T`, `⌘E`, `⌘+Shift+B`. Platform-aware. */
  label: string
  /** Action description, e.g. "Activate opening tool". */
  description: string
  /** Predicate that returns true when the event represents this shortcut. */
  match: (e: KeyboardEvent) => boolean
}

export type ShortcutId =
  | 'cfs:mode:toggle'
  | 'cfs:tool:opening'
  | 'cfs:tool:window'
  | 'cfs:tool:service-hole'
  | 'cfs:tool:panel-break'
  | 'cfs:action:panelize'
  | 'cfs:action:cancel'
  | 'cfs:export:menu'
  | 'cfs:export:bom'
  | 'cfs:export:dxf'
  | 'cfs:export:pdf'
  | 'cfs:export:json'
  | 'cfs:help:shortcuts'

function primaryMod(e: KeyboardEvent): boolean {
  return IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
}

function modifierFreeLetter(code: string) {
  return (e: KeyboardEvent) =>
    e.code === code && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
}

function primaryShift(code: string) {
  return (e: KeyboardEvent) =>
    e.code === code && primaryMod(e) && e.shiftKey && !e.altKey
}

function primaryNoShift(code: string) {
  return (e: KeyboardEvent) =>
    e.code === code && primaryMod(e) && !e.shiftKey && !e.altKey
}

export const SHORTCUTS: readonly ShortcutDef[] = [
  // Mode
  {
    id: 'cfs:mode:toggle',
    category: 'mode',
    label: 'M',
    description: 'Toggle CFS mode (Architectural ↔ CFS)',
    match: modifierFreeLetter('KeyM'),
  },
  // Tools
  {
    id: 'cfs:tool:opening',
    category: 'tools',
    label: 'T',
    description: 'Activate Door tool',
    match: modifierFreeLetter('KeyT'),
  },
  {
    id: 'cfs:tool:window',
    category: 'tools',
    label: 'W',
    description: 'Activate Window tool',
    match: modifierFreeLetter('KeyW'),
  },
  {
    id: 'cfs:tool:service-hole',
    category: 'tools',
    label: 'H',
    description: 'Activate Service-hole tool',
    match: modifierFreeLetter('KeyH'),
  },
  {
    id: 'cfs:tool:panel-break',
    category: 'tools',
    label: 'B',
    description: 'Activate Panel-break tool',
    match: modifierFreeLetter('KeyB'),
  },
  {
    id: 'cfs:action:panelize',
    category: 'tools',
    label: 'P',
    description: 'Panelize All — split every CFS wall in the scene',
    match: modifierFreeLetter('KeyP'),
  },
  {
    id: 'cfs:action:cancel',
    category: 'tools',
    label: 'Esc',
    description: 'Deactivate active tool / dismiss popover',
    match: (e) => e.code === 'Escape',
  },
  // Export
  {
    id: 'cfs:export:menu',
    category: 'export',
    label: `${PRIMARY_MOD_LABEL}+E`,
    description: 'Open Export menu',
    match: primaryNoShift('KeyE'),
  },
  {
    id: 'cfs:export:bom',
    category: 'export',
    label: `${PRIMARY_MOD_LABEL}+Shift+B`,
    description: 'Quick-export BOM (.xlsx)',
    match: primaryShift('KeyB'),
  },
  {
    id: 'cfs:export:dxf',
    category: 'export',
    label: `${PRIMARY_MOD_LABEL}+Shift+D`,
    description: 'Quick-export Panel DXFs (.zip)',
    match: primaryShift('KeyD'),
  },
  {
    id: 'cfs:export:pdf',
    category: 'export',
    label: `${PRIMARY_MOD_LABEL}+Shift+P`,
    description: 'Quick-export Shop drawings (.pdf)',
    match: primaryShift('KeyP'),
  },
  {
    id: 'cfs:export:json',
    category: 'export',
    label: `${PRIMARY_MOD_LABEL}+Shift+E`,
    description: 'Quick-export Scene (.json)',
    match: primaryShift('KeyE'),
  },
  // Help
  {
    id: 'cfs:help:shortcuts',
    category: 'help',
    label: '?',
    description: 'Open Shortcuts panel',
    match: (e) =>
      e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey,
  },
]

// Convenience for tooltip / panel rendering.
const BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]))
export function shortcutById(id: ShortcutId): ShortcutDef | undefined {
  return BY_ID.get(id)
}

/** Render the human-readable label for a shortcut, e.g. "(T)" or "(⌘+Shift+B)". */
export function shortcutHint(id: ShortcutId): string {
  const s = BY_ID.get(id)
  return s ? `(${s.label})` : ''
}

export const SHORTCUT_CATEGORY_TITLES: Record<ShortcutCategory, string> = {
  mode: 'Mode and tools',
  tools: 'Mode and tools',
  edit: 'Edit and history',
  export: 'Export and import',
  help: 'Help and navigation',
}
