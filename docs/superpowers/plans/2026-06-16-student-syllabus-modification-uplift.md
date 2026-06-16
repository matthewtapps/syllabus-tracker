# Student Syllabus Modification UX Uplift — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it pleasant for a coach to tailor a student's syllabus — add techniques (existing or brand-new, optionally library-wide), hide techniques into a dedicated tab, see student-only "custom" techniques, and sort the list.

**Architecture:** Introduce a `techniques.is_global` scope flag so a technique can live on one student's syllabus without polluting the global library or other students' pickers. Backend filters the library + unassigned pickers to `is_global = 1`, surfaces `is_global` on the per-syllabus row payload, threads `is_global` through the existing `POST /techniques` create endpoint, and gains a promote-to-library endpoint. Frontend reworks the per-syllabus page into a Main/Custom/Hidden tab layout with a sort dropdown and a ghost transition on hide, and rebuilds the add dialog as a two-tab (Add existing / Create new) flow that **reuses the existing `NewTechniqueDialog`'s create UI** (extracted into a shared `NewTechniqueForm`) plus an "Add to global library too" switch.

**Tech Stack:** Rust + Rocket + SQLx (SQLite, offline/declarative migrator), React 19 + Vite + TanStack Query + shadcn/ui + Tailwind v4, `useFormWithValidation` + TracedForm, Vitest (browser `.test.tsx` run in CI only; pure `.unit.test.ts` run locally).

**Branch:** All commits stack on `feat/syllabus-modification-ux` (the active branch). Do **not** branch off main or the stale `feat/activity-context-aware-naming`.

**PRE-EXISTING WORK ON THIS BRANCH (do not rebuild):** Two commits already landed —
- `POST /techniques` = `api_create_library_technique` (name + optional `description`, returns `CreatedLibraryTechnique` with `id`). Calls `create_technique(db, name, desc, coach_id)` (4-arg, no `is_global` yet).
- `frontend/src/lib/api.ts`: `createLibraryTechnique({name, description})` + `CreatedLibraryTechnique` type.
- `frontend/src/components/new-technique-dialog.tsx` (~396 lines): the global library create UI — duplicate/similar nudges, tag suggest-from-title + create/attach (tags attached client-side post-create via `createTag`/`addTagToTechnique`), `useFormWithValidation` + `<TracedForm id="create_library_technique">`.
- `frontend/src/app/library/page.tsx`: a small top-right **New technique** button rendering `<NewTechniqueDialog existingNames={...}/>`.

The plan below reuses these. It does **not** add a second create endpoint or a parallel form.

---

## Conventions for every task

- **Commit format:** Conventional Commits, scoped, imperative, **no `Co-Authored-By` trailer** (this repo's `atomic-commits` rule overrides the global default). Example: `feat(techniques): add is_global scope flag`.
- **Backend tests run inside the CI shell:** `nix develop .#ci --command cargo nextest run -p syllabus-tracker <filter>`.
- **After any change to a `sqlx::query!` macro, regenerate offline data:** `nix develop .#ci --command just sqlx-prepare` then commit the `.sqlx/` changes. Never run bare `cargo sqlx prepare` against the dev DB.
- **Schema changes:** edit `config/schema.sql` (the declarative migrator's source of truth), then apply locally with `nix develop .#ci --command just migrate`.
- **Frontend local test runner:** `cd frontend && npx vitest run <file>` works for `*.unit.test.ts(x)` (jsdom). `*.test.tsx` need Chromium and only run in CI — prefer extracting logic into pure helpers with `.unit.test.ts` coverage. Browser component tests stub `window.fetch` and use `renderWithProviders` + `buildUser` (see `reference-vitest-browser-fetch-stub`).
- **Full local gate before opening the PR:** `just verify`.

---

## File Structure

**Backend (`crates/syllabus-tracker/`):**
- `config/schema.sql` — add `is_global` column to `techniques` (modify).
- `src/db/techniques.rs` — library query filters `is_global = 1`; `create_technique` gains an `is_global` param; new `set_technique_global` (modify).
- `src/db/student_techniques.rs` — `get_unassigned_techniques` filters `is_global = 1` (modify).
- `src/db/student_syllabus_techniques.rs` — `SstRow` gains `is_global`; `list_for_assignment` SELECTs it (modify).
- `src/api.rs` — existing `CreateLibraryTechniqueRequest` gains `is_global` (default true); new `PATCH /techniques/<id>/global` (promote) handler (modify).
- `src/test/syllabi.rs`, `src/test/api.rs` — new coverage (modify).

**Frontend (`frontend/src/`):**
- `lib/api.ts` — `SstRow.is_global`; extend `createLibraryTechnique` with optional `is_global`; add `promoteTechniqueToGlobal` (modify).
- `lib/mutations.ts` — add `usePromoteTechniqueToGlobal` (modify).
- `components/new-technique-form.tsx` — **new**: the create UI extracted from `new-technique-dialog.tsx`, parameterised by an optional global-switch + an `onCreated(id)` callback so both the library dialog and the student modal reuse it.
- `components/new-technique-dialog.tsx` — refactor to wrap `<NewTechniqueForm>` (modify; no behaviour change for the library).
- `app/library/page.tsx` — title own row + full-width "New technique" button row above the search bar (modify).
- `app/student-syllabi/[syllabusId]/components/add-to-student-dialog.tsx` — tabs, present-filter, hidden-match, Create tab reusing `<NewTechniqueForm>` + global switch (modify).
- `app/student-syllabi/[syllabusId]/page.tsx` — full-width add button row, Main/Custom/Hidden tabs, sort dropdown, ghost state (modify).
- `app/student-syllabi/[syllabusId]/sst-view.ts` — **new** pure helpers (partition by tab, sort, hidden-match) + `sst-view.unit.test.ts`.
- `components/technique-row/promote-to-library-button.tsx` — **new** row action (modify barrel/expanded panel to render it).

---

# Chunk A — `is_global` scope foundation (backend)

### Task A1: Add `is_global` column to the schema

**Files:**
- Modify: `config/schema.sql:18-25`

- [ ] **Step 1: Edit the `techniques` table definition**

Change the block at `config/schema.sql:18`:

```sql
CREATE TABLE IF NOT EXISTS techniques (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    coach_id INTEGER,
    coach_name TEXT,
    is_global INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (coach_id) REFERENCES users (id)
);
```

Existing rows default to `1` (global), preserving current behaviour.

- [ ] **Step 2: Apply the migration locally**

Run: `nix develop .#ci --command just migrate`
Expected: migrator reports adding column `is_global` to `techniques`, exits 0.

- [ ] **Step 3: Verify the column exists**

Run: `nix develop .#ci --command sqlite3 "$(grep -oP 'DATABASE_URL=\Ksqlite:.*' .env 2>/dev/null | sed 's/sqlite://')" '.schema techniques'`
(If the path lookup is awkward, instead just trust Step 2's migrator output.)
Expected: schema shows `is_global INTEGER NOT NULL DEFAULT 1`.

- [ ] **Step 4: Commit**

```bash
git add config/schema.sql
git commit -m "feat(techniques): add is_global scope flag to schema"
```

---

### Task A2: Filter library + unassigned pickers to global; surface `is_global` on the syllabus row

**Files:**
- Modify: `crates/syllabus-tracker/src/db/techniques.rs:55` (library query `FROM techniques t`)
- Modify: `crates/syllabus-tracker/src/db/student_techniques.rs:351` (`get_unassigned_techniques`)
- Modify: `crates/syllabus-tracker/src/db/student_syllabus_techniques.rs:21` (`SstRow` struct) and `:62-89` (`list_for_assignment` query + mapping)
- Test: `crates/syllabus-tracker/src/test/syllabi.rs`

- [ ] **Step 1: Write a failing test for library filtering**

Add to `crates/syllabus-tracker/src/test/syllabi.rs` (follow the existing `TestDb` setup used by other tests in this file):

```rust
#[tokio::test]
async fn library_excludes_student_only_techniques() {
    let db = TestDb::new().await;
    // Global technique (default is_global = 1)
    sqlx::query!("INSERT INTO techniques (name, description) VALUES ('Global Move', '')")
        .execute(&db.pool).await.unwrap();
    // Student-only technique
    sqlx::query!("INSERT INTO techniques (name, description, is_global) VALUES ('Private Move', '', 0)")
        .execute(&db.pool).await.unwrap();

    let rows = crate::db::list_library_techniques(&db.pool).await.unwrap();
    let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
    assert!(names.contains(&"Global Move"));
    assert!(!names.contains(&"Private Move"));
}
```

- [ ] **Step 2: Run it; verify it fails**

Run: `nix develop .#ci --command cargo nextest run -p syllabus-tracker library_excludes_student_only_techniques`
Expected: FAIL — `Private Move` is present (no filter yet).

- [ ] **Step 3: Add `WHERE t.is_global = 1` to the library query**

In `crates/syllabus-tracker/src/db/techniques.rs`, the `list_library_techniques` query, change:

```sql
        FROM techniques t
        ORDER BY t.name
```
to:
```sql
        FROM techniques t
        WHERE t.is_global = 1
        ORDER BY t.name
```

- [ ] **Step 4: Add the same filter to the unassigned picker**

In `crates/syllabus-tracker/src/db/student_techniques.rs`, `get_unassigned_techniques`, change the `WHERE` clause to also require global:

```sql
        WHERE t.is_global = 1
          AND t.id NOT IN (
            SELECT technique_id FROM student_techniques
            WHERE student_id = ?
        )
```

- [ ] **Step 5: Surface `is_global` on `SstRow`**

In `crates/syllabus-tracker/src/db/student_syllabus_techniques.rs`, add to the `SstRow` struct (near `pub technique_id` at `:21`):

```rust
    pub is_global: bool,
```

In `list_for_assignment`, add to the SELECT list (after the `t.description` line at `:66`):

```sql
                  t.is_global AS "is_global!: bool",
```

And in the row mapping (after `technique_description: r.technique_description,` at `:119`):

```rust
            is_global: r.is_global,
```

- [ ] **Step 6: Write a failing test for `is_global` on the row payload**

Add to `crates/syllabus-tracker/src/test/syllabi.rs`:

```rust
#[tokio::test]
async fn list_for_assignment_exposes_is_global() {
    let db = TestDb::new().await;
    let (assignment_id, _student, coach) = seed_assignment_with_one_technique(&db).await;
    let rows = crate::db::list_for_assignment(&db.pool, assignment_id, &coach).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert!(rows[0].is_global, "seeded technique defaults to global");
}
```

If a `seed_assignment_with_one_technique` helper does not already exist in this test module, inline the setup the other tests in the file use (insert user/coach, technique, assignment, sst) instead of calling a helper.

- [ ] **Step 7: Regenerate sqlx + run tests**

Run: `nix develop .#ci --command just sqlx-prepare`
Run: `nix develop .#ci --command cargo nextest run -p syllabus-tracker library_excludes_student_only_techniques list_for_assignment_exposes_is_global`
Expected: both PASS.

- [ ] **Step 8: Commit**

```bash
git add crates/syllabus-tracker/src/db/techniques.rs \
        crates/syllabus-tracker/src/db/student_techniques.rs \
        crates/syllabus-tracker/src/db/student_syllabus_techniques.rs \
        crates/syllabus-tracker/src/test/syllabi.rs .sqlx
git commit -m "feat(techniques): scope library/pickers to global, expose is_global on syllabus rows"
```

---

### Task A3: Thread `is_global` through the existing create endpoint

> **Reconciled with branch:** `POST /techniques` (`api_create_library_technique`) and `create_technique` already exist. This task only adds an `is_global` knob (default `true`) so the same endpoint can create a student-only (`is_global = 0`) technique. It does **not** add a new endpoint, and it leaves `create_and_assign_technique` (used by the older student-techniques page) untouched. Tags are attached client-side post-create (the existing `NewTechniqueDialog` pattern), so no `tag_ids` on the backend.

**Files:**
- Modify: `crates/syllabus-tracker/src/db/techniques.rs` — `create_technique` (currently 4-arg) gains `is_global`
- Modify: `crates/syllabus-tracker/src/api.rs` — `CreateLibraryTechniqueRequest` (the struct added on this branch, just above `api_create_library_technique`) gains `is_global`; pass it through
- Test: `crates/syllabus-tracker/src/test/api.rs`

- [ ] **Step 1: Add `is_global` to `create_technique`**

In `crates/syllabus-tracker/src/db/techniques.rs`, change `create_technique`:

```rust
pub async fn create_technique(
    pool: &Pool<Sqlite>,
    name: &str,
    description: &str,
    coach_id: i64,
    is_global: bool,
) -> Result<i64, AppError> {
    info!("Creating technique");
    let res = sqlx::query!(
        "INSERT INTO techniques (name, description, coach_id, is_global)
         VALUES (?, ?, ?, ?)",
        name,
        description,
        coach_id,
        is_global
    )
    .execute(pool)
    .await?;
    Ok(res.last_insert_rowid())
}
```

- [ ] **Step 2: Fix every existing caller of `create_technique`**

The compiler will list them. Known callers, all of which should pass `true`:
- `create_and_assign_technique` (same file) — pass `true` (its behaviour is unchanged; it still creates global techniques).
- `api_create_library_technique` in `api.rs` — see Step 3.
Run `nix develop .#ci --command cargo check -p syllabus-tracker` and fix any other call site it surfaces by passing `true`.

- [ ] **Step 3: Add `is_global` to the library-create request + handler**

In `crates/syllabus-tracker/src/api.rs`, add to `CreateLibraryTechniqueRequest`:

```rust
    #[serde(default = "default_true")]
    is_global: bool,
```

Add near the top of the module if not already present:

```rust
fn default_true() -> bool { true }
```

Change the `create_technique` call inside `api_create_library_technique` to pass `body.is_global`:

```rust
    let technique_id = create_technique(db, &body.name, &body.description, user.id, body.is_global).await?;
```

(The handler already returns `TechniqueLibraryResponse { id, .. }`, which the frontend needs for client-side tag attach + syllabus add — leave the response shape as-is.)

- [ ] **Step 4: Write a failing test for the student-only path**

Add to `crates/syllabus-tracker/src/test/api.rs` (follow the existing rocket `Client` test pattern in that file — the branch already added tests for `POST /techniques`, mirror their setup/helpers):

```rust
#[tokio::test]
async fn create_student_only_technique_is_excluded_from_library() {
    let (client, db) = coach_client().await; // use the same helper the existing POST /techniques tests use
    let resp = client.post("/api/techniques")
        .header(ContentType::JSON)
        .body(r#"{"name":"Private Move","description":"","is_global":false}"#)
        .dispatch().await;
    assert_eq!(resp.status(), Status::Ok);
    let rows = crate::db::list_library_techniques(&db.pool).await.unwrap();
    assert!(!rows.iter().any(|r| r.name == "Private Move"), "student-only technique must not appear in the library");
}
```

Confirm the default-true path still works: the branch's existing "create appears in library" test (no `is_global` in body) must still pass.

- [ ] **Step 5: Run + regen**

Run: `nix develop .#ci --command just sqlx-prepare`
Run: `nix develop .#ci --command cargo nextest run -p syllabus-tracker create_student_only_technique_is_excluded_from_library`
Run: `nix develop .#ci --command cargo nextest run -p syllabus-tracker -p syllabus-tracker create_library` (re-run the branch's existing create tests to confirm no regression)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/techniques.rs \
        crates/syllabus-tracker/src/api.rs \
        crates/syllabus-tracker/src/test/api.rs .sqlx
git commit -m "feat(techniques): allow creating student-only (non-global) techniques via POST /techniques"
```

---

### Task A4: Promote-to-library endpoint

**Files:**
- Modify: `crates/syllabus-tracker/src/db/techniques.rs` (add `set_technique_global`)
- Modify: `crates/syllabus-tracker/src/api.rs` (new `PATCH /techniques/<id>/global`) + `main.rs` mount
- Test: `crates/syllabus-tracker/src/test/api.rs`

- [ ] **Step 1: Add the db function**

In `crates/syllabus-tracker/src/db/techniques.rs`:

```rust
pub async fn set_technique_global(pool: &Pool<Sqlite>, technique_id: i64) -> Result<(), AppError> {
    info!("Promoting technique to global library");
    sqlx::query!("UPDATE techniques SET is_global = 1 WHERE id = ?", technique_id)
        .execute(pool)
        .await?;
    Ok(())
}
```

- [ ] **Step 2: Add the endpoint**

In `crates/syllabus-tracker/src/api.rs`:

```rust
#[patch("/techniques/<id>/global")]
pub async fn api_promote_technique_to_global(
    id: i64,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    user.require_all_permissions(&[Permission::CreateTechniques])?;
    set_technique_global(db, id).await?;
    Ok(Status::Ok)
}
```

Import `set_technique_global` and mount `api_promote_technique_to_global` in `main.rs`.

- [ ] **Step 3: Failing test**

```rust
#[tokio::test]
async fn promote_makes_student_only_technique_global() {
    let (client, db) = coach_client().await;
    let id = sqlx::query!("INSERT INTO techniques (name, description, is_global) VALUES ('Promote Me','',0)")
        .execute(&db.pool).await.unwrap().last_insert_rowid();
    let resp = client.patch(format!("/api/techniques/{id}/global")).dispatch().await;
    assert_eq!(resp.status(), Status::Ok);
    let rows = crate::db::list_library_techniques(&db.pool).await.unwrap();
    assert!(rows.iter().any(|r| r.name == "Promote Me"));
}
```

- [ ] **Step 4: Run + regen**

Run: `nix develop .#ci --command just sqlx-prepare`
Run: `nix develop .#ci --command cargo nextest run -p syllabus-tracker promote_makes_student_only_technique_global`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/syllabus-tracker/src/db/techniques.rs \
        crates/syllabus-tracker/src/api.rs \
        crates/syllabus-tracker/src/main.rs \
        crates/syllabus-tracker/src/test/api.rs .sqlx
git commit -m "feat(techniques): add promote-to-global-library endpoint"
```

---

# Chunk B — `is_global` frontend plumbing + reuse the existing create UI

### Task B1: Frontend API + mutations (`is_global`, promote)

> **Reconciled with branch:** `createLibraryTechnique({name, description})` and `CreatedLibraryTechnique` already exist in `lib/api.ts`. This task only adds the optional `is_global` arg, the promote call, and `SstRow.is_global`. There is **no** `createGlobalTechnique` (use the existing `createLibraryTechnique`) and **no** change to `createAndAssignTechnique`.

**Files:**
- Modify: `frontend/src/lib/api.ts` — `SstRow` add `is_global`; extend `createLibraryTechnique`; add `promoteTechniqueToGlobal`
- Modify: `frontend/src/lib/mutations.ts` — add `usePromoteTechniqueToGlobal`

- [ ] **Step 1: Add `is_global` to the `SstRow` interface**

In `frontend/src/lib/api.ts`, add to `interface SstRow` (after `technique_description`):

```ts
  is_global: boolean;
```

- [ ] **Step 2: Extend `createLibraryTechnique` with optional `is_global`; add promote**

Change the existing `createLibraryTechnique` to accept `is_global` and add the promote call right after it:

```ts
export async function createLibraryTechnique(data: {
  name: string;
  description: string;
  is_global?: boolean;
}): Promise<Response> {
  return await fetch("/api/techniques", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: data.name,
      description: data.description,
      // omit when undefined so the backend default (true) applies
      ...(data.is_global === undefined ? {} : { is_global: data.is_global }),
    }),
    credentials: "include",
  });
}

export async function promoteTechniqueToGlobal(techniqueId: number): Promise<Response> {
  return await fetch(`/api/techniques/${techniqueId}/global`, {
    method: "PATCH",
    credentials: "include",
  });
}
```

(The existing `NewTechniqueDialog` call site `createLibraryTechnique({ name, description })` keeps working unchanged — `is_global` is optional.)

- [ ] **Step 3: Add the promote mutation hook**

In `frontend/src/lib/mutations.ts`, add (mirroring existing hook style; invalidate library + the syllabus-detail query — read `queries.ts` to find the exact `qk` key used by `useStudentSyllabusTechniques`, and invalidate that too so a promoted row's `is_global` refreshes):

```ts
export function usePromoteTechniqueToGlobal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { techniqueId: number }) =>
      unwrap(await promoteTechniqueToGlobal(vars.techniqueId)),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.libraryTechniques() }),
        // plus the syllabus-detail key (look it up in queries.ts)
      ]),
  });
}
```

Add `promoteTechniqueToGlobal` to the api imports at the top of `mutations.ts`.

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/mutations.ts
git commit -m "feat(techniques): frontend is_global on createLibraryTechnique + promote mutation"
```

---

### Task B2: Extract a reusable `NewTechniqueForm` from `NewTechniqueDialog`

> **Reconciled with branch:** `new-technique-dialog.tsx` already implements the full create UI (duplicate/similar nudges, tag suggest-from-title, tag create/attach, `useFormWithValidation` + `<TracedForm>`). Rather than build a parallel form, extract its body into a `<NewTechniqueForm>` that both the library dialog and the student modal embed. **Behaviour for the library must not change.**

**Files:**
- Create: `frontend/src/components/new-technique-form.tsx`
- Modify: `frontend/src/components/new-technique-dialog.tsx` (becomes a thin wrapper)

- [ ] **Step 1: Move the dialog body into `NewTechniqueForm`**

Cut everything inside `<DialogContent>` (the `<TracedForm>...</TracedForm>` block plus all the state/hooks/helpers it depends on: `form`, `pendingTags`, tag popover state, `exactDuplicate`/`similar`/`suggestedFromTitle`, `attachTags`, `handleSubmit`) out of `new-technique-dialog.tsx` and into a new `NewTechniqueForm` component with this contract:

```tsx
export interface NewTechniqueFormProps {
  /** Existing library technique names, used for the duplicate nudge. */
  existingNames: string[];
  /** HTML id for the <form>, so a footer button outside it can submit via form=. */
  formId: string;
  /**
   * When provided, render an "Add to global library too" switch wired to this
   * state; the created technique is global iff `addToGlobal` is true. When
   * omitted, the form always creates a global library technique (current
   * library behaviour).
   */
  addToGlobal?: boolean;
  onAddToGlobalChange?: (next: boolean) => void;
  /**
   * Called after the technique is created and its tags attached, with the new
   * technique id. The library dialog uses this only to close + toast; the
   * student modal additionally adds the technique to the syllabus.
   */
  onCreated: (created: CreatedLibraryTechnique) => void | Promise<void>;
}
```

Inside, change the create call to honour the switch:

```tsx
const response = await createLibraryTechnique({
  name: values.name,
  description: values.description,
  // undefined (omitted) keeps the global default; only the student modal passes the switch
  is_global: addToGlobal,
});
```

When `addToGlobal === undefined`, the form must not render the switch and must call `createLibraryTechnique` without `is_global` (global). When defined, render the switch and pass the boolean. After `attachTags(created.id)` succeeds, call `await onCreated(created)` instead of the old inline `onOpenChange(false)` + toast (the wrapper/caller owns those side effects).

Keep `attachTags`, the duplicate/similar nudges, and the tag popover exactly as they are — just relocated. The form renders its fields + a submit `<button type="submit" form={formId}>` is supplied by the **caller** (so the dialog footer / modal footer owns the button); the form's own inline Cancel/Create buttons move out to the wrapper. (If simpler, the form may keep rendering its own Create button using `formId`; match whichever is cleaner, but the student modal needs the switch above the submit button.)

- [ ] **Step 2: Rewrite `NewTechniqueDialog` as a thin wrapper**

```tsx
export default function NewTechniqueDialog({ open, onOpenChange, existingNames }: NewTechniqueDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>New technique</DialogTitle>
          <DialogDescription>
            Adds a technique to the global library. Start typing the name to see if it already exists.
          </DialogDescription>
        </DialogHeader>
        <NewTechniqueForm
          existingNames={existingNames}
          formId="create_library_technique"
          onCreated={(created) => {
            toast.success(`Created "${created.name}"`);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
```

(Move the `queryClient` invalidations for `libraryTechniques`/`libraryStats`/`tags` into `NewTechniqueForm` after create, since both callers need them.)

- [ ] **Step 3: Verify the library create flow is unchanged**

Run: `cd frontend && npx tsc --noEmit && npx eslint src/components/new-technique-form.tsx src/components/new-technique-dialog.tsx`
Expected: clean. Manually (or in the existing dialog test, if any): open Library → New technique → create still works, nudges + tags still work, **no** switch shown.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/new-technique-form.tsx frontend/src/components/new-technique-dialog.tsx
git commit -m "refactor(library): extract NewTechniqueForm from NewTechniqueDialog for reuse"
```

---

### Task B3: Relocate the library New-technique button to a full-width row

> **Reconciled with branch:** the button + dialog already exist on `library/page.tsx`; it is currently a small button in the title's flex row. This task only moves it to its own full-width row beneath a title-only row (image #6). No new dialog wiring.

**Files:**
- Modify: `frontend/src/app/library/page.tsx`

- [ ] **Step 1: Split the title row and make the button full-width**

Replace the current title `<div className="mb-4 flex items-center justify-between gap-2">...</div>` block with:

```tsx
<div className="mb-4 space-y-3">
  <h1 className="flex items-center gap-2 text-base font-semibold">
    <BookOpen className="h-4 w-4" aria-hidden />
    Global Technique Library
  </h1>
  {isCoach && (
    <Button className="w-full" onClick={() => setNewOpen(true)}>
      <Plus className="mr-2 h-4 w-4" aria-hidden />
      New technique
    </Button>
  )}
</div>
```

Keep the existing `<NewTechniqueDialog open={newOpen} onOpenChange={setNewOpen} existingNames={...} />` render as-is. Match the red/destructive treatment used by the syllabus "Add technique" button (Task C1) so the two are visually consistent — if that button uses `variant="destructive"`, use it here too.

- [ ] **Step 2: Typecheck + lint**

Run: `cd frontend && npx tsc --noEmit && npx eslint src/app/library/page.tsx`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/library/page.tsx
git commit -m "feat(library): move New technique to a full-width button row above search"
```

---

# Chunk C — Add-to-student dialog uplift

### Task C1: Full-width add button row on the syllabus page

**Files:**
- Modify: `frontend/src/app/student-syllabi/[syllabusId]/page.tsx:215-256`

- [ ] **Step 1: Remove the `+` icon button from the icon toolbar**

Delete the `<Button ... aria-label="Add technique to this student">...<Plus/></Button>` block (`:225-232`). Keep GitCompare, Graduate, Trash buttons in the icon row.

- [ ] **Step 2: Add a full-width red button row below the icon toolbar**

Immediately after the closing `</div>` of the icon toolbar (`:256`), inside the `!isOwnView` region, add:

```tsx
{!isOwnView && (
  <Button
    className="w-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
    onClick={() => setAddOpen(true)}
  >
    <Plus className="mr-2 h-4 w-4" aria-hidden />
    Add technique
  </Button>
)}
```

(Match the red treatment chosen in Task B3 Step 2.)

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/student-syllabi/[syllabusId]/page.tsx"
git commit -m "feat(syllabus): promote add-technique to a full-width button row"
```

---

### Task C2: Hide already-present techniques in the picker

**Files:**
- Modify: `frontend/src/app/student-syllabi/[syllabusId]/components/add-to-student-dialog.tsx`
- The page passes `presentTechniqueIds` (visible + hidden SST technique ids). We need to distinguish **visible-present** (filter out entirely) from **hidden-present** (surface as "make visible" — Task C4). Change the prop to pass both.

- [ ] **Step 1: Change the dialog props**

Replace `presentTechniqueIds: Set<number>;` with:

```ts
  /** technique_ids on the syllabus and currently visible — excluded from the picker. */
  visibleTechniqueIds: Set<number>;
  /** technique_id -> sstId for rows on the syllabus but hidden — offered as "make visible". */
  hiddenTechniqueSstByTid: Map<number, number>;
```

- [ ] **Step 2: Filter visible-present out of the existing-technique list**

In the `filtered` `useMemo`, add to the predicate:

```ts
      const notAlreadyVisible = !visibleTechniqueIds.has(t.id);
      return matchesText && matchesTags && notAlreadyVisible;
```

Remove the now-dead `already` / `(already in their list)` rendering (`:159`, `:175-179`).

- [ ] **Step 3: Update the page's call site**

In `page.tsx`, where `<AddToStudentDialog .../>` is rendered, compute and pass:

```tsx
visibleTechniqueIds={new Set(techniques.filter((s) => !s.hidden_at).map((s) => s.technique_id))}
hiddenTechniqueSstByTid={new Map(techniques.filter((s) => s.hidden_at).map((s) => [s.technique_id, s.id]))}
```

(`techniques` here must be the **unfiltered** SST list including hidden rows — see Task D1 which keeps the full list around as `allTechniques`.)

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean (page.tsx may not yet expose `allTechniques`; if so, temporarily pass `query.data?.techniques ?? []` and reconcile in D1).

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/student-syllabi/[syllabusId]/components/add-to-student-dialog.tsx" \
        "frontend/src/app/student-syllabi/[syllabusId]/page.tsx"
git commit -m "feat(syllabus): hide already-present techniques from the add picker"
```

---

### Task C3: Add the "Create new" tab reusing `NewTechniqueForm` + global switch

> **Reconciled with branch:** the Create tab embeds the extracted `<NewTechniqueForm>` (Task B2) — same UI as the global library create (duplicate nudges, tag suggest/create/attach). It passes the `addToGlobal` switch (default ON) and an `onCreated` that adds the new technique to this student's syllabus. No `CreateTechniqueForm`, no `useCreateAndAssignTechnique`.

**Files:**
- Modify: `frontend/src/app/student-syllabi/[syllabusId]/components/add-to-student-dialog.tsx`

- [ ] **Step 1: Wrap the dialog body in Tabs**

Import `Tabs, TabsContent, TabsList, TabsTrigger` from `@/components/ui/tabs`, `NewTechniqueForm` from `@/components/new-technique-form`, and the existing add-to-syllabus mutation hook (`useAddTechniqueToStudentSyllabus`, already used by this dialog). The `existingNames` for the nudge come from the library query already loaded in this dialog.

Structure the `DialogContent` body as:

```tsx
<Tabs defaultValue="existing" className="flex min-h-0 flex-1 flex-col">
  <TabsList className="grid grid-cols-2">
    <TabsTrigger value="existing">Add existing</TabsTrigger>
    <TabsTrigger value="create">Create new</TabsTrigger>
  </TabsList>

  <TabsContent value="existing" className="flex min-h-0 flex-1 flex-col gap-3">
    {/* existing search + tag chips + list + the existing Add footer */}
  </TabsContent>

  <TabsContent value="create" className="flex min-h-0 flex-1 flex-col gap-3">
    <NewTechniqueForm
      existingNames={techniques.map((t) => t.name)}
      formId="sst-create"
      addToGlobal={addToGlobal}
      onAddToGlobalChange={setAddToGlobal}
      onCreated={handleCreated}
    />
  </TabsContent>
</Tabs>
```

`NewTechniqueForm` renders the "Add to global library too" switch itself (because `addToGlobal` is provided) and owns its own submit button via `formId="sst-create"`.

- [ ] **Step 2: Add state + the `onCreated` handler**

```tsx
const [addToGlobal, setAddToGlobal] = useState(true);
const addMutation = useAddTechniqueToStudentSyllabus(); // the hook this dialog already uses

useEffect(() => { if (!open) setAddToGlobal(true); }, [open]);

async function handleCreated(created: CreatedLibraryTechnique) {
  // The technique now exists (global iff addToGlobal). Attach it to THIS
  // student's syllabus. NewTechniqueForm already attached tags + invalidated
  // library queries.
  try {
    await addMutation.mutateAsync({ studentId, syllabusId, techniqueId: created.id });
    toast.success(
      addToGlobal ? `Added "${created.name}" (also in library)` : `Added "${created.name}" for this student`,
    );
    onOpenChange(false);
  } catch {
    toast.error('Created the technique but failed to add it to the syllabus');
  }
}
```

> Spec mapping: switch ON ⇒ `addToGlobal = true` ⇒ `createLibraryTechnique({..., is_global: true})` (also lands in the global library); OFF ⇒ `is_global: false` (student-only / "Custom"). Either way the technique is added to this syllabus via `onCreated`.

> Edge case the implementer must confirm: when `addToGlobal` is true the new technique is global, so it would also surface in the "Add existing" tab next time — that's correct. When false it never appears in the library or other students' pickers (backend filter from A2/A3).

- [ ] **Step 3: Typecheck + lint**

Run: `cd frontend && npx tsc --noEmit && npx eslint "src/app/student-syllabi/[syllabusId]/components/add-to-student-dialog.tsx"`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/student-syllabi/[syllabusId]/components/add-to-student-dialog.tsx"
git commit -m "feat(syllabus): add Create-new tab reusing NewTechniqueForm with add-to-global switch"
```

---

### Task C4: Surface hidden-match in the Add-existing tab

**Files:**
- Create: `frontend/src/app/student-syllabi/[syllabusId]/sst-view.ts` (just the `matchHiddenByName` helper here; partition/sort added in D1)
- Create: `frontend/src/app/student-syllabi/[syllabusId]/sst-view.unit.test.ts`
- Modify: `add-to-student-dialog.tsx`

When the coach's search text matches the name of a technique that's on the syllabus **but hidden**, show a banner: "{name} is on their list but hidden. Make visible?" with an action calling `useSetSstHidden({ hidden: false })`.

- [ ] **Step 1: Write the failing helper test**

`sst-view.unit.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { matchHiddenByName } from './sst-view';

describe('matchHiddenByName', () => {
  const hidden = [{ technique_id: 7, technique_name: 'Back Escape', sstId: 12 }];
  test('returns a hidden match on case-insensitive substring', () => {
    expect(matchHiddenByName(hidden, 'back')).toEqual(hidden[0]);
  });
  test('returns null when query is empty', () => {
    expect(matchHiddenByName(hidden, '   ')).toBeNull();
  });
  test('returns null when nothing matches', () => {
    expect(matchHiddenByName(hidden, 'mount')).toBeNull();
  });
});
```

- [ ] **Step 2: Run; verify fail**

Run: `cd frontend && npx vitest run src/app/student-syllabi/\[syllabusId\]/sst-view.unit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

`sst-view.ts`:

```ts
export interface HiddenMatchCandidate {
  technique_id: number;
  technique_name: string;
  sstId: number;
}

export function matchHiddenByName(
  hidden: HiddenMatchCandidate[],
  query: string,
): HiddenMatchCandidate | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  return hidden.find((h) => h.technique_name.toLowerCase().includes(needle)) ?? null;
}
```

- [ ] **Step 4: Run; verify pass**

Run: `cd frontend && npx vitest run src/app/student-syllabi/\[syllabusId\]/sst-view.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the banner into the dialog**

In `add-to-student-dialog.tsx`, build the candidate list from `hiddenTechniqueSstByTid` + the library data (to get names), compute `const hiddenMatch = matchHiddenByName(candidates, search);`, and render above the list when non-null:

```tsx
{hiddenMatch && (
  <div className="flex items-center justify-between gap-2 rounded border border-border bg-muted/40 px-3 py-2 text-sm">
    <span>{hiddenMatch.technique_name} is on their list but hidden.</span>
    <Button
      size="sm"
      variant="outline"
      disabled={unhideMutation.isPending}
      onClick={async () => {
        try {
          await unhideMutation.mutateAsync({
            sstId: hiddenMatch.sstId, studentId, syllabusId, hidden: false,
          });
          toast.success(`Showing ${hiddenMatch.technique_name}`);
        } catch { toast.error('Failed to update visibility'); }
      }}
    >
      Make visible
    </Button>
  </div>
)}
```

Add `const unhideMutation = useSetSstHidden();` (import from `@/lib/mutations`) and `syllabusId` to the dialog props (thread from page.tsx).

- [ ] **Step 6: Typecheck + commit**

Run: `cd frontend && npx tsc --noEmit`

```bash
git add "frontend/src/app/student-syllabi/[syllabusId]/sst-view.ts" \
        "frontend/src/app/student-syllabi/[syllabusId]/sst-view.unit.test.ts" \
        "frontend/src/app/student-syllabi/[syllabusId]/components/add-to-student-dialog.tsx" \
        "frontend/src/app/student-syllabi/[syllabusId]/page.tsx"
git commit -m "feat(syllabus): surface hidden-for-student matches in the add picker"
```

---

# Chunk D — Tabs, ghost transition, sort

### Task D1: Main/Custom/Hidden partition helpers + tab UI

**Files:**
- Modify: `frontend/src/app/student-syllabi/[syllabusId]/sst-view.ts` (+ unit tests)
- Modify: `frontend/src/app/student-syllabi/[syllabusId]/page.tsx`

Partition rules (per the spec):
- **Main:** `hidden_at == null` (includes student-only customs) **plus** any technique_id in the per-visit `ghostIds` set (just-hidden, lingering).
- **Custom:** `is_global === false` (regardless of hidden? — customs that are hidden show only in Hidden; so Custom = `is_global === false && hidden_at == null`).
- **Hidden:** `hidden_at != null`.

- [ ] **Step 1: Failing test for `partitionSsts`**

Append to `sst-view.unit.test.ts`:

```ts
import { partitionSsts } from './sst-view';

const row = (over: Partial<any>) => ({
  id: 1, technique_id: 1, technique_name: 'X', hidden_at: null, is_global: true, ...over,
});

describe('partitionSsts', () => {
  const rows = [
    row({ id: 1, technique_id: 1, is_global: true, hidden_at: null }),
    row({ id: 2, technique_id: 2, is_global: false, hidden_at: null }),  // custom
    row({ id: 3, technique_id: 3, is_global: true, hidden_at: '2026-01-01T00:00:00Z' }), // hidden
  ];
  test('main = visible rows (incl custom) + ghosts', () => {
    const { main } = partitionSsts(rows as any, new Set([3]));
    expect(main.map((r) => r.id).sort()).toEqual([1, 2, 3]); // 3 lingers as ghost
  });
  test('custom = visible student-only', () => {
    const { custom } = partitionSsts(rows as any, new Set());
    expect(custom.map((r) => r.id)).toEqual([2]);
  });
  test('hidden = hidden_at set', () => {
    const { hidden } = partitionSsts(rows as any, new Set());
    expect(hidden.map((r) => r.id)).toEqual([3]);
  });
});
```

- [ ] **Step 2: Run; verify fail**

Run: `cd frontend && npx vitest run src/app/student-syllabi/\[syllabusId\]/sst-view.unit.test.ts`
Expected: FAIL — `partitionSsts` not exported.

- [ ] **Step 3: Implement `partitionSsts`**

Add to `sst-view.ts` (import the `SstRow` type from `@/lib/api`):

```ts
import type { SstRow } from '@/lib/api';

export interface SstPartition { main: SstRow[]; custom: SstRow[]; hidden: SstRow[]; }

export function partitionSsts(rows: SstRow[], ghostIds: Set<number>): SstPartition {
  const main = rows.filter((r) => r.hidden_at == null || ghostIds.has(r.technique_id));
  const custom = rows.filter((r) => r.hidden_at == null && !r.is_global);
  const hidden = rows.filter((r) => r.hidden_at != null);
  return { main, custom, hidden };
}
```

- [ ] **Step 4: Run; verify pass**

Run: `cd frontend && npx vitest run src/app/student-syllabi/\[syllabusId\]/sst-view.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire tabs into the page**

In `page.tsx`: keep the full, unsorted SST list as `allTechniques = query.data?.techniques ?? []` (coaches already receive hidden rows from `list_for_assignment`). Add:

```tsx
const [tab, setTab] = useState<'main' | 'custom' | 'hidden'>('main');
const [ghostIds, setGhostIds] = useState<Set<number>>(new Set()); // Task D2
const { main, custom, hidden } = useMemo(
  () => partitionSsts(allTechniques, ghostIds),
  [allTechniques, ghostIds],
);
const activeRows = tab === 'main' ? main : tab === 'custom' ? custom : hidden;
```

Render a `<Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>` with three `TabsTrigger`s (`Main` / `Custom (n)` / `Hidden (n)` using `custom.length` / `hidden.length`), and feed `activeRows` (after sort — Task D3) into the existing `useTechniqueListNav` `items`. Only show the Custom/Hidden tabs to coaches (`!isOwnView`).

- [ ] **Step 6: Typecheck + commit**

Run: `cd frontend && npx tsc --noEmit`

```bash
git add "frontend/src/app/student-syllabi/[syllabusId]/sst-view.ts" \
        "frontend/src/app/student-syllabi/[syllabusId]/sst-view.unit.test.ts" \
        "frontend/src/app/student-syllabi/[syllabusId]/page.tsx"
git commit -m "feat(syllabus): Main/Custom/Hidden tabs on the student syllabus view"
```

---

### Task D2: Ghost-on-hide transition (per-visit lingering)

**Files:**
- Modify: `frontend/src/app/student-syllabi/[syllabusId]/page.tsx`
- Modify: `frontend/src/components/technique-row/hidden-toggle-button.tsx` (notify parent on hide)
- Modify: `frontend/src/components/technique-row/technique-row-context.tsx` (or wherever row context is defined) to pass an `onHiddenToggled` callback through, OR lift via a lightweight context.

Behaviour: tapping the eye on a Main-tab row optimistically marks it ghostly and **keeps it in Main for the current visit**; it appears in Hidden immediately. Switching tabs or unmounting clears the ghost so a return to Main no longer shows it.

- [ ] **Step 1: Add ghost set management in the page**

```tsx
function handleHiddenToggled(techniqueId: number, nowHidden: boolean) {
  setGhostIds((prev) => {
    const next = new Set(prev);
    if (nowHidden) next.add(techniqueId);   // linger in Main this visit
    else next.delete(techniqueId);          // un-hidden: no longer a ghost
    return next;
  });
}
```

Clear ghosts when the tab changes:

```tsx
function changeTab(next: 'main' | 'custom' | 'hidden') {
  setGhostIds(new Set());
  setTab(next);
}
```

Use `changeTab` as the Tabs `onValueChange`. (Unmount clears naturally since state dies with the component.)

- [ ] **Step 2: Apply ghost styling to rows**

Compute `const isGhost = ghostIds.has(t.technique_id)` per row and pass a `className` / prop so the `TechniqueRow` renders at reduced opacity, e.g. wrap the row container with `cn(isGhost && 'opacity-50 transition-opacity')`. If `TechniqueRow` does not accept a class for the outer element, add an optional `ghost?: boolean` prop to it that applies `opacity-50`.

- [ ] **Step 3: Notify the page from the toggle button**

`hidden-toggle-button.tsx` already calls `mutation.mutateAsync({... hidden: !hidden})`. After success, call an `onToggled?.(sst.technique_id, !hidden)` callback obtained from row context. Thread `onHiddenToggled` from `page.tsx` → `TechniqueRow context={{ kind: 'student-syllabus', ..., onHiddenToggled: handleHiddenToggled }}`. Add the optional field to the `student-syllabus` context type.

- [ ] **Step 4: Manual verification (browser)**

This is interactive; verify with the `verify`/`run` skill or manually:
1. Coach opens a student syllabus, Main tab. Tap eye on a row → row fades (opacity), **stays** in Main; Hidden tab count increments.
2. Switch to Hidden → the row is there. Switch back to Main → row is **gone**.
3. Reload → row only in Hidden.

- [ ] **Step 5: Typecheck + commit**

Run: `cd frontend && npx tsc --noEmit`

```bash
git add "frontend/src/app/student-syllabi/[syllabusId]/page.tsx" \
        "frontend/src/components/technique-row/hidden-toggle-button.tsx" \
        frontend/src/components/technique-row/
git commit -m "feat(syllabus): ghost just-hidden rows in Main until you leave the tab"
```

---

### Task D3: Sort dropdown (recent activity / alphabetical)

**Files:**
- Modify: `frontend/src/app/student-syllabi/[syllabusId]/sst-view.ts` (+ unit test) — extract `sortSsts`
- Modify: `frontend/src/app/student-syllabi/[syllabusId]/page.tsx`
- Pattern reference: `frontend/src/app/students-list/page.tsx:289-297` (Select), `:21` (`SortBy` type)

- [ ] **Step 1: Failing test for `sortSsts`**

Append to `sst-view.unit.test.ts`:

```ts
import { sortSsts } from './sst-view';

describe('sortSsts', () => {
  const a = row({ id: 1, technique_name: 'Zebra', last_attempt_at: '2026-01-02T00:00:00Z', last_coach_update_at: null, last_student_update_at: null });
  const b = row({ id: 2, technique_name: 'Alpha', last_attempt_at: '2026-01-01T00:00:00Z', last_coach_update_at: null, last_student_update_at: null });
  test('recent puts most-recent activity first', () => {
    expect(sortSsts([b, a] as any, 'recent').map((r) => r.id)).toEqual([1, 2]);
  });
  test('alphabetical sorts by name', () => {
    expect(sortSsts([a, b] as any, 'alphabetical').map((r) => r.id)).toEqual([2, 1]);
  });
});
```

- [ ] **Step 2: Run; verify fail**, then implement in `sst-view.ts`:

```ts
export type SstSort = 'recent' | 'alphabetical';

function recencyScore(s: SstRow): number {
  const ts = [s.last_attempt_at, s.last_coach_update_at, s.last_student_update_at]
    .filter((t): t is string => t != null)
    .map((t) => new Date(t).getTime());
  return ts.length ? Math.max(...ts) : 0;
}

export function sortSsts(rows: SstRow[], sort: SstSort): SstRow[] {
  const copy = [...rows];
  if (sort === 'alphabetical') {
    return copy.sort((a, b) => a.technique_name.localeCompare(b.technique_name));
  }
  return copy.sort((a, b) => recencyScore(b) - recencyScore(a));
}
```

Run: `cd frontend && npx vitest run src/app/student-syllabi/\[syllabusId\]/sst-view.unit.test.ts`
Expected: PASS.

- [ ] **Step 3: Replace the page's inline sort with the helper + dropdown**

In `page.tsx`, delete the inline `[...rows].sort(...)` block (`:97-110`) — sorting now happens after partition/tab selection. Add:

```tsx
const [sort, setSort] = useState<SstSort>('recent');
const visibleRows = useMemo(() => sortSsts(activeRows, sort), [activeRows, sort]);
```

Feed `visibleRows` into `useTechniqueListNav({ items: visibleRows, ... })`. Render the Select (coach-only) next to the tabs, mirroring students-list:

```tsx
<Select value={sort} onValueChange={(v) => setSort(v as SstSort)}>
  <SelectTrigger className="w-full sm:w-[180px]"><SelectValue /></SelectTrigger>
  <SelectContent>
    <SelectItem value="recent">Recently active</SelectItem>
    <SelectItem value="alphabetical">Alphabetical</SelectItem>
  </SelectContent>
</Select>
```

- [ ] **Step 4: Typecheck + commit**

Run: `cd frontend && npx tsc --noEmit`

```bash
git add "frontend/src/app/student-syllabi/[syllabusId]/sst-view.ts" \
        "frontend/src/app/student-syllabi/[syllabusId]/sst-view.unit.test.ts" \
        "frontend/src/app/student-syllabi/[syllabusId]/page.tsx"
git commit -m "feat(syllabus): sort dropdown (recently active default, alphabetical)"
```

---

### Task D4: Promote-to-library row action

**Files:**
- Create: `frontend/src/components/technique-row/promote-to-library-button.tsx`
- Modify: the technique-row barrel/expanded panel to render it for `is_global === false` rows in the student-syllabus context
- Pattern reference: `frontend/src/components/technique-row/hidden-toggle-button.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { Library } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { usePromoteTechniqueToGlobal } from '@/lib/mutations';
import { useTechniqueRow } from './technique-row-context';

export function PromoteToLibraryButton() {
  const { context, role } = useTechniqueRow();
  const mutation = usePromoteTechniqueToGlobal();
  if (context.kind !== 'student-syllabus') return null;
  if (role !== 'coach' && role !== 'admin') return null;
  if (context.sst.is_global) return null;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={mutation.isPending}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await mutation.mutateAsync({ techniqueId: context.sst.technique_id });
          toast.success(`${context.sst.technique_name} added to the library`);
        } catch {
          toast.error('Failed to add to library');
        }
      }}
    >
      <Library className="mr-2 h-4 w-4" aria-hidden />
      Move to global library
    </Button>
  );
}
```

> After promote, the row's `is_global` flips on the next syllabus-detail refetch (the mutation invalidates `libraryTechniques`; also invalidate the syllabus-detail query key in `usePromoteTechniqueToGlobal.onSuccess` so the button hides). Update that hook to also `qc.invalidateQueries` the syllabus-detail key used by `useStudentSyllabusTechniques`.

- [ ] **Step 2: Render it in the expanded panel**

In `frontend/src/components/technique-row/expanded-panel.tsx`, render `<PromoteToLibraryButton />` in the student-syllabus action area (near where coach controls live). It self-hides for global rows, so unconditional placement within the coach action row is fine.

- [ ] **Step 3: Typecheck + commit**

Run: `cd frontend && npx tsc --noEmit`

```bash
git add frontend/src/components/technique-row/promote-to-library-button.tsx \
        frontend/src/components/technique-row/expanded-panel.tsx \
        frontend/src/lib/mutations.ts
git commit -m "feat(syllabus): add Move-to-global-library action on custom technique rows"
```

---

# Chunk E — Video tiers & cross-tier propagation — DECOUPLED

Moved out of this plan. The per-student-syllabus video work (3 tiers, propagation,
visibility resolver, diff extension) became a substantial subsystem of its own and
is captured in `docs/superpowers/specs/2026-06-16-video-tiers-and-propagation-design.md`
(see its Second-Review Addendum for the authoritative resolved decisions). It will get
its own `writing-plans` cycle. This plan ships Chunks A–D (technique snapshot work) only.

## Final verification

- [ ] **Backend full test run**

Run: `nix develop .#ci --command cargo nextest run -p syllabus-tracker`
Expected: all pass.

- [ ] **Frontend unit tests**

Run: `cd frontend && npx vitest run src/app/student-syllabi`
Expected: all `sst-view.unit.test.ts` cases pass.

- [ ] **Full gate**

Run: `just verify`
Expected: lint + offline build + tests green (sqlx-check is intentionally not part of the gate per `project-sqlx-check-seed-dependency`).

- [ ] **Open PR** following `ci-and-staging-deploy`; let `deploy.yaml` run; optionally deploy the branch to staging for manual UX review of the ghost transition, tabs, and the create-with-switch flow.

---

## Self-Review notes (author checklist, already applied)

- **Spec coverage:** full-width add button (C1) ✓; picker hides present (C2) ✓; create-new tab reusing the existing create UI (C3) ✓; add-to-global switch default ON (C3) ✓; library title row + full-width New technique relocation (B3) ✓; ghost-on-hide lingering then moves to Hidden tab (D1/D2) ✓; hidden wired into diff (already exists — unchanged) + add picker (C4) ✓; sort recent-default + alphabetical (D3) ✓; fully-private student-only scope (A1/A2/A3) ✓; promote-to-library included now (A4/D4) ✓; create UI matches global library (reuses `NewTechniqueForm`, B2) ✓.
- **Reconciled with pre-existing branch work:** `POST /techniques` + `createLibraryTechnique` + `NewTechniqueDialog` already exist; A3 only threads `is_global`, B1 only adds the optional arg + promote, B2 extracts a shared form, B3 relocates an existing button, C3 reuses the form. No duplicate endpoint or parallel form is created.
- **Type consistency:** `is_global` is `bool` (Rust) / `boolean` (TS) end-to-end; `CreatedLibraryTechnique` (carries `id`) is the return type used by `onCreated`; helper names `partitionSsts`/`sortSsts`/`matchHiddenByName` reused verbatim across tasks and tests.
- **Known soft spots to confirm during execution:** (1) the exact split of submit-button ownership when extracting `NewTechniqueForm` (B2 Step 1) — keep the library flow byte-for-byte behaviourally identical; (2) destructive/red `Button` variant name (B3/C1); (3) the syllabus-detail query key for cache invalidation (B1/D4) — read `queries.ts` `qk` and `useStudentSyllabusTechniques`; (4) whether `TechniqueRow` accepts an outer className/`ghost` prop (D2 Step 2); (5) the add-to-syllabus hook name used by the dialog (`useAddTechniqueToStudentSyllabus`, C3 Step 2). None block the design; each has a fallback noted inline.
