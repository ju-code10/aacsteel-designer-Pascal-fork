// Field-stud candidate positions along a wall (§1.4 stud spacing rule).
//
// Studs are placed at the project's on-center spacing, measured from
// the wall's start. The last field stud is omitted when its distance
// to the wall end is at or below half the spacing — the chord stud at
// the wall end already covers that load (§1.4, FRM-04).
//
// Extracted into its own file so `stacked-walls.ts` can reuse the same
// algorithm when computing positions inherited from the wall below.

export function findStudCandidatesAlongWall(
  spacing_mm: number,
  length_mm: number,
): number[] {
  const candidates: number[] = []
  for (let x = spacing_mm; x < length_mm; x += spacing_mm) candidates.push(x)
  if (candidates.length === 0) return candidates
  const half = spacing_mm / 2
  const last = candidates[candidates.length - 1] as number
  if (length_mm - last <= half) candidates.pop()
  return candidates
}
