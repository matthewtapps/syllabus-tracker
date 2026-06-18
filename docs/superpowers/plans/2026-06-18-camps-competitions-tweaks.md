# Camps & Competitions Tweaks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tie camps and competitions together (auto-create a competition camp on registration, promote-or-create at register time), fix the match-dialog crash, simplify the match button, correct the promote social tile, polish the selection UIs, and ship an MVP "pull prior work into a camp" panel.

**Architecture:** Rust + Rocket + SQLite (sqlx, offline build is the gate) backend; React 19 + Vite + shadcn/ui + TanStack Query frontend. No DB migration — all columns already exist. Registration and its camp side-effect run in one transaction. Feed tiles are pure projections of `resolveFeedItem`.

**Tech Stack:** Rust/Rocket/sqlx, React/TypeScript, TanStack Query, RHF+Zod, Radix/shadcn, Vitest (browser tests in CI/Chromium).

**Conventions:**
- Commits: small, atomic, imperative, scoped, **no `Co-Authored-By` trailer**. Push after each.
- Backend verify: `nix develop .#ci --command just test`. Regenerate sqlx after query changes: `nix develop .#ci --command just sqlx-prepare` (never bare `cargo sqlx prepare`).
- Pre-PR: `just verify`.
- No em-dashes in user-facing copy. Matches are user-facing "matches"; never "moments".

---

## File structure

| File | Responsibility | Slice |
|------|----------------|-------|
| `frontend/src/app/camps/[id]/page.tsx` | Match dialog crash fix + "+ match" relabel; mount pull panel | 1, 5 |
| `frontend/src/app/camps/[id]/match-dialog.test.tsx` (new) | Browser test: dialog opens without crashing, method "None" → null | 1 |
| `crates/syllabus-tracker/src/db/competitions.rs` | `CampChoice` enum, `ensure_competition_camp`, `register_student` gains choice | 2 |
| `crates/syllabus-tracker/src/competitions/routes.rs` | Register routes accept camp choice | 2 |
| `crates/syllabus-tracker/src/test/competitions.rs` | Backend tests for the camp side-effect | 2 |
| `crates/syllabus-tracker/src/bin/seed.rs` | Pass `CampChoice::None` to keep seed deterministic | 2 |
| `frontend/src/lib/api.ts` | `registerStudent` carries camp choice | 2 |
| `frontend/src/lib/mutations.ts` | `useRegisterStudent`/`useRegisterSelf` invalidate camps | 2 |
| `frontend/src/app/competitions/[id]/page.tsx` | `RegisterStudentDialog` camp-choice + polish | 2, 4 |
| `frontend/src/components/camps/camp-choice-list.tsx` (new) | Shared promote-or-create camp picker | 2, 4 |
| `frontend/src/lib/feed-item.ts` | Promote row emits a camp crumb | 3 |
| `frontend/src/components/activity-feed/activity-tile-header.tsx` | Trophy CrumbIcon for competition | 3 |
| `frontend/src/lib/view-context.unit.test.ts` | Promote-row crumb assertions | 3 |
| `frontend/src/components/camps/pull-from-previous.tsx` (new) | MVP cross-camp pull panel | 5 |

---

## Slice 1 — Match dialog crash + "+ match" relabel

### Task 1: Fix the Radix empty-value crash and relabel the button

**Files:**
- Modify: `frontend/src/app/camps/[id]/page.tsx` (`logMatchSchema` ~641, `LogMatchDialog` ~649, `MatchesSection` ~1253)
- Test: `frontend/src/app/camps/[id]/match-dialog.test.tsx` (new)

- [ ] **Step 1: Write the failing browser test**

Create `frontend/src/app/camps/[id]/match-dialog.test.tsx`. Stub `window.fetch` (per the project's vitest-browser convention — do NOT `vi.spyOn` ESM). Render the camp detail page for a competition-linked camp with a registration, click the match button, assert the dialog title "Add match" is visible and no error boundary ("Session lost") rendered. Use `renderWithProviders` + `buildUser` helpers.

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, buildUser } from "@/test/utils"; // match existing helper import paths
import CampDetailPage from "./page";

// Stub fetch: camp detail (competition-linked, registration_id set), matches list, etc.
// Follow the stubbing pattern in camp-detail.test.tsx.

describe("match dialog", () => {
  beforeEach(() => {
    // window.fetch stub returning a competition-linked camp with registration_id
  });

  it("opens the add-match dialog without crashing", async () => {
    renderWithProviders(<CampDetailPage />, { user: buildUser({ roles: ["coach"] }) });
    await screen.findByText(/matches/i);
    await userEvent.click(screen.getByRole("button", { name: /match/i }));
    expect(await screen.findByText("Add match")).toBeInTheDocument();
    expect(screen.queryByText("Session lost")).not.toBeInTheDocument();
  });
});
```

(The implementing agent must mirror the exact stubbing + helper imports used in the
sibling `frontend/src/app/camps/[id]/camp-detail.test.tsx`; if that test does not
expose a reusable harness, copy its `window.fetch` stub inline.)

- [ ] **Step 2: Run it, expect failure**

Run (CI/Chromium only — note this box is NixOS and cannot run `.test.tsx`): `cd frontend && npx vitest run src/app/camps/[id]/match-dialog.test.tsx`
Expected on a Chromium-capable host: FAIL — clicking the button throws the Radix empty-value error and the "Session lost" panel appears (or the dialog title is absent). On this box the run is skipped; rely on CI.

- [ ] **Step 3: Fix the schema (drop the empty-string enum member)**

In `logMatchSchema` replace the method enum so it no longer contains `""`:

```ts
const logMatchSchema = z.object({
  result: z.enum(["win", "loss", "draw"]),
  method: z.enum(["none", "submission", "points", "decision", "dq", "other"]).optional(),
  method_detail: z.string().max(200).optional(),
  occurred_at: z.string().optional(),
});
```

- [ ] **Step 4: Fix the dialog (sentinel + relabel)**

In `LogMatchDialog`:
- defaultValues + reset: `method: "none"`.
- On submit map the sentinel to null: `method: (values.method && values.method !== "none" ? values.method : null) as MatchMethod | null`.
- Replace `<SelectItem value="">None</SelectItem>` with `<SelectItem value="none">None</SelectItem>`.
- Change `<DialogTitle>Log match</DialogTitle>` → `<DialogTitle>Add match</DialogTitle>`.
- Change submit button text `{logMatch.isPending ? "Logging..." : "Log match"}` → `{logMatch.isPending ? "Adding..." : "Add"}`.
- Keep `toast.success("Match logged.")` (or change to "Match added."). Use "Match added." for consistency.

- [ ] **Step 5: Relabel the trigger button in `MatchesSection`**

Replace the trigger button content:

```tsx
<Button
  size="sm"
  variant="outline"
  className="h-7 gap-1.5 text-xs"
  onClick={() => setLogOpen(true)}
>
  <Plus className="h-3.5 w-3.5" />
  match
</Button>
```

- [ ] **Step 6: Run the test, expect pass (CI), and typecheck locally**

Run locally: `cd frontend && npx tsc -b --noEmit` (or the project's typecheck script) — expect no errors.
Run on CI host: the new test passes.

- [ ] **Step 7: Commit & push**

```bash
git add frontend/src/app/camps/[id]/page.tsx frontend/src/app/camps/[id]/match-dialog.test.tsx
git commit -m "fix(camps): Stop the add-match dialog crashing on the empty method option"
git push
```

---

## Slice 2 — Registration creates/links a competition camp

### Task 2: Backend `CampChoice` + `ensure_competition_camp`

**Files:**
- Modify: `crates/syllabus-tracker/src/db/competitions.rs`
- Test: `crates/syllabus-tracker/src/test/competitions.rs`

- [ ] **Step 1: Write failing backend tests**

In `src/test/competitions.rs` add tests (mirror existing test setup helpers in that file for creating a coach, a student, a competition):

```rust
#[sqlx::test]
async fn register_create_new_makes_named_camp(pool: SqlitePool) {
    // arrange: coach + student + competition "Worlds 2026"
    // act: register_student(&pool, comp_id, student_id, coach_id, CampChoice::CreateNew)
    // assert: exactly one camp for (student, comp) named "Worlds 2026 Camp", competition_id set
}

#[sqlx::test]
async fn register_existing_promotes_unlinked_camp(pool: SqlitePool) {
    // arrange: student has a generic camp "Old Camp" (competition_id NULL)
    // act: register_student(..., CampChoice::Existing(old_camp_id))
    // assert: old camp now has competition_id == comp_id; no extra camp created
}

#[sqlx::test]
async fn re_register_does_not_duplicate_camp(pool: SqlitePool) {
    // act: register CreateNew twice
    // assert: still exactly one camp for (student, comp)
}

#[sqlx::test]
async fn register_none_creates_no_camp(pool: SqlitePool) {
    // act: register_student(..., CampChoice::None)
    // assert: zero camps for (student, comp)
}
```

- [ ] **Step 2: Run, expect failure (CampChoice undefined)**

Run: `nix develop .#ci --command cargo test -p syllabus-tracker competitions::register_ -- --nocapture`
Expected: compile error — `CampChoice` not found.

- [ ] **Step 3: Add `CampChoice` + `ensure_competition_camp`**

In `db/competitions.rs` add:

```rust
/// What to do about the student's competition camp when they register.
#[derive(Debug, Clone, Copy)]
pub enum CampChoice {
    /// Do not touch camps (seed/back-compat).
    None,
    /// Create a fresh camp named "<competition> Camp".
    CreateNew,
    /// Promote an existing unlinked camp belonging to the student.
    Existing(i64),
}

/// Ensure the student has a camp linked to this competition, honoring `choice`.
/// Idempotent: if any camp already links (student, competition), does nothing.
/// Runs inside the caller's transaction.
async fn ensure_competition_camp(
    tx: &mut sqlx::SqliteConnection,
    student_id: i64,
    competition_id: i64,
    actor_id: i64,
    choice: CampChoice,
) -> Result<(), AppError> {
    if matches!(choice, CampChoice::None) {
        return Ok(());
    }
    // Already linked? no-op.
    let existing = sqlx::query_scalar!(
        r#"SELECT id AS "id!: i64" FROM camps
           WHERE student_id = ? AND competition_id = ? LIMIT 1"#,
        student_id, competition_id,
    )
    .fetch_optional(&mut *tx)
    .await?;
    if existing.is_some() {
        return Ok(());
    }

    match choice {
        CampChoice::None => {}
        CampChoice::Existing(camp_id) => {
            // Camp must belong to the student and be unlinked.
            let row = sqlx::query!(
                r#"SELECT student_id AS "student_id!: i64",
                          competition_id AS "competition_id?: i64"
                   FROM camps WHERE id = ?"#,
                camp_id,
            )
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::NotFound("camp not found".into()))?;
            if row.student_id != student_id {
                return Err(AppError::Validation("camp belongs to another student".into()));
            }
            if row.competition_id.is_some() {
                return Err(AppError::Validation("camp already linked to a competition".into()));
            }
            sqlx::query!(
                "UPDATE camps SET competition_id = ? WHERE id = ?",
                competition_id, camp_id,
            )
            .execute(&mut *tx)
            .await?;
            emit(
                tx,
                NewActivity::new(Verb::CampPromotedToCompetition, actor_id)
                    .target_student(student_id)
                    .camp(camp_id)
                    .competition(competition_id)
                    .context_kind("competition"),
            )
            .await?;
        }
        CampChoice::CreateNew => {
            // Camp coach = the competition's creator (always a coach).
            let comp = sqlx::query!(
                r#"SELECT name, created_by_id AS "created_by_id!: i64"
                   FROM competitions WHERE id = ?"#,
                competition_id,
            )
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::NotFound("competition not found".into()))?;
            let camp_name = format!("{} Camp", comp.name);
            let camp_id = sqlx::query_scalar!(
                r#"INSERT INTO camps (student_id, coach_id, name, competition_id)
                   VALUES (?, ?, ?, ?) RETURNING id AS "id!: i64""#,
                student_id, comp.created_by_id, camp_name, competition_id,
            )
            .fetch_one(&mut *tx)
            .await?;
            emit(
                tx,
                NewActivity::new(Verb::CampCreated, actor_id)
                    .target_student(student_id)
                    .camp(camp_id)
                    .context_kind("camp"),
            )
            .await?;
        }
    }
    Ok(())
}
```

- [ ] **Step 4: Thread `choice` through `register_student`**

Change the signature to `register_student(pool, competition_id, student_id, registered_by_id, choice: CampChoice)`. After the existing `StudentRegistered` emit and before `tx.commit()`, call:

```rust
ensure_competition_camp(&mut tx, student_id, competition_id, registered_by_id, choice).await?;
```

- [ ] **Step 5: Fix all callers to compile**

Update callers: `competitions/routes.rs` (two register routes — Task 3 sets the real choice; for now pass `CampChoice::CreateNew`), `src/bin/seed.rs` (pass `CampChoice::None`), and any existing tests in `src/test/competitions.rs` that call `register_student` (pass `CampChoice::None` unless they assert the new behavior). Grep: `rg "register_student\(" crates`.

- [ ] **Step 6: Regenerate sqlx + run tests**

Run: `nix develop .#ci --command just sqlx-prepare`
Then: `nix develop .#ci --command cargo test -p syllabus-tracker competitions:: -- --nocapture`
Expected: PASS.

- [ ] **Step 7: Commit & push**

```bash
git add crates/syllabus-tracker/src/db/competitions.rs crates/syllabus-tracker/src/test/competitions.rs crates/syllabus-tracker/src/bin/seed.rs crates/syllabus-tracker/.sqlx
git commit -m "feat(competitions): Ensure a competition camp when a student registers"
git push
```

### Task 3: Register routes accept a camp choice

**Files:**
- Modify: `crates/syllabus-tracker/src/competitions/routes.rs`
- Test: `crates/syllabus-tracker/src/test/competitions.rs`

- [ ] **Step 1: Write failing route tests**

Add tests posting to the coach register route with bodies `{"camp":"create_new"}` and `{"camp":{"existing":<id>}}` and asserting camp state. Mirror existing route-test client setup in the file.

- [ ] **Step 2: Run, expect failure**

Run: `nix develop .#ci --command cargo test -p syllabus-tracker competitions::route -- --nocapture`
Expected: FAIL (route ignores body).

- [ ] **Step 3: Add request type + map to `CampChoice`**

```rust
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CampChoiceRequest {
    CreateNew,
    Existing { existing: i64 },
}

#[derive(Deserialize, Default)]
pub struct RegisterStudentBody {
    pub camp: Option<CampChoiceRequest>,
}

fn to_choice(body: Option<CampChoiceRequest>) -> CampChoice {
    match body {
        Some(CampChoiceRequest::Existing { existing }) => CampChoice::Existing(existing),
        _ => CampChoice::CreateNew, // explicit create_new or absent
    }
}
```

Note: `#[serde(rename_all="snake_case")]` on an untagged-ish enum needs care. Implement so that JSON `"create_new"` (string) and `{"existing": 5}` (object) both deserialize. If a single enum cannot express both shapes cleanly, model `camp` as `Option<serde_json::Value>` and parse manually, or use `#[serde(untagged)]`:

```rust
#[derive(Deserialize)]
#[serde(untagged)]
pub enum CampChoiceRequest {
    Tag(String),                 // "create_new"
    Existing { existing: i64 },  // {"existing": 5}
}
```

- [ ] **Step 4: Wire the coach route to read the body**

Change `api_coach_register_student` to accept `body: Option<Json<RegisterStudentBody>>` (so an empty body still works) and pass `to_choice(...)` to `register_student`. Keep `api_self_register_competition` passing `CampChoice::CreateNew`.

- [ ] **Step 5: Regenerate sqlx (if queries changed) + run tests**

Run: `nix develop .#ci --command cargo test -p syllabus-tracker competitions:: -- --nocapture`
Expected: PASS.

- [ ] **Step 6: Commit & push**

```bash
git add crates/syllabus-tracker/src/competitions/routes.rs crates/syllabus-tracker/src/test/competitions.rs
git commit -m "feat(competitions): Register route promotes or creates the chosen camp"
git push
```

### Task 4: Frontend register mutation carries the camp choice

**Files:**
- Modify: `frontend/src/lib/api.ts` (`registerStudent` ~2307), `frontend/src/lib/mutations.ts` (`useRegisterStudent` ~1577, `useRegisterSelf` ~1567)

- [ ] **Step 1: Update `registerStudent` in api.ts**

```ts
export type CampChoiceArg =
  | { kind: "create_new" }
  | { kind: "existing"; campId: number };

export async function registerStudent(
  competitionId: number,
  studentId: number,
  choice: CampChoiceArg = { kind: "create_new" },
): Promise<{ id: number }> {
  const body =
    choice.kind === "existing"
      ? { camp: { existing: choice.campId } }
      : { camp: "create_new" };
  const res = await fetch(`/api/competitions/${competitionId}/register/${studentId}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw res;
  return (await res.json()) as { id: number };
}
```

- [ ] **Step 2: Update mutations to pass choice + invalidate camps**

`useRegisterStudent` mutationFn takes `{ studentId, choice }`; onSuccess invalidates `qk.competition(competitionId)`, `qk.campsForStudent(studentId)`, and `qk.camp` is not needed. `useRegisterSelf` onSuccess additionally invalidates `qk.campsForStudent(viewerId)` — pass the viewer id into the hook or invalidate the broad `["camps"]` key.

```ts
export function useRegisterStudent(competitionId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { studentId: number; choice?: CampChoiceArg }) =>
      registerStudent(competitionId, vars.studentId, vars.choice),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: qk.competition(competitionId) });
      qc.invalidateQueries({ queryKey: qk.campsForStudent(vars.studentId) });
    },
  });
}
```

For `useRegisterSelf`, invalidate `{ queryKey: ["camps"] }` (broad) in onSuccess so the self-registering student's camp list refreshes.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit` — expect no errors (the dialog using `useRegisterStudent` is updated in Task 5; until then a temporary `{ studentId }` call still typechecks because `choice` is optional).

- [ ] **Step 4: Commit & push**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/mutations.ts
git commit -m "feat(competitions): Carry the camp choice through the register mutation"
git push
```

### Task 5: Shared `CampChoiceList` + register dialog camp step (also Slice 4 polish)

**Files:**
- Create: `frontend/src/components/camps/camp-choice-list.tsx`
- Modify: `frontend/src/app/competitions/[id]/page.tsx` (`RegisterStudentDialog` ~220)

- [ ] **Step 1: Create `CampChoiceList`**

A controlled list of selectable cards (reuse the `ScopeOption` card visual from camps/[id]/page.tsx): one "Create a new camp" card (default) plus one card per unlinked active camp. Props:

```tsx
import { cn } from "@/lib/utils";
import type { CampSummary } from "@/lib/api";

export type CampChoiceValue =
  | { kind: "create_new" }
  | { kind: "existing"; campId: number };

export function CampChoiceList({
  camps,
  value,
  onChange,
}: {
  camps: CampSummary[];
  value: CampChoiceValue;
  onChange: (v: CampChoiceValue) => void;
}) {
  const unlinked = camps.filter((c) => c.competition_id == null && !c.archived_at);
  return (
    <div role="radiogroup" aria-label="Camp for this competition" className="space-y-2">
      <ChoiceCard
        selected={value.kind === "create_new"}
        onSelect={() => onChange({ kind: "create_new" })}
        label="Create a new camp"
        description="A fresh camp named after this competition. You can rename it later."
      />
      {unlinked.map((c) => (
        <ChoiceCard
          key={c.id}
          selected={value.kind === "existing" && value.campId === c.id}
          onSelect={() => onChange({ kind: "existing", campId: c.id })}
          label={`Promote: ${c.name}`}
          description="Link this existing camp to the competition."
        />
      ))}
    </div>
  );
}

function ChoiceCard({ selected, onSelect, label, description }: {
  selected: boolean; onSelect: () => void; label: string; description: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "w-full rounded-lg border p-3 text-left transition-colors",
        selected ? "border-primary bg-primary/5 ring-1 ring-primary"
                 : "border-border bg-card hover:bg-muted/40",
      )}
    >
      <p className="text-sm font-medium leading-tight">{label}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
    </button>
  );
}
```

- [ ] **Step 2: Rework `RegisterStudentDialog` (polish + camp step)**

- Replace the bespoke `<ul><button>` student list with a searchable `Command` combobox (shadcn `Command`/`CommandInput`/`CommandItem`) for picking the student, matching the project's component vocabulary. Keep the "All students already registered" empty state.
- After a student is selected, fetch that student's camps with `useCampsForStudent(selectedId)` and render `<CampChoiceList camps={camps} value={campChoice} onChange={setCampChoice} />`. Default `campChoice = { kind: "create_new" }`.
- Submit passes `{ studentId: selectedId, choice: campChoice }` to `useRegisterStudent`.
- Standard dialog footer (`DialogFooter` with Cancel + Register).

- [ ] **Step 3: Typecheck + (CI) component test**

Run: `cd frontend && npx tsc -b --noEmit` — expect no errors. If `competition-detail.test.tsx` asserts the old list markup, update it to the new combobox + camp-choice flow.

- [ ] **Step 4: Commit & push**

```bash
git add frontend/src/components/camps/camp-choice-list.tsx frontend/src/app/competitions/[id]/page.tsx frontend/src/app/competitions/[id]/competition-detail.test.tsx
git commit -m "feat(competitions): Pick promote-or-create camp when registering, polish the dialog"
git push
```

---

## Slice 3 — Promote-camp social tile links the camp

### Task 6: Promote row emits a camp crumb + trophy icon

**Files:**
- Modify: `frontend/src/lib/feed-item.ts` (`buildPath` ~150), `frontend/src/components/activity-feed/activity-tile-header.tsx` (`CrumbIcon` ~14)
- Test: `frontend/src/lib/view-context.unit.test.ts`

- [ ] **Step 1: Write failing unit test**

In `view-context.unit.test.ts`, add a case: a `camp_promoted_to_competition` row with `camp_id`, `camp_name`, `competition_id`, `competition_name`, `context_kind="competition"`. Assert `resolveFeedItem(row).path` contains a crumb with `surfaceKind === "camp"`, `label === camp_name`, and `href === "/camps/<id>"`. (If `resolveFeedItem` is better tested in `feed-item`'s own test file, add it there instead; check which test file imports `resolveFeedItem`.)

- [ ] **Step 2: Run, expect failure or pass**

Run: `cd frontend && npx vitest run src/lib/view-context.unit.test.ts`
Expected: This box CAN run `.unit.test.ts` (Node, not browser). If it already passes, the routing is correct and only the icon (Step 4) is the gap — keep the test as a guard. If it fails, proceed.

- [ ] **Step 3: Ensure `buildPath` keeps the camp crumb for the promote verb**

`activitySurface` already returns `{ kind: "camp", label: camp_name }` for `camp_promoted_to_competition` (because `rowToViewContext` returns a camp context when `camp_id` is set). Confirm `buildPath` pushes that crumb with `viewContextSurfaceHref` (=`/camps/<id>`). No change needed if the test passes; if `camp_name` is missing, fall back to the competition-derived label is NOT wanted — keep camp. Add an explicit comment documenting that the promote tile intentionally surfaces the camp.

- [ ] **Step 4: Add the trophy icon for competition crumbs**

In `activity-tile-header.tsx` import `Trophy` from lucide-react and extend `CrumbIcon`:

```tsx
import { ChevronRight, Dumbbell, Library, NotebookPen, Trophy } from "lucide-react";

function CrumbIcon({ kind }: { kind: Crumb["surfaceKind"] }) {
  if (kind === "syllabus") return <NotebookPen className="h-3 w-3 shrink-0" aria-hidden />;
  if (kind === "camp") return <Dumbbell className="h-3 w-3 shrink-0" aria-hidden />;
  if (kind === "competition" || kind === "match") return <Trophy className="h-3 w-3 shrink-0" aria-hidden />;
  if (kind) return <Library className="h-3 w-3 shrink-0" aria-hidden />;
  return null;
}
```

- [ ] **Step 5: Run unit tests + typecheck**

Run: `cd frontend && npx vitest run src/lib/view-context.unit.test.ts && npx tsc -b --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit & push**

```bash
git add frontend/src/lib/feed-item.ts frontend/src/components/activity-feed/activity-tile-header.tsx frontend/src/lib/view-context.unit.test.ts
git commit -m "fix(feed): Link the promote-camp tile to the camp, trophy-icon competitions"
git push
```

---

## Slice 5 — Pull prior work into a camp (MVP)

### Task 7: `PullFromPrevious` panel

**Files:**
- Create: `frontend/src/components/camps/pull-from-previous.tsx`
- Modify: `frontend/src/app/camps/[id]/page.tsx` (mount the panel, coach-only)

No backend change: uses `useCampsForStudent(studentId)` (list, with `technique_count`/`video_count`) and `useCamp(otherCampId)` (techniques) and `useAddCampTechnique(currentCampId)`.

- [ ] **Step 1: Create the panel component**

A coach-only dialog (trigger button "Pull from previous work" in the camp's Techniques section header area). Behavior:
- List the student's *other* camps (exclude the current camp id), newest first; default-expand the one matching the current camp's `references_camp_id` if set.
- Each camp row expands to show its techniques (from `useCamp(otherCampId).data.techniques`) with a per-technique "Add to this camp" button that calls `useAddCampTechnique(currentCampId).mutateAsync(technique_id)` (idempotent). Show video count + a "View camp" deep link (`/camps/<id>`).
- Scoped techniques (not resolvable into another camp) still link via add (the backend `add_camp_technique` accepts any technique id; scoped techniques belong to their owning camp and should be shown read-only with a deep link rather than an Add button — detect via absence is not possible from the summary, so: show Add for all techniques the API returns for that camp; the backend will link the row. Keep it simple: Add links the technique into the current camp).

```tsx
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ExternalLink, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { useCampsForStudent, useCamp } from "@/lib/queries";
import { useAddCampTechnique } from "@/lib/mutations";

export function PullFromPrevious({
  currentCampId, studentId, referencesCampId,
}: { currentCampId: number; studentId: number; referencesCampId: number | null }) {
  const [open, setOpen] = useState(false);
  const campsQuery = useCampsForStudent(studentId);
  const others = useMemo(
    () => (campsQuery.data ?? []).filter((c) => c.id !== currentCampId),
    [campsQuery.data, currentCampId],
  );
  const defaultValue = referencesCampId ? `camp-${referencesCampId}` : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs">
          Pull from previous work
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>Pull from previous work</DialogTitle></DialogHeader>
        {others.length === 0 ? (
          <p className="text-sm text-muted-foreground">No other camps for this student yet.</p>
        ) : (
          <Accordion type="single" collapsible defaultValue={defaultValue} className="overflow-y-auto">
            {others.map((c) => (
              <AccordionItem key={c.id} value={`camp-${c.id}`}>
                <AccordionTrigger className="text-sm">
                  <span className="flex-1 text-left">{c.name}{c.archived_at ? " (archived)" : ""}</span>
                </AccordionTrigger>
                <AccordionContent>
                  <SourceCampTechniques sourceCampId={c.id} currentCampId={currentCampId} />
                  <Link to={`/camps/${c.id}`} className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <ExternalLink className="h-3 w-3" /> View camp
                  </Link>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SourceCampTechniques({ sourceCampId, currentCampId }: { sourceCampId: number; currentCampId: number }) {
  const campQuery = useCamp(sourceCampId);
  const add = useAddCampTechnique(currentCampId);
  const techs = campQuery.data?.techniques ?? [];
  if (campQuery.isLoading) return <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />;
  if (techs.length === 0) return <p className="text-xs text-muted-foreground">No techniques in this camp.</p>;
  return (
    <ul className="divide-y divide-border rounded border border-border">
      {techs.map((t) => (
        <li key={t.technique_id} className="flex items-center gap-2 px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm">{t.name}</span>
          <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-xs"
            disabled={add.isPending}
            onClick={() => add.mutate(t.technique_id, {
              onSuccess: () => toast.success(`Added ${t.name}`),
              onError: () => toast.error("Failed to add technique"),
            })}>
            <Plus className="h-3 w-3" /> Add
          </Button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Mount it in the camp Techniques section (coach-only)**

In `camps/[id]/page.tsx`, in the Techniques section header (next to "Add techniques", inside the `isCoach` area), render:

```tsx
{isCoach && (
  <PullFromPrevious
    currentCampId={campId}
    studentId={camp.student_id}
    referencesCampId={camp.references_camp_id}
  />
)}
```

Import `PullFromPrevious` and ensure `camp.references_camp_id` is available on `CampDetail` (it is).

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit` — expect no errors.

- [ ] **Step 4: Commit & push**

```bash
git add frontend/src/components/camps/pull-from-previous.tsx frontend/src/app/camps/[id]/page.tsx
git commit -m "feat(camps): Pull techniques from a student's previous camps"
git push
```

---

## Finalization

### Task 8: Verify, PR, deploy to staging

- [ ] **Step 1: Full local verify**

Run: `just verify` (runs lint/test in `nix develop .#ci`). Fix anything red. Backend offline build (SQLX_OFFLINE) must pass.

- [ ] **Step 2: Open the PR**

```bash
git push
gh pr create --base main --head feat/camps-tweaks \
  --title "Camps & competitions tweaks" \
  --body "$(cat <<'EOF'
Ties camps and competitions together and fixes several rough edges.

- Registering a student now ensures a competition camp (promote an existing camp or create "<Competition> Camp"); the register dialog lets the coach choose.
- Fixes the add-match dialog crash (Radix rejected the empty-string method option, which the auth error boundary mislabeled "Session lost"). Match button is now "+ match".
- The promote-camp social tile links the promoted camp (trophy icon for competition crumbs).
- Polished the student/camp selection dialogs.
- MVP "pull from previous work": pull techniques from a student's prior camps into the current one; deep links to prior camps/footage/discussion.

Spec: docs/superpowers/specs/2026-06-18-camps-competitions-tweaks-design.md
Plan: docs/superpowers/plans/2026-06-18-camps-competitions-tweaks.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Wait for CI green**

Use `gh pr checks --watch`. Fix failures.

- [ ] **Step 4: Deploy to staging**

Trigger the manual staging-sibling workflow (`staging.yml`) per the `ci-and-staging-deploy` skill, from this branch's ref. Confirm the run succeeds.

---

## Self-review notes

- **Spec coverage:** Slice 1 → Task 1; Slice 2 → Tasks 2–5; Slice 3 → Task 6; Slice 4 → Task 5 (dialog polish + shared `CampChoiceList`); Slice 5 → Task 7. Finalization → Task 8. All spec slices mapped.
- **Deferrals** (cross-camp video reuse, post-comp feedback automation, thread re-anchoring) are intentionally absent — no tasks, by design.
- **Type consistency:** `CampChoice` (Rust) ↔ `CampChoiceRequest` JSON (`"create_new"` | `{existing}`) ↔ `CampChoiceArg` (TS) ↔ `CampChoiceValue` (TS UI). The wire body is `{ camp: "create_new" }` or `{ camp: { existing: id } }` on both sides.
- **No migration** anywhere, consistent with the spec.
