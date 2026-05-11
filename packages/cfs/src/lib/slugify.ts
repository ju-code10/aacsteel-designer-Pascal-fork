// §6.0 / §6.6 — slugify a CFSProject.name into a filesystem-safe filename
// fragment. 60-char cap leaves headroom under the 255-char filesystem limit
// after the kind suffix and extension are appended. Empty or all-special
// input falls back to `project`.
export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'project'
  )
}
