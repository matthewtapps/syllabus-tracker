# Camps on the student profile, and retiring the standalone matches surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a student's camps inline on their profile as enriched trailhead cards, remove the profile "Spaces" section entirely, and retire the standalone matches page (matches live only inside their camp).

**Architecture:** Backend gains an enriched camp-summary list query (competition name + technique/video counts + last-activity) behind the existing `GET /api/camps` endpoint, and stamps `camp_id` onto match activity so match deep-links can target the owning camp. Frontend replaces the Spaces list with a Camps preview section built from a new `CampSummaryCard`, deletes the standalone matches page and its cross-camp aggregate, and repoints match activity deep-links to `/camps/:id`.

**Tech Stack:** Rust + Rocket + sqlx (SQLite, offline metadata); React + TypeScript + Tailwind + shadcn/ui; TanStack Query; Vitest.

Spec: `docs/superpowers/specs/2026-06-17-camps-on-profile-and-retire-matches-design.md`

---

## Conventions

- **Backend build/test/prepare run inside the CI dev shell.** Use the `nix develop .#ci --command ...` prefix shown in each step (matches the repo's toolchain pinning).
- **No bare `cargo sqlx prepare`** on the dev DB. Any task that adds or edits a `sqlx::query!` must regenerate offline metadata with `nix develop .#ci --command just sqlx-prepare` (an ephemeral empty DB is the deterministic prepare state; see the `justfile` `_sqlx` recipe). Annotate every expression column (`COUNT`, `MAX`, `LEFT JOIN` columns) with an explicit sqlx type override, or the empty-DB prepare infers the wrong nullability.
- **Frontend `.unit.test.ts`** run locally with `cd frontend && pnpm exec vitest run <path>`.
- **Frontend `.test.tsx`** are browser-project tests that run in Chromium in CI only (they do not run on this NixOS box). Author them, commit them, and rely on CI to execute. They stub `window.fetch` and use `renderWithProviders` + `buildUser` (never `vi.spyOn` on ESM exports).
- **No em-dashes in any UI copy** (use commas/periods/parens).
- Commit after each task with the message shown.

## File Structure

**Backend (`crates/syllabus-tracker/`)**
- `src/db/camps.rs` — add `CampSummary` struct + `list_camp_summaries_for_student` (enriched query). Existing `Camp`/`list_camps_for_student` stay for internal callers.
- `src/camps/routes.rs` — `api_list_camps` returns `Vec<CampSummary>`.
- `src/db/matches.rs` — `create_match` and `link_match_technique` resolve and stamp `camp_id` on their activity emits. Delete `StudentMatch` + `list_matches_for_student`.
- `src/competitions/routes.rs` — delete `StudentMatchesResponse` + `api_student_matches`.
- `src/main.rs` — drop the `api_student_matches` import + mount.
- `src/test/camps.rs`, `src/test/matches.rs` — coverage.

**Frontend (`frontend/src/`)**
- `lib/api.ts` — add `CampSummary` interface; `getCampsForStudent` returns `CampSummary[]`; delete `StudentMatch` + `getStudentMatches`.
- `components/camp-summary-card.tsx` — new presentational trailhead card.
- `lib/view-context.ts` — match activity rows resolve to the owning camp.
- `app/student-profile/page.tsx` — remove Spaces section + `HubLink`; add Camps preview section.
- `lib/queries.ts`, `lib/query-keys.ts`, `lib/mutations.ts`, `App.tsx` — remove the standalone-matches plumbing.
- `app/student-matches/` — deleted.
- Tests: `lib/view-context.unit.test.ts`, `lib/activity-line.unit.test.ts`, new `app/student-profile/student-profile-camps.test.tsx`; delete `app/student-matches/student-matches.test.tsx`.

---

## Task 1: Enriched camp-summary list query (backend)

**Files:**
- Modify: `crates/syllabus-tracker/src/db/camps.rs` (after `list_camps_for_student`, ends ~line 160)
- Test: `crates/syllabus-tracker/src/test/camps.rs`

- [ ] **Step 1: Write the failing test**

Add to `crates/syllabus-tracker/src/test/camps.rs` (adapt the existing helpers in that file for seeding a student/coach/camp; reuse whatever `setup`/insert helpers the file already defines):

```rust
#[sqlx::test(migrations = "./migrations")]
async fn camp_summary_carries_counts_and_competition_name(pool: SqlitePool) {
    // Seed a coach + student, a competition, a camp linked to it, one camp
    // technique, and one camp video. (Use the file's existing seed helpers.)
    let (coach, student) = seed_coach_and_student(&pool).await;
    let comp_id = create_competition(&pool, "IBJJF Worlds", coach).await;
    let camp_id = create_camp(
        &pool,
        crate::db::camps::NewCamp {
            student_id: student,
            coach_id: coach,
            name: "Worlds Prep".into(),
            description: Some("block".into()),
            references_camp_id: None,
        },
    )
    .await
    .unwrap();
    link_camp_to_competition(&pool, camp_id, comp_id).await; // existing helper / promote fn
    add_camp_technique(&pool, camp_id, seed_technique(&pool, coach).await, coach).await;
    insert_camp_video(&pool, camp_id, student).await; // existing video seed helper

    let summaries =
        crate::db::camps::list_camp_summaries_for_student(&pool, student, true)
            .await
            .unwrap();

    let s = summaries.iter().find(|s| s.id == camp_id).expect("camp present");
    assert_eq!(s.competition_name.as_deref(), Some("IBJJF Worlds"));
    assert_eq!(s.technique_count, 1);
    assert_eq!(s.video_count, 1);
    assert!(s.last_activity_at.is_some(), "camp_created activity sets last_activity_at");
}
```

> If the test file lacks one of the seed helpers named above, use the closest existing helper (the file already exercises camps, techniques, and camp videos) and inline the missing insert with a raw `sqlx::query!`. Keep the four assertions exactly.

- [ ] **Step 2: Run it to verify it fails**

Run: `nix develop .#ci --command bash -c "cd /home/matt/dev/sillybus && SQLX_OFFLINE=true cargo nextest run -p syllabus-tracker camp_summary_carries_counts_and_competition_name"`
Expected: FAIL to compile (`list_camp_summaries_for_student` and `CampSummary` do not exist).

- [ ] **Step 3: Add the struct and query**

In `crates/syllabus-tracker/src/db/camps.rs`, add after `list_camps_for_student`:

```rust
#[derive(Debug, Clone, Serialize)]
pub struct CampSummary {
    pub id: i64,
    pub student_id: i64,
    pub coach_id: i64,
    pub name: String,
    pub description: Option<String>,
    pub created_at: NaiveDateTime,
    pub archived_at: Option<NaiveDateTime>,
    pub competition_id: Option<i64>,
    pub references_camp_id: Option<i64>,
    /// Name of the linked competition, resolved via LEFT JOIN. None when unlinked.
    pub competition_name: Option<String>,
    pub technique_count: i64,
    pub video_count: i64,
    /// Most recent activity timestamp for this camp (MAX over the activity
    /// table by camp_id). None when the camp has no activity rows.
    pub last_activity_at: Option<NaiveDateTime>,
}

/// Enriched camp list for the profile/list surfaces: bare camp columns plus
/// competition name, technique/video counts, and last-activity. Ordered active
/// first, then by last activity (falling back to creation) descending.
#[instrument(skip(pool))]
pub async fn list_camp_summaries_for_student(
    pool: &Pool<Sqlite>,
    student_id: i64,
    include_archived: bool,
) -> Result<Vec<CampSummary>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT
               c.id AS "id!: i64", c.student_id AS "student_id!: i64",
               c.coach_id AS "coach_id!: i64", c.name, c.description,
               c.created_at AS "created_at!: NaiveDateTime",
               c.archived_at AS "archived_at?: NaiveDateTime",
               c.competition_id AS "competition_id?: i64",
               c.references_camp_id AS "references_camp_id?: i64",
               comp.name AS "competition_name?: String",
               (SELECT COUNT(*) FROM camp_techniques ct WHERE ct.camp_id = c.id)
                   AS "technique_count!: i64",
               (SELECT COUNT(*) FROM videos v WHERE v.camp_id = c.id)
                   AS "video_count!: i64",
               (SELECT MAX(a.occurred_at) FROM activity a WHERE a.camp_id = c.id)
                   AS "last_activity_at?: NaiveDateTime"
           FROM camps c
           LEFT JOIN competitions comp ON comp.id = c.competition_id
           WHERE c.student_id = ? AND (? OR c.archived_at IS NULL)
           ORDER BY (c.archived_at IS NOT NULL),
                    COALESCE(
                        (SELECT MAX(a.occurred_at) FROM activity a WHERE a.camp_id = c.id),
                        c.created_at
                    ) DESC"#,
        student_id,
        include_archived,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| CampSummary {
            id: r.id,
            student_id: r.student_id,
            coach_id: r.coach_id,
            name: r.name,
            description: r.description,
            created_at: r.created_at,
            archived_at: r.archived_at,
            competition_id: r.competition_id,
            references_camp_id: r.references_camp_id,
            competition_name: r.competition_name,
            technique_count: r.technique_count,
            video_count: r.video_count,
            last_activity_at: r.last_activity_at,
        })
        .collect())
}
```

- [ ] **Step 4: Regenerate sqlx offline metadata**

Run: `nix develop .#ci --command bash -c "cd /home/matt/dev/sillybus && just sqlx-prepare"`
Expected: `.sqlx/` updated, no errors.

- [ ] **Step 5: Run the test to verify it passes**

Run: `nix develop .#ci --command bash -c "cd /home/matt/dev/sillybus && SQLX_OFFLINE=true cargo nextest run -p syllabus-tracker camp_summary_carries_counts_and_competition_name"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/camps.rs crates/syllabus-tracker/src/test/camps.rs .sqlx
git commit -m "feat(camps): enriched camp-summary list query (competition name, counts, last activity)"
```

---

## Task 2: Serve `CampSummary` from `GET /api/camps`

**Files:**
- Modify: `crates/syllabus-tracker/src/camps/routes.rs` (`CampListResponse` ~line 81, `api_list_camps` ~line 137, imports ~line 10)

- [ ] **Step 1: Point the response type at `CampSummary`**

In the `use` for `crate::db::camps::{...}` add `CampSummary` and `list_camp_summaries_for_student`; you may leave `Camp`/`list_camps_for_student` imported (still used by `api_get_camp` and others). Change:

```rust
#[derive(Serialize)]
pub struct CampListResponse {
    pub camps: Vec<CampSummary>,
}
```

And the handler body:

```rust
#[instrument(skip(pool, user))]
#[get("/camps?<student_id>")]
pub async fn api_list_camps(
    user: User,
    student_id: i64,
    pool: &State<Pool<Sqlite>>,
) -> Result<Json<CampListResponse>, Status> {
    let is_coach = user.has_permission(Permission::ViewAllStudents);
    if !is_coach && student_id != user.id {
        return Err(Status::Forbidden);
    }
    let camps = list_camp_summaries_for_student(pool.inner(), student_id, true)
        .await
        .map_err(Status::from)?;
    Ok(Json(CampListResponse { camps }))
}
```

- [ ] **Step 2: Verify backend builds + full backend test suite passes**

Run: `nix develop .#ci --command bash -c "cd /home/matt/dev/sillybus && just test-backend"`
Expected: PASS (all tests; existing camps route tests now see the enriched payload). If a route test deserializes the list into a bare `Camp`, update it to `CampSummary`.

- [ ] **Step 3: Commit**

```bash
git add crates/syllabus-tracker/src/camps/routes.rs
git commit -m "feat(camps): GET /api/camps returns enriched camp summaries"
```

---

## Task 3: Stamp `camp_id` on match activity (backend)

So match activity rows can deep-link to the owning camp.

**Files:**
- Modify: `crates/syllabus-tracker/src/db/matches.rs` (`create_match` ~line 180, `link_match_technique` ~line 359)
- Test: `crates/syllabus-tracker/src/test/matches.rs`

- [ ] **Step 1: Write the failing test**

Add to `crates/syllabus-tracker/src/test/matches.rs` (reuse the file's existing seed helpers that create a registration with a linked camp):

```rust
#[sqlx::test(migrations = "./migrations")]
async fn match_logged_activity_carries_camp_id(pool: SqlitePool) {
    // Seed: coach, student, competition, camp linked to that competition,
    // and a registration for (student, competition). Use existing helpers.
    let ctx = seed_competition_camp_with_registration(&pool).await;

    let match_id = crate::db::matches::create_match(
        &pool,
        ctx.registration_id,
        crate::db::matches::MatchResult::Win,
        None,
        None,
        None,
        ctx.coach_id,
    )
    .await
    .unwrap();

    let camp_id_on_activity: Option<i64> = sqlx::query_scalar!(
        r#"SELECT camp_id AS "camp_id?: i64" FROM activity
           WHERE verb = 'match_logged' AND match_id = ?"#,
        match_id
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(camp_id_on_activity, Some(ctx.camp_id));
}
```

> If `seed_competition_camp_with_registration` does not already exist, build the fixture inline from the helpers the file does have (it already creates registrations and matches). The assertion (activity `camp_id` equals the camp linked to the registration's competition) is the contract.

- [ ] **Step 2: Run it to verify it fails**

Run: `nix develop .#ci --command bash -c "cd /home/matt/dev/sillybus && SQLX_OFFLINE=true cargo nextest run -p syllabus-tracker match_logged_activity_carries_camp_id"`
Expected: FAIL (`camp_id_on_activity` is `None`).

- [ ] **Step 3: Resolve and stamp `camp_id` in `create_match`**

In `create_match`, after the `reg` lookup and before the `INSERT INTO matches`, add a camp lookup; then build the activity with an optional `.camp(...)`:

```rust
    // Resolve the student's camp for this competition (if any) so the match's
    // activity deep-links to the owning camp.
    let camp_id = sqlx::query_scalar!(
        r#"SELECT id AS "id!: i64" FROM camps
           WHERE student_id = ? AND competition_id = ? LIMIT 1"#,
        reg.student_id,
        reg.competition_id,
    )
    .fetch_optional(&mut *tx)
    .await?;
```

Replace the existing `emit(... NewActivity::new(Verb::MatchLogged, ...) ...)` block with:

```rust
    let mut activity = NewActivity::new(Verb::MatchLogged, created_by_id)
        .target_student(reg.student_id)
        .match_ref(id)
        .competition(reg.competition_id)
        .context_kind("competition");
    if let Some(cid) = camp_id {
        activity = activity.camp(cid);
    }
    emit(&mut tx, activity).await?;
```

- [ ] **Step 4: Do the same in `link_match_technique`**

After its `reg` lookup (the JOIN that yields `reg.student_id` and `reg.competition_id`), add the same camp lookup (against `&mut *tx`), and rewrite its emit (inside the `if affected > 0` block) to:

```rust
        let mut activity = NewActivity::new(Verb::MatchTechniqueLinked, by_id)
            .target_student(reg.student_id)
            .match_ref(match_id)
            .technique(technique_id)
            .competition(reg.competition_id)
            .context_kind("competition");
        if let Some(cid) = camp_id {
            activity = activity.camp(cid);
        }
        emit(&mut tx, activity).await?;
```

- [ ] **Step 5: Run the test + full backend suite**

Run: `nix develop .#ci --command bash -c "cd /home/matt/dev/sillybus && just test-backend"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/db/matches.rs crates/syllabus-tracker/src/test/matches.rs
git commit -m "feat(matches): stamp owning camp_id on match activity for deep-linking"
```

---

## Task 4: Remove the cross-camp matches aggregate (backend)

**Files:**
- Modify: `crates/syllabus-tracker/src/db/matches.rs` (delete `StudentMatch` ~lines 99-116 and `list_matches_for_student` ~lines 460-510)
- Modify: `crates/syllabus-tracker/src/competitions/routes.rs` (delete `StudentMatchesResponse` ~line 121 and `api_student_matches` ~lines 569-584; drop `StudentMatch` + `list_matches_for_student` from the `use` at ~lines 29-32)
- Modify: `crates/syllabus-tracker/src/main.rs` (drop `api_student_matches` import ~line 72 and its mount ~line 422)
- Modify: `crates/syllabus-tracker/src/test/matches.rs` (delete any test exercising `list_matches_for_student` / the `/students/<id>/matches` route)

- [ ] **Step 1: Delete the symbols**

Remove `StudentMatch` and `list_matches_for_student` from `db/matches.rs`. Remove `StudentMatchesResponse`, `api_student_matches`, and the now-unused imports from `competitions/routes.rs`. Remove the import and mount line in `main.rs`. Delete the matching test(s) in `test/matches.rs`.

- [ ] **Step 2: Verify it compiles and the suite passes**

Run: `nix develop .#ci --command bash -c "cd /home/matt/dev/sillybus && just test-backend"`
Expected: PASS, no unused-import or dead-code warnings for the removed items.

- [ ] **Step 3: Commit**

```bash
git add crates/syllabus-tracker/src
git commit -m "refactor(matches): drop standalone cross-camp matches aggregate + route"
```

---

## Task 5: Frontend types — add `CampSummary`, drop `StudentMatch`

**Files:**
- Modify: `frontend/src/lib/api.ts` (`Camp` block ~line 1983; `getCampsForStudent` ~line 2016; `StudentMatch` ~line 2218; `getStudentMatches` ~line 2418)

- [ ] **Step 1: Add the `CampSummary` interface**

After the `CampDetail` interface (~line 2014) add:

```ts
/** Row from GET /api/camps (enriched list payload). */
export interface CampSummary {
  id: number;
  student_id: number;
  coach_id: number;
  name: string;
  description: string | null;
  created_at: string;
  archived_at: string | null;
  competition_id: number | null;
  references_camp_id: number | null;
  competition_name: string | null;
  technique_count: number;
  video_count: number;
  last_activity_at: string | null;
}
```

- [ ] **Step 2: Retype `getCampsForStudent`**

```ts
export async function getCampsForStudent(studentId: number): Promise<CampSummary[]> {
  const res = await fetch(`/api/camps?student_id=${studentId}`, {
    credentials: "include",
  });
  if (!res.ok) throw res;
  return ((await res.json()) as { camps: CampSummary[] }).camps;
}
```

- [ ] **Step 3: Delete `StudentMatch` + `getStudentMatches`**

Remove the `StudentMatch` interface (~2217-2222) and the `getStudentMatches` function (~2417-2424). Leave `Match`, `MatchResult`, `MatchMethod`, `MatchTechnique` intact (camp detail still uses them).

- [ ] **Step 4: Typecheck**

Run: `cd /home/matt/dev/sillybus/frontend && pnpm exec tsc -b`
Expected: errors ONLY in files still importing the removed symbols (`student-matches/page.tsx`, `queries.ts`) — fixed in Tasks 6 and 8. Do not fix unrelated pre-existing errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(camps): add CampSummary type; drop StudentMatch aggregate type"
```

---

## Task 6: `CampSummaryCard` component

**Files:**
- Create: `frontend/src/components/camp-summary-card.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { Link } from "react-router-dom";
import { Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatRelativeShort } from "@/lib/dates";
import type { CampSummary } from "@/lib/api";

/**
 * A trailhead card for a single camp, shown on the student profile (and the
 * full camps list). The whole card links to the camp detail page. Presentational
 * only: no interaction beyond the link.
 */
export function CampSummaryCard({ camp }: { camp: CampSummary }) {
  const techLabel = `${camp.technique_count} ${camp.technique_count === 1 ? "technique" : "techniques"}`;
  const videoLabel = `${camp.video_count} ${camp.video_count === 1 ? "video" : "videos"}`;
  return (
    <Link
      to={`/camps/${camp.id}`}
      className="block rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/40"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{camp.name}</span>
        {camp.competition_name && (
          <Badge variant="outline" className="gap-1 text-xs">
            <Trophy className="h-3 w-3" aria-hidden />
            {camp.competition_name}
          </Badge>
        )}
      </div>
      {camp.description && (
        <p className="mt-1 truncate text-sm text-muted-foreground">{camp.description}</p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {techLabel} · {videoLabel}
        {camp.last_activity_at ? ` · updated ${formatRelativeShort(camp.last_activity_at)}` : ""}
      </p>
    </Link>
  );
}
```

> Verify `formatRelativeShort` is exported from `@/lib/dates` (it is used by `activity-feed-list.tsx`). If its signature differs, match the call site there.

- [ ] **Step 2: Typecheck**

Run: `cd /home/matt/dev/sillybus/frontend && pnpm exec tsc -b`
Expected: no new errors in `camp-summary-card.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/camp-summary-card.tsx
git commit -m "feat(camps): add CampSummaryCard trailhead component"
```

---

## Task 7: Repoint match activity deep-links to the owning camp

**Files:**
- Modify: `frontend/src/lib/view-context.ts` (`ViewContext` ~line 22, `viewContextHref` match arm ~line 44, `rowToViewContext` match branch ~lines 111-121)
- Test: `frontend/src/lib/view-context.unit.test.ts` (~lines 443-474), `frontend/src/lib/activity-line.unit.test.ts` (~lines 813-838)

- [ ] **Step 1: Update the unit tests to expect the camp href**

In `view-context.unit.test.ts`, the two tests at ~443 and ~460 build a `match_logged` / `match_technique_linked` row. Add `camp_id: 7` to those row fixtures and change both expectations:

```ts
// was: expect(viewContextHref(ctx!)).toBe("/student/3/matches?focus=match:11");
expect(viewContextHref(ctx!)).toBe("/camps/7");
```

In `activity-line.unit.test.ts`, the two tests at ~813 and ~827: add `camp_id: 7` to the row and change both:

```ts
// was: expect(result.href).toBe("/student/3/matches?focus=match:11");
expect(result.href).toBe("/camps/7");
```

(Leave the `entity-ref` `refToken`/`parseFocusToken` `match:11` tests at ~388 unchanged — the match token type still exists.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /home/matt/dev/sillybus/frontend && pnpm exec vitest run src/lib/view-context.unit.test.ts src/lib/activity-line.unit.test.ts`
Expected: FAIL (still produces `/student/3/matches?focus=match:11`).

- [ ] **Step 3: Change the `match` ViewContext to carry the camp**

In `view-context.ts`, change the union member:

```ts
  | { kind: "match"; camp: EntityRef; match: EntityRef };
```

Change the `viewContextHref` arm (scroll-to-match is deferred to Chunk B, so just open the camp):

```ts
    case "match": {
      return `/camps/${ctx.camp.id}`;
    }
```

Change the match branch in `rowToViewContext` (inside the `context_kind === "competition"` block) to require `camp_id` and return the camp-bearing match context:

```ts
    if (
      (row.verb === "match_logged" || row.verb === "match_technique_linked") &&
      row.match_id != null &&
      row.camp_id != null
    ) {
      return {
        kind: "match",
        camp: { type: "camp", id: row.camp_id },
        match: { type: "match", id: row.match_id },
      };
    }
```

(When `camp_id` is null the row now falls through to the existing competition-page branch below it, which is the correct fallback for a registration with no camp.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /home/matt/dev/sillybus/frontend && pnpm exec vitest run src/lib/view-context.unit.test.ts src/lib/activity-line.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/view-context.ts frontend/src/lib/view-context.unit.test.ts frontend/src/lib/activity-line.unit.test.ts
git commit -m "feat(matches): deep-link match activity to the owning camp"
```

---

## Task 8: Profile page — remove Spaces, add Camps preview section

**Files:**
- Modify: `frontend/src/app/student-profile/page.tsx`
- Test: create `frontend/src/app/student-profile/student-profile-camps.test.tsx`

- [ ] **Step 1: Write the failing browser test** (runs in CI)

Create `frontend/src/app/student-profile/student-profile-camps.test.tsx`:

```tsx
/**
 * Student profile "Camps" section (browser project). Mocks campsUiEnabled on so
 * the gated section renders, stubs the camps endpoint, and asserts the card
 * renders and links to the camp, and that no standalone "Matches" link exists.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";

vi.mock("@/lib/features", () => ({ campsUiEnabled: true }));

import StudentProfilePage from "./page";
import { buildUser, renderWithProviders } from "@/test/render";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch() {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes("/api/camps?student_id=")) {
      return Promise.resolve(
        jsonResponse({
          camps: [
            {
              id: 9,
              student_id: 42,
              coach_id: 1,
              name: "Worlds Prep",
              description: "block",
              created_at: new Date().toISOString(),
              archived_at: null,
              competition_id: 3,
              references_camp_id: null,
              competition_name: "IBJJF Worlds",
              technique_count: 12,
              video_count: 4,
              last_activity_at: new Date().toISOString(),
            },
          ],
        }),
      );
    }
    if (url.includes("/activity_feed")) return Promise.resolve(jsonResponse([]));
    return Promise.resolve(jsonResponse({}));
  });
}

describe("StudentProfilePage / camps section", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;
  afterEach(() => fetchSpy?.mockRestore());

  test("renders camp cards and no standalone matches link", async () => {
    fetchSpy = vi.spyOn(window, "fetch").mockImplementation(stubFetch());
    const student = buildUser({ id: 42, role: "student" });
    renderWithProviders(
      <Routes>
        <Route path="/student/:id" element={<StudentProfilePage />} />
      </Routes>,
      { user: student, initialEntries: ["/student/42"] },
    );

    const card = await screen.findByText("Worlds Prep");
    expect(card.closest("a")).toHaveAttribute("href", "/camps/9");
    expect(screen.queryByRole("link", { name: /matches/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Edit the profile page**

In `frontend/src/app/student-profile/page.tsx`:

(a) Imports: from the `lucide-react` import drop `BookOpen`, `ChevronRight`, `Medal`, `UserRound` (keep `Dumbbell`, `Plus`, and the rest). Remove `import { cn } from "@/lib/utils";`. Add:

```ts
import { CampSummaryCard } from "@/components/camp-summary-card";
```

(b) Delete the local `HubLink` function (the whole `function HubLink({ ... }) { ... }` block near the end).

(c) In `ProfileHub`, after `const previewPinned = ...` (~line 192) add:

```tsx
  const previewCamps = (campsQuery.data ?? []).filter((c) => !c.archived_at).slice(0, 5);
```

and add the query near the other queries (~after line 173):

```tsx
  const campsQuery = useCampsForStudent(campsUiEnabled ? studentId : undefined);
```

(d) Replace the entire Spaces `<section>` (the `{(isOwnView || campsUiEnabled) && ( <section ...> ... </section> )}` block, ~lines 238-287) with the Camps section:

```tsx
      {campsUiEnabled && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Link
              to={`/student/${studentId}/camps`}
              className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
            >
              <Dumbbell className="h-3.5 w-3.5" aria-hidden />
              Camps
            </Link>
            {canCreateCamp && (
              <Dialog open={createCampOpen} onOpenChange={setCreateCampOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-1.5">
                    <Plus className="h-4 w-4" aria-hidden />
                    <span>Add camp</span>
                  </Button>
                </DialogTrigger>
                <CreateCampDialog
                  studentId={studentId}
                  studentName={displayName}
                  onCreated={(id) => {
                    setCreateCampOpen(false);
                    navigate(`/camps/${id}`);
                  }}
                />
              </Dialog>
            )}
          </div>
          {campsQuery.isLoading ? (
            <div className="rounded-lg border border-border bg-card px-4 py-4">
              <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            </div>
          ) : previewCamps.length === 0 ? (
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <EmptyState
                icon={Dumbbell}
                title="No camps yet"
                description={
                  isOwnView
                    ? "Your coach can set up a training camp for you."
                    : "Set up a camp to plan this student's training block."
                }
              />
            </div>
          ) : (
            <div className="space-y-2">
              {previewCamps.map((c) => (
                <CampSummaryCard key={c.id} camp={c} />
              ))}
            </div>
          )}
        </section>
      )}
```

> Placement note: this sits where the Spaces section was, i.e. above the Syllabi section, per the spec.

- [ ] **Step 3: Typecheck**

Run: `cd /home/matt/dev/sillybus/frontend && pnpm exec tsc -b`
Expected: no errors in `page.tsx` (no unused-import errors for the removed icons/`cn`).

- [ ] **Step 4: Note on running the browser test**

The `.test.tsx` runs in CI (Chromium). It cannot run on this box; rely on CI. Confirm the existing `student-profile-activity.test.tsx` still type-checks (it does not reference Spaces).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/student-profile/page.tsx frontend/src/app/student-profile/student-profile-camps.test.tsx
git commit -m "feat(profile): replace Spaces list with inline Camps section; drop matches link"
```

---

## Task 9: Delete the standalone matches page + plumbing (frontend)

**Files:**
- Delete: `frontend/src/app/student-matches/page.tsx`, `frontend/src/app/student-matches/student-matches.test.tsx`
- Modify: `frontend/src/App.tsx` (lazy import ~line 58; route ~lines 381-392)
- Modify: `frontend/src/lib/queries.ts` (`getStudentMatches` import ~line 43; `useStudentMatches` ~lines 476-481)
- Modify: `frontend/src/lib/query-keys.ts` (`studentMatches` ~lines 94-95)
- Modify: `frontend/src/lib/mutations.ts` (two `qk.studentMatches` invalidations ~lines 1657, 1676)

- [ ] **Step 1: Delete the page + test**

```bash
git rm frontend/src/app/student-matches/page.tsx frontend/src/app/student-matches/student-matches.test.tsx
```

- [ ] **Step 2: Remove the route + lazy import in `App.tsx`**

Delete the `const StudentMatchesPage = lazy(...)` line (~58) and the entire `<Route path="/student/:id/matches" ... />` block (~381-392).

- [ ] **Step 3: Remove the query plumbing**

In `queries.ts`: drop `getStudentMatches` from the `@/lib/api` import (~line 43) and delete the `useStudentMatches` function (~476-481).
In `query-keys.ts`: delete the `studentMatches` key (~94-95).
In `mutations.ts`: delete the two `qc.invalidateQueries({ queryKey: qk.studentMatches(...) })` lines (~1657, 1676) and the explanatory comment at ~1632 if it now dangles. Keep the sibling `registrationMatches` invalidations (camp detail depends on them).

- [ ] **Step 4: Typecheck + run all frontend unit tests**

Run: `cd /home/matt/dev/sillybus/frontend && pnpm exec tsc -b && pnpm exec vitest run src/lib`
Expected: PASS, no references to removed symbols.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src
git commit -m "refactor(matches): remove standalone matches page, route, and query plumbing"
```

---

## Task 10: Full verification

- [ ] **Step 1: Backend**

Run: `nix develop .#ci --command bash -c "cd /home/matt/dev/sillybus && just verify"`
Expected: lint + backend tests + unused-deps all green. (`just verify` = `lint test unused-deps`; frontend test recipe is a stub, so run frontend checks below.)

- [ ] **Step 2: Frontend typecheck + lint + unit tests**

Run: `cd /home/matt/dev/sillybus/frontend && pnpm exec tsc -b && pnpm exec eslint . && pnpm exec vitest run src/lib`
Expected: all green.

- [ ] **Step 3: Confirm offline sqlx metadata is committed**

Run: `git status --short .sqlx`
Expected: clean (Task 1 already committed `.sqlx`). If dirty, run `nix develop .#ci --command bash -c "cd /home/matt/dev/sillybus && just sqlx-prepare"`, then commit.

- [ ] **Step 4: Manual smoke (optional, dev stack)**

With `campsUiEnabled` on: open a student profile, confirm the Camps section shows up to 5 active cards (competition chip, technique/video counts, updated time), the section title links to `/student/:id/camps`, "Add camp" works for a coach, and there is no Spaces or Matches link. Click a `match_logged` activity row and confirm it lands on the owning camp.

---

## Self-Review notes

- **Spec coverage:** Spaces removal (Task 8), Camps preview section + Add camp + See-all (Task 8), enriched card (Task 6) + payload (Tasks 1-2, 5), retire matches page/route/aggregate (Tasks 4, 9), match deep-link repoint (Tasks 3, 7). All spec sections map to a task.
- **Type consistency:** `CampSummary` is defined once backend (Task 1) and once frontend (Task 5) with matching fields; `list_camp_summaries_for_student` is the name used in Tasks 1 and 2; the `match` ViewContext member carries `camp` consistently in Task 7 (union, `viewContextHref`, `rowToViewContext`).
- **Deferred (Chunk B), intentionally not here:** scroll-to-match anchor on the camp page, match titles, mark-complete, score/win-condition/duration/finishing-sub, threads on matches.
