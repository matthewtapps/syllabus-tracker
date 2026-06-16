# Video tiers & cross-tier propagation — design

**Date:** 2026-06-16
**Status:** Approved-in-principle (pending written-spec review)
**Related plan:** `docs/superpowers/plans/2026-06-16-student-syllabus-modification-uplift.md` (Chunk E is superseded/expanded by this design; technique chunks C/D are partially affected — see "Unification" below).

## Problem

A coach assigns a syllabus to a student, then customizes heavily in one sitting: hiding/adding techniques and videos. The same content lives at up to three nested tiers, and a coach must be able to act at any tier and propagate up or down — without per-edit friction during high-volume work.

## Tiers (nesting: T1 ⊃ T2 ⊃ T3)

- **T1 Global technique** — the library technique and its videos. Seen by everyone.
- **T2 Syllabus technique** — a syllabus *template*'s copy of a technique (`syllabus_techniques`) and videos attached to it. Inherited by every assignment of that syllabus.
- **T3 Student syllabus technique** — one student's assignment row (`student_syllabus_techniques`, "SST") and videos private to it.

Inheritance is CSS-cascade-like: a lower tier inherits the higher tier's content and visibility unless it has an explicit local override. (Validated against Google/Apple Calendar recurring scope, Facebook audience selector, PatternFly/eBay bulk-action bars, Shopify sticky bulk defaults, and the Unity Editor Design System inheritance/override pattern.)

## Interaction model — "set scope once, edit quietly, reconcile in bulk"

### 1. Sticky scope selector
At the top of the student-syllabus view: `Editing at: [ This student ▾ ]` with **This student** (default) / **This syllabus** / **Global technique**. Remembered for the session. It sets the tier that quiet one-click edits act on.

### 2. Cascade switch(es) (shown only when scope is above the student)
Directly beneath the selector:
- **Scope = This syllabus:** one switch — **"Update other assignments of this syllabus"** (default **ON**).
- **Scope = Global technique:** two switches — **"Also update syllabi"** (default ON) and **"Also update existing assignments"** (default ON). The assignments switch is enabled only when at least one syllabus containing the technique is assigned to a student; the syllabi switch only when the technique is in ≥1 syllabus.

Cascade rules:
- **Override-aware:** a cascade does **not** clobber a tier that has an explicit local override (a deliberate per-student/per-syllabus choice is preserved). Plain inheritance flows; explicit overrides win.
- **Graduated assignments are excluded by default** from any downward cascade.
- For **adds** with a cascade switch OFF, the item is still added at lower tiers but **hidden** (per the coach's earlier spec), rather than absent — so it can be revealed later. For **hides** with the switch OFF, lower tiers are left untouched (reconcile via diff).

### 3. Quiet one-click edits
The existing eye/hide control and the add control act at the selected scope with **no prompt and no modal**. A row shows only the **current context's** state (visible/hidden here) — no always-on cross-tier indicators (explicitly rejected as too busy). Hiding 20 items = 20 single clicks at the chosen tier. Hidden-in-this-context still uses the ghost transition (techniques move to the Hidden tab on reload; videos stay in place — see the implementation plan's D2/E1).

### 4. On-demand cross-context control
Cross-tier status/control is revealed **only when sought** — in the expanded row, a "Visibility across tiers / Where does this live?" control that, when opened, shows the three tiers and lets the coach override or propagate a single item individually. Never shown inline by default.

### 5. Add = scope-ladder popover
The add action opens a small popover (Calendar-recurring style) with the per-tier switches pre-checked from the current scope; lower tiers can be set to land visible or hidden. Deliberate and lower-frequency, so a popover is acceptable here.

### 6. Diff dialog = batch reconcile
The existing diff-to-global dialog is the bulk surface: customize freely, then review everything that diverges from the global/template baseline and push selected changes up/down in one pass (stage-and-apply), for both techniques and videos.

## Data model

### Videos — three parent tiers
The `videos` table is polymorphic (`parent_kind` typed-column pattern). Today: `technique` (T1), plus `student_profile`/`thread`/`loose`. Add:
- **T3:** `parent_kind = 'student_syllabus_technique'`, new column `student_syllabus_technique_id` → `student_syllabus_techniques(id)`.
- **T2:** `parent_kind = 'syllabus_technique'`. **Anchor decision required:** `syllabus_techniques` has a composite PK `(syllabus_id, technique_id)` and no surrogate id. The typed-column pattern wants a single id column. **Recommended:** add a surrogate `id INTEGER PRIMARY KEY` to `syllabus_techniques` (keep the existing pair as a UNIQUE constraint) and reference it from `videos.syllabus_technique_id`. (Alternative — two parent columns for this kind — breaks the one-column-per-kind invariant and is not recommended.)

The per-(student, syllabus, technique) video read unions: T1 technique videos (respecting `student_syllabus_video_visibility` overrides) + T2 syllabus-technique videos (for that syllabus) + T3 SST videos (for that assignment).

### Visibility overrides
Per-tier hide uses override rows. `student_syllabus_video_visibility(student_id, syllabus_id, video_id, visible)` already exists for T3. A T2 hide is represented on the syllabus-technique / via `videos.hidden_at` at the appropriate parent. Exact override tables for T2 hides to be finalized in the plan; the principle is one explicit override row per (tier, item) so cascades stay override-aware.

### Techniques — unification
Techniques have the same three tiers (`techniques` T1 / `syllabus_techniques` T2 / `student_syllabus_techniques` T3) and already have a global↔student scope flag (`is_global`, shipped in Chunk A). The scope selector + cascade switches govern **techniques and videos uniformly**.

## Unification with the in-flight plan
- **Supersedes** the standalone "Add to global library too" switch in technique task C3: technique adds flow through the scope selector + scope-ladder popover instead. The student-only create path (Chunk A backend) stays; only the front-end control changes.
- **Informs** technique hide (D1/D2): hiding respects the current scope and the cascade switches.
- **Expands** Chunk E from a 2-tier (T1/T3) video model to the full 3-tier model with the propagation mechanism above.
- Chunks A (done) and B (frontend plumbing) are unaffected.

## Out of scope (YAGNI for now)
- No bulk multi-select checkboxes on rows (the sticky scope + quiet clicks + diff already cover bulk).
- No per-edit toast control flow (rejected).
- No undo stack beyond existing toasts.

## Open items to resolve during planning
1. Surrogate id on `syllabus_techniques` (recommended) vs alternative anchoring.
2. The exact override-row representation for T2 (syllabus-template) video/technique hides.
3. Whether the scope selector also appears on the syllabus-template editing view (likely yes, defaulting to "This syllabus").
