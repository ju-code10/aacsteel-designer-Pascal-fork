// §6.5 importer step 5 — transitive parent rejection. A node whose
// `parentId` is missing from the import set is itself rejected, unless
// it's a Pascal root (a `site` typically has parentId === null; some
// scenes ship with `building` as an unparented root inside the file).
//
// This is the one place the importer admits Pascal node types into its
// reasoning. The list is intentionally small and matches the Pascal
// scene roots documented in upstream Pascal's AGENTS.md.

const PASCAL_ROOT_TYPES = new Set<string>(['site', 'building'])

export function isPascalSiteOrBuilding(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false
  const t = (node as { type?: unknown }).type
  return typeof t === 'string' && PASCAL_ROOT_TYPES.has(t)
}
