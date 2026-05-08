# Spec slice G — reconciliations to apply

This is the audit log of in-place edits the slice G sweep determined are needed in
sections 0 through 7. Each row is a surgical change: a specific span of an existing
section file, what it currently says, what it should say after slice G, and the
reason. The edits are presented as a checklist so a follow-up commit can apply them
mechanically without re-deriving the reasoning.

The numbering here is independent of the appendix's reconciliation table — this log
is for the human committer; the appendix entry (A.2) is for future readers. Both
describe the same set of changes and must stay in sync if either is edited.

> Conventions: section paths are the per-section files in `docs/`. Where a change
> is a one-line replacement, both the before and after lines are quoted verbatim.
> Where a change is a paragraph or a table cell, only the relevant span is shown
> with `[...]` for unchanged surrounding content.

---

## R-01 — §1.4 chord+king coalescing wording

**File:** `docs/section-1-cfs-domain-primer.md` (currently inside `docs/PROJECT_SPEC.md`,
section 1.4, "Stud-role coalescing", second-to-last paragraph).

**Current text:**

> **Opening at the wall's edge.** The chord stud and the king stud collapse into
> one member, given the role of king (the structurally more demanding role).

**Replacement text:**

> **Opening at the wall's edge.** The chord stud and the king stud collapse into a
> single member. In v1 the coalesced member retains the `chord-stud` role,
> because the adjacent wall expects to find a chord stud at the shared corner;
> the framing's cached aggregates flag the member as also serving the king's
> load-redirection role for the user's awareness. The structural-role question —
> whether a chord-with-king-duty needs a different section than a plain chord —
> is deferred to slice 12. The implementation lives in §5.1 step 7.

**Reason:** Reconciles with §5.1 step 7's implementation, which uses chord-wins
priority. §5.1 is the contract systems read; §1.4 is the domain primer. Aligning
§1.4 to match §5.1 keeps the implementation as the authoritative description and
prevents future readers from coding to the old §1.4 wording.

**Cross-references to update:** §5.1's "Worked coalescing — opening at wall edge"
note can drop the `pending reconciliation` clause, since §1.4 now matches.

---

## R-02 — §2.9 file list, remove `opening-system.tsx`

**File:** Section 2 of `docs/PROJECT_SPEC.md`, §2.9 ("File and folder conventions"),
the directory tree under `packages/cfs/src/systems/`.

**Current entries (in order):**

```
    systems/
      framing-system.tsx
      opening-system.tsx
      geometry-system.tsx
      service-hole-system.tsx
      panelization-system.tsx
```

**Replacement entries:**

```
    systems/
      framing-system.tsx
      geometry-system.tsx
      service-hole-system.tsx
      panelization-system.tsx
```

**Reason:** §5.1's architectural note consolidates framing and opening logic into
one system in `framing-system.tsx`. The §2.9 listing was written before that
decision; removing `opening-system.tsx` from the file list aligns the architecture
section with section 5's contract. `OpeningTool.tsx` (the editor-side tool) is
unaffected and remains in `apps/editor/cfs/components/tools/`.

---

## R-03 — §3.3 add `prePunchPattern` to `CFSSection`

**File:** Section 3 of `docs/section-3-data-model.md` (or `PROJECT_SPEC.md` once
merged), §3.3 "CFSMemberLibrary and CFSSection", inside the `CFSSection` schema
definition.

**Current schema (relevant span):**

```ts
export const CFSSection = z.object({
  id:                CFSSectionId,
  designation:       z.string().min(1),       // e.g. '362S162-54'
  shape:             CFSProfileShape,
  properties:        CFSSectionProperties,
  material:          CFSMaterial,
  linearMass_kgPerM: z.number().positive(),

  structuralProperties: z.object({ /* ... */ }).strict().optional(),
}).strict();
```

**Replacement schema (full block):**

```ts
export const CFSPrePunchPattern = z.object({
  firstPosition_mm: z.number().nonnegative(), // position of first hole from member start
  spacing_mm:       z.number().positive(),    // center-to-center spacing
  length_mm:        z.number().positive(),    // hole length along member axis
  width_mm:         z.number().positive(),    // hole width across the web
}).strict();
export type CFSPrePunchPattern = z.infer<typeof CFSPrePunchPattern>;

export const CFSSection = z.object({
  id:                CFSSectionId,
  designation:       z.string().min(1),       // e.g. '362S162-54'
  shape:             CFSProfileShape,
  properties:        CFSSectionProperties,
  material:          CFSMaterial,
  linearMass_kgPerM: z.number().positive(),

  // Mill pre-punch pattern. Optional — sections without factory pre-punches
  // (e.g., tracks, custom non-stock sections) leave this absent. The §5.4
  // validator treats absence as "no pre-punches" and skips the mill-spacing check.
  prePunchPattern:   CFSPrePunchPattern.optional(),

  // Optional structural properties bag — populated for slice 12, ignored in v1.
  structuralProperties: z.object({ /* ... */ }).strict().optional(),
}).strict();
```

**Reason:** §5.4's algorithm references `section.prePunchPattern` for rule R3
(spacing against mill holes). The §5 open items flagged this as a missing schema
field. Adding it as `optional` keeps every existing test fixture valid — sections
that don't ship the field behave as if they have no pre-punches — while letting
the SSMA `ssma.json` populated in build slice 2 carry the standard
`38 × 102 mm at 610 mm o.c. starting at 305 mm` pattern.

**Downstream effects:**
- `packages/cfs/src/data/ssma.json` (build slice 2) populates `prePunchPattern`
  for every shipped stud section. Track sections leave it absent.
- §5.4's algorithm pseudo-code can drop the open-item caveat.

---

## R-04 — §1.5 reference §5.4 for placeholder thresholds

**File:** Section 1 of `docs/PROJECT_SPEC.md`, §1.5 "Service holes, AISI placement
rules…", the bullet list of "other placement rules".

**Current text (last paragraph of the bullet list):**

> **Important: the precise clause numbers and numeric thresholds in the Slice 6
> implementation must be cited against the current edition of the relevant AISI
> standard, not paraphrased from this primer.** This document gives the framing
> for understanding; the build slice does the citation work.

**Replacement text:**

> **Important: the precise clause numbers and numeric thresholds in the Slice 6
> implementation must be cited against the current edition of the relevant AISI
> standard, not paraphrased from this primer.** This document gives the framing
> for understanding. The validator's *shape* (the four-rule structure: end
> distance, hole-width fraction, inter-hole spacing, stiffener threshold) is
> fixed in §5.4 and is final for v1. The validator's *numeric thresholds* are
> v1 placeholders pending build-slice-6 confirmation against the current AISI
> S100 / S220 / S240 editions, after which the `reasons` strings emitted by the
> validator will quote exact clauses rather than paraphrases.

**Reason:** Makes the relationship between §1.5 (framing/intent) and §5.4
(implementation contract) explicit, so a reader of §1.5 understands the
"placeholder" status without having to cross-reference §5.4. Closes the slice-A
appendix open item on AISI clause numbers in spirit while leaving the build-slice-6
work as the operational resolution.

---

## R-05 — §3.6 cross-reference for header expansion

**File:** Section 3 of `docs/section-3-data-model.md`, §3.6 "CFSOpening", after the
`CFSOpening` schema block.

**Current text:** None — there is no note here about how built-up headers expand
in the BOM.

**Insertion (after the schema block, before the example value):**

> **A note on built-up headers and the BOM.** A `CFSOpening` carries a single
> `headerTypeOverride` (or inherits the framing default), and §5.1 emits a single
> `header` member to represent it geometrically. The multi-piece nature of box,
> back-to-back, and L-headers is expanded at BOM-export time via the mapping
> table in §6.1 ("Built-up header expansion"). v1 deliberately does not model
> sub-pieces as separate scene nodes — the engineering analysis of slice 12 will
> revisit whether sub-pieces become first-class via a `headerComponents` field
> on `CFSOpening` or remain a BOM-only concept. Either path is forward-compatible
> with the v1 schema.

**Reason:** Three different sections (§3.6, §5.1, §6.1) currently each describe
part of the built-up-header story, but no single section connects them. Adding
this note in §3.6 — the schema where the header reference lives — gives a reader
landing in §3.6 a pointer forward to §6.1 without committing v1 to a schema
change. Preserves the option for v2's `headerComponents` field while making the
v1 design choice explicit.

---

## R-06 — Top-of-PROJECT_SPEC.md preamble update

**File:** `docs/PROJECT_SPEC.md` top matter (the prose above section 0).

**Current text:**

> AACSteel-Designer — architecture and build contract.
> Read this file at the start of every build session. It is the single source of truth.
> This document is built in slices. Sections 0, 1, and 2 below are the output of Spec Slice A — Foundation.

**Replacement text:**

> AACSteel-Designer — architecture and build contract.
> Read this file at the start of every build session. It is the single source of truth.
> This document was built in seven spec slices (A through G). All seven are now
> complete; the document is at version `spec-v1.0` and is ready for build slice 1.
> Subsequent edits are appended to the changelog in the appendix (A.7) and to the
> appropriate section, never reverting the slice-G sweep silently. The
> "Open items raised by spec slice X" sections at the bottom of each section are
> historical — every item has been addressed in the appendix.

**Reason:** The top matter currently describes the document mid-build ("Sections
0, 1, and 2 below are the output of Spec Slice A"). Slice G is the close-out, so
the preamble updates to reflect that the document is whole. The reference to the
changelog in the appendix gives future editors a clear protocol.

---

## R-07 — §4.6 closing note on the appendix item

**File:** Section 4 of `docs/section-4-state-management.md`, §4.6, last
subsection "What 'appendix item 2 resolved' means".

**Current text:**

> ### What "appendix item 2 resolved" means
>
> This subsection is the resolution. Spec slice G should remove the open question
> from the appendix and replace it with a one-line note pointing here.

**Replacement text:**

> ### What "appendix item 2 resolved" means
>
> This subsection is the resolution. The corresponding entry in the appendix
> (A.3 — Resolved open items) is a one-line note pointing here.

**Reason:** Slice G has now done what the section asked for. The wording shifts
from imperative-future to descriptive-present.

---

## R-08 — §4.9 closing note on FAQ deletion

**File:** Section 4 of `docs/section-4-state-management.md`, §4.9, last
subsection "Cross-reference".

**Current text:**

> Once this section is in place, **Execution Plan FAQ 4.6 ("Undo/redo stops working
> after adding CFS features") should be deleted.** Replace it with a one-line
> pointer to §4.9 in spec slice G's cleanup pass. The information FAQ 4.6 conveyed —
> "scene data goes through `useScene`, editor state goes elsewhere" — is now
> codified here as Invariants 1 and 2.

**Replacement text:**

> ### Cross-reference
>
> The information formerly in Execution Plan FAQ 4.6 ("Undo/redo stops working
> after adding CFS features") is codified here as Invariants 1 and 2. The
> Execution Plan is a separate document that ships alongside this spec; if a
> future revision of the Execution Plan is produced, FAQ 4.6 there can be reduced
> to a one-line pointer to §4.9. As of slice G, the spec does not block on the
> Execution Plan being edited.

**Reason:** The original wording assumed slice G would coordinate an edit to the
Execution Plan PDF. That document is outside the spec's scope to modify. The
revision keeps the cross-reference informative without committing to an edit
this project can't unilaterally make.

---

## R-09 — §5.1 worked coalescing note simplification

**File:** Section 5 of `docs/section-5-systems.md`, §5.1 step 7, the "Worked
coalescing — opening at wall edge" paragraph.

**Current text (last sentence):**

> The §1.4 wording is reconciled in spec slice G; this section commits to
> chord-wins and surfaces the role conflict on the framing's cached aggregates
> so the inspector can flag "this chord also serves as a king" for the user's
> awareness.

**Replacement text:**

> §1.4 has been reconciled (per slice G, R-01) to match this contract: chord-wins
> with a cached-aggregate annotation that the inspector surfaces as "this chord
> also serves as a king" for the user's awareness.

**Reason:** §1.4 now matches §5.1 (per R-01); the "is reconciled in spec slice G"
phrasing becomes "has been reconciled per slice G."

---

## R-10 — Section open-items lists, harmonize closing line

**File:** Every section file (sections 0/1/2 in `PROJECT_SPEC.md`, sections 3–7
in their per-section files), the "Open items raised by spec slice X" block at the
bottom of each.

**Current pattern:** Each closes with "to be resolved in spec slice G or in the
relevant build slice" or similar.

**Replacement pattern:** Add a single sentence at the very top of each
"Open items" block (immediately after the heading):

> *Historical record. Every item below has been resolved or routed during slice G;
> the current status of each is in the appendix (A.3 for resolved, A.4 for
> deferred-to-build-slice, A.5 for v2 backlog).*

**Reason:** Once slice G is complete, these per-section open-items lists are
historical — they are a record of what each spec author noticed at the time, not
the current state of the spec. The header note prevents a future reader from
mistaking them for active TODOs while preserving the trace of how the document
evolved.

---

## Notes for the committer

- These ten edits can land as a single commit:
  `spec: slice G — cross-section reconciliations`.
- The new appendix file (`docs/section-appendix.md`) is a separate commit:
  `spec: slice G — appendix`. Both commits together make slice G complete.
- After both commits, tag the document: `git tag spec-v1.0 && git push --tags`.
- The merge of all section files into a single `docs/PROJECT_SPEC.md` is a
  separate, mechanical task — concatenation in section order plus the new
  appendix at the end. That merge is not part of slice G's intellectual work.

*End of reconciliations log for spec slice G.*
