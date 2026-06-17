# Profile & Syllabus UI Tweaks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote syllabus-detail actions to buttons, add admin/coach account-management + archive to the student profile, turn profile link-rows into preview sections, and stop the dashboard feed merging activity across different students.

**Architecture:** Mostly frontend. One small backend addition: a coach-accessible `POST /student/:id/archive` endpoint mirroring the existing graduate endpoint. A new shared `AccountDialog` consolidates account UX that already exists (admin page dialogs + the lost legacy `student-techniques` reset/claim flow + self-edit forms). A shared `SyllabusAssignmentRow` is extracted so the profile preview and the syllabi list render identically.

**Tech Stack:** Rust + Rocket + sqlx (backend), React 19 + Vite + shadcn/ui + Tailwind v4, react-hook-form + Zod + TracedForm, TanStack Query, vitest (frontend).

**Verify gate:** `nix develop .#ci --command just verify` (offline Rust build + clippy + cargo test, frontend lint + vitest unit). Rust tests run via `cargo test -p syllabus-tracker`. Browser `.test.tsx` files only run in CI (not on this NixOS box) — do not attempt to run them locally.

---

## File Structure

**Backend**
- Modify `crates/syllabus-tracker/src/api.rs` — add `api_archive_student` handler.
- Modify `crates/syllabus-tracker/src/main.rs` — register the route.
- Modify `crates/syllabus-tracker/src/test/api.rs` — add archive endpoint tests.

**Frontend (data layer)**
- Modify `frontend/src/lib/api.ts` — add `archiveStudent`.
- Modify `frontend/src/lib/mutations.ts` — add `useArchiveStudent`.
- Modify `frontend/src/lib/activity-coalesce.ts` — per-student `surfaceKey`.
- Modify `frontend/src/lib/activity-coalesce.unit.test.ts` — coverage.

**Frontend (components)**
- Create `frontend/src/app/student-syllabi/components/syllabus-assignment-row.tsx` — shared row + chips.
- Create `frontend/src/components/account-dialog.tsx` — shared account-management dialog.

**Frontend (pages)**
- Modify `frontend/src/app/student-syllabi/page.tsx` — consume shared row.
- Modify `frontend/src/app/student-syllabi/[syllabusId]/page.tsx` — buttons + manage account.
- Modify `frontend/src/app/student-profile/page.tsx` — preview sections + account/archive.

---

## Task 1: Backend coach-accessible archive endpoint

**Files:**
- Modify: `crates/syllabus-tracker/src/api.rs` (add handler after `api_set_student_graduated`, ~line 1013)
- Modify: `crates/syllabus-tracker/src/main.rs` (import ~line 30-34, route list ~line 319)
- Test: `crates/syllabus-tracker/src/test/api.rs`

- [ ] **Step 1: Write the failing test**

Add to `crates/syllabus-tracker/src/test/api.rs` near `test_graduate_student_keeps_edit_access` (after line 1180). This mirrors the graduate test's helpers (`TestDbBuilder`, `setup_test_client`, `login_test_user`, `UserData`).

```rust
    #[rocket::async_test]
    async fn test_coach_can_archive_student() {
        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .student("student_user", Some("Student User"))
            .build()
            .await
            .expect("Failed to build test DB");

        let (client, test_db) = setup_test_client(test_db).await;
        let student_id = test_db.user_id("student_user").expect("Student not found");
        let coach_cookies = login_test_user(&client, "coach_user", "password123").await;

        // Archive via the dedicated coach endpoint.
        let resp = client
            .post(format!("/api/student/{}/archive", student_id))
            .cookies(coach_cookies.clone())
            .header(ContentType::JSON)
            .body(json!({ "archived": true }).to_string())
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);

        // Archived student shows up when include_archived=true with archived flag.
        let listed = client
            .get("/api/students?include_archived=true")
            .cookies(coach_cookies.clone())
            .dispatch()
            .await;
        let body = listed.into_string().await.unwrap();
        let students: Vec<UserData> = serde_json::from_str(&body).unwrap();
        let s = students
            .iter()
            .find(|s| s.id == student_id)
            .expect("archived student missing from list");
        assert!(s.archived, "archived flag should be set");

        // Un-archive clears the flag.
        let resp = client
            .post(format!("/api/student/{}/archive", student_id))
            .cookies(coach_cookies)
            .header(ContentType::JSON)
            .body(json!({ "archived": false }).to_string())
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);
    }

    #[rocket::async_test]
    async fn test_coach_cannot_archive_non_student() {
        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .coach("other_coach", Some("Other Coach"))
            .build()
            .await
            .expect("Failed to build test DB");

        let (client, test_db) = setup_test_client(test_db).await;
        let other_id = test_db.user_id("other_coach").expect("Coach not found");
        let coach_cookies = login_test_user(&client, "coach_user", "password123").await;

        let resp = client
            .post(format!("/api/student/{}/archive", other_id))
            .cookies(coach_cookies)
            .header(ContentType::JSON)
            .body(json!({ "archived": true }).to_string())
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::BadRequest);
    }
```

If `TestDbBuilder` has no `.coach(...)` chained twice helper, confirm by reading the existing builder in `crates/syllabus-tracker/src/test/utils.rs`; the graduate test already uses `.coach(...)` and `.student(...)`, and `.coach(...)` twice is valid (each call adds a user).

- [ ] **Step 2: Run tests to verify they fail**

Run: `nix develop .#ci --command cargo test -p syllabus-tracker test_coach_can_archive_student test_coach_cannot_archive_non_student`
Expected: FAIL — 404 (route not mounted) so status assertions fail.

- [ ] **Step 3: Add the handler**

In `crates/syllabus-tracker/src/api.rs`, immediately after `api_set_student_graduated` (ends ~line 1013), add. This copies the graduate handler's shape exactly: `ViewAllStudents` permission, student-only target, reuses `set_user_archived` (already imported at line 36) and `get_user`.

```rust
#[derive(Deserialize, Clone)]
pub struct ArchiveRequest {
    archived: bool,
}

/// Coach-accessible endpoint to archive / un-archive a student.
/// Distinct from `/admin/users/<id>` which is admin-only.
#[post("/student/<id>/archive", data = "<body>")]
pub async fn api_archive_student(
    id: i64,
    body: Json<ArchiveRequest>,
    user: User,
    db: &State<Pool<Sqlite>>,
) -> ApiResult<Status> {
    user.require_permission(Permission::ViewAllStudents)?;

    let target = get_user(db, id).await?;
    if !matches!(target.role, crate::auth::Role::Student) {
        return Err(Status::BadRequest.into());
    }

    set_user_archived(db, id, body.archived).await?;
    Ok(Status::Ok)
}
```

- [ ] **Step 4: Register the route**

In `crates/syllabus-tracker/src/main.rs`, add `api_archive_student` to the `use crate::api::{...}` import block (alongside `api_set_student_graduated`, ~line 30) and to the `routes![...]` list (after `api_set_student_graduated`, ~line 319).

```rust
                api_set_student_graduated,
                api_archive_student,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `nix develop .#ci --command cargo test -p syllabus-tracker test_coach_can_archive_student test_coach_cannot_archive_non_student`
Expected: PASS (both).

- [ ] **Step 6: Commit**

```bash
git add crates/syllabus-tracker/src/api.rs crates/syllabus-tracker/src/main.rs crates/syllabus-tracker/src/test/api.rs
git commit -m "feat(api): add coach-accessible student archive endpoint"
```

---

## Task 2: Frontend archive api fn + mutation

**Files:**
- Modify: `frontend/src/lib/api.ts` (near `setStudentGraduated`, ~line 715)
- Modify: `frontend/src/lib/mutations.ts` (import block ~line 26; new hook after `useSetStudentGraduated`)

- [ ] **Step 1: Add the api function**

In `frontend/src/lib/api.ts`, after `setStudentGraduated` (ends ~line 725):

```ts
export async function archiveStudent(
  studentId: number,
  archived: boolean,
): Promise<Response> {
  return await fetch(`/api/student/${studentId}/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archived }),
    credentials: "include",
  });
}
```

- [ ] **Step 2: Add the mutation**

In `frontend/src/lib/mutations.ts`, add `archiveStudent` to the `from "./api"` import block (alphabetical, near `approveUser`/`assignTechniquesToStudent`). Then add this hook after `useSetStudentGraduated` (the closing `}` of that hook). It mirrors `useToggleUserArchived`'s optimistic pattern but also invalidates the single-student key and student feeds, and is keyed by `studentId`.

```ts
// Optimistic archive toggle used on the student profile (coach + admin path).
export function useArchiveStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { studentId: number; archived: boolean }) =>
      unwrap(await archiveStudent(vars.studentId, vars.archived)),
    onMutate: async ({ studentId, archived }) => {
      await qc.cancelQueries({ queryKey: qk.users() });
      const previousUsers = qc.getQueryData<User[]>(qk.users());
      qc.setQueryData<User[]>(qk.users(), (prev) =>
        prev?.map((u) => (u.id === studentId ? { ...u, archived } : u)),
      );
      return { previousUsers };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previousUsers) qc.setQueryData(qk.users(), ctx.previousUsers);
    },
    onSettled: (_res, _err, vars) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.users() }),
        qc.invalidateQueries({ queryKey: ["students"] }),
        qc.invalidateQueries({ queryKey: qk.student(vars.studentId) }),
      ]),
  });
}
```

`archiveStudent` must also be added to the `import { ... } from "./api"` list at the top of the file.

- [ ] **Step 3: Verify it type-checks**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors related to these files.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/mutations.ts
git commit -m "feat(frontend): add archiveStudent api fn and useArchiveStudent mutation"
```

---

## Task 3: Per-student coalescing key (TDD)

**Files:**
- Modify: `frontend/src/lib/activity-coalesce.ts` (`surfaceKey`, ~line 18-22)
- Test: `frontend/src/lib/activity-coalesce.unit.test.ts`

- [ ] **Step 1: Add failing tests**

Append two cases inside the `describe("coalesceActivity", ...)` block in `frontend/src/lib/activity-coalesce.unit.test.ts` (the `row()` helper already defaults `target_student_id: 1`).

```ts
  it("does not merge same syllabus_id across different students", () => {
    const out = coalesceActivity([
      row({ id: 2, syllabus_id: 10, target_student_id: 1 }),
      row({ id: 1, syllabus_id: 10, target_student_id: 2 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].members).toHaveLength(1);
    expect(out[1].members).toHaveLength(1);
  });

  it("still merges same syllabus_id for the same student", () => {
    const out = coalesceActivity([
      row({ id: 2, syllabus_id: 10, target_student_id: 1, technique_name: "Armbar" }),
      row({ id: 1, syllabus_id: 10, target_student_id: 1, technique_name: "Triangle" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(2);
  });
```

- [ ] **Step 2: Run to verify the first new test fails**

Run: `cd frontend && npx vitest run src/lib/activity-coalesce.unit.test.ts`
Expected: FAIL — "does not merge same syllabus_id across different students" expects length 2 but gets 1 (current key ignores the student).

- [ ] **Step 3: Update `surfaceKey`**

In `frontend/src/lib/activity-coalesce.ts`, replace the `surfaceKey` body (currently lines ~18-22) with a version that incorporates the subject student:

```ts
function surfaceKey(row: ActivityRow): string {
  const base = row.syllabus_id != null ? `syllabus:${row.syllabus_id}` : (row.context_kind ?? "none");
  // Different students must never merge, even on the same syllabus template.
  return row.target_student_id != null ? `student:${row.target_student_id}|${base}` : base;
}
```

- [ ] **Step 4: Run all coalesce tests**

Run: `cd frontend && npx vitest run src/lib/activity-coalesce.unit.test.ts`
Expected: PASS (all, including the pre-existing cases — they use the default `target_student_id: 1` so same-student merges still hold).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/activity-coalesce.ts frontend/src/lib/activity-coalesce.unit.test.ts
git commit -m "fix(activity): key coalescing per student so cross-student rows never merge"
```

---

## Task 4: Extract shared SyllabusAssignmentRow

**Files:**
- Create: `frontend/src/app/student-syllabi/components/syllabus-assignment-row.tsx`
- Modify: `frontend/src/app/student-syllabi/page.tsx` (remove inline row + chips, import shared)

- [ ] **Step 1: Create the shared component**

Move the `ProgressChips`/`Chip` helpers and the per-assignment `<li><Link>...` markup out of `student-syllabi/page.tsx` into a reusable component. Create `frontend/src/app/student-syllabi/components/syllabus-assignment-row.tsx`:

```tsx
import { Link } from "react-router-dom";
import type { SyllabusAssignment } from "@/lib/api";
import { cn } from "@/lib/utils";

export function SyllabusAssignmentRow({
  studentId,
  assignment,
}: {
  studentId: number;
  assignment: SyllabusAssignment;
}) {
  return (
    <Link
      to={`/student/${studentId}/syllabi/${assignment.syllabus_id}`}
      className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{assignment.syllabus_name}</p>
        {assignment.total_count > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {assignment.total_count}{" "}
            {assignment.total_count === 1 ? "technique" : "techniques"}
          </p>
        )}
      </div>
      <ProgressChips
        red={assignment.red_count}
        amber={assignment.amber_count}
        green={assignment.green_count}
      />
    </Link>
  );
}

function ProgressChips({
  red,
  amber,
  green,
}: {
  red: number;
  amber: number;
  green: number;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 text-xs">
      <Chip color="bg-status-red/80" label="Red" value={red} />
      <Chip color="bg-status-amber/80" label="Amber" value={amber} />
      <Chip color="bg-status-green/80" label="Green" value={green} />
    </div>
  );
}

function Chip({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <span
      className={cn(
        "flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold text-foreground/90",
        color,
        value === 0 && "opacity-40",
      )}
      title={`${label}: ${value}`}
    >
      {value}
    </span>
  );
}
```

- [ ] **Step 2: Use it in the list page**

In `frontend/src/app/student-syllabi/page.tsx`:
1. Delete the bottom `ProgressChips` and `Chip` function definitions (currently ~lines 144-185).
2. Delete the now-unused `cn` import if nothing else in the file uses it (grep first; if other usages remain, keep it).
3. Add the import near the existing imports: `import { SyllabusAssignmentRow } from './components/syllabus-assignment-row';`
4. Replace the `assignments.map(...)` `<li>` body with the shared row:

```tsx
          <ul className="divide-y divide-border">
            {assignments.map((a) => (
              <li key={a.id}>
                <SyllabusAssignmentRow studentId={studentId} assignment={a} />
              </li>
            ))}
          </ul>
```

- [ ] **Step 3: Verify type-check + lint**

Run: `cd frontend && npx tsc --noEmit && npx eslint src/app/student-syllabi/page.tsx src/app/student-syllabi/components/syllabus-assignment-row.tsx`
Expected: no errors. (If `cn` became unused, eslint flags it — remove the import.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/student-syllabi/components/syllabus-assignment-row.tsx frontend/src/app/student-syllabi/page.tsx
git commit -m "refactor(syllabi): extract shared SyllabusAssignmentRow"
```

---

## Task 5: Shared AccountDialog component

Consolidates the self-edit forms (`app/profile/page.tsx`), admin edit/password dialogs (`app/admin/page.tsx`), and the lost legacy reset-claim flow (`app/student-techniques/page.tsx`) into one dialog. Capability set is driven by `mode`.

**Files:**
- Create: `frontend/src/components/account-dialog.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { TracedForm } from "@/components/traced-form";
import { ClaimLinkPanel } from "@/components/claim-link-panel";
import {
  handleApiFormError,
  useFormWithValidation,
} from "@/components/hooks/useFormErrors";
import {
  useResetUserClaim,
  useUpdatePassword,
  useUpdateUser,
  useUpdateUserProfile,
} from "@/lib/mutations";
import type { InviteResponse, User } from "@/lib/api";

const detailsSchema = z.object({
  display_name: z.string(),
  username: z
    .string()
    .min(1, "Username is required")
    .max(50, "Username is too long")
    .regex(/^\S+$/, "No spaces in usernames"),
});
type DetailsValues = z.infer<typeof detailsSchema>;

// Self mode requires the current password; admin mode sets it directly.
const selfPasswordSchema = z
  .object({
    current_password: z.string().min(1, "Current password is required"),
    new_password: z.string().min(5, "Password must be at least 5 characters long"),
    confirm_password: z.string().min(1, "Please confirm the new password"),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    path: ["confirm_password"],
    message: "Passwords do not match",
  });
type SelfPasswordValues = z.infer<typeof selfPasswordSchema>;

const adminPasswordSchema = z
  .object({
    new_password: z.string().min(5, "Password must be at least 5 characters long"),
    confirm_password: z.string().min(1, "Please confirm the password"),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    path: ["confirm_password"],
    message: "Passwords do not match",
  });
type AdminPasswordValues = z.infer<typeof adminPasswordSchema>;

export interface AccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The account being managed. */
  user: User;
  /** "self": the owner edits their own account. "admin": an admin manages another user. */
  mode: "self" | "admin";
}

export function AccountDialog({ open, onOpenChange, user, mode }: AccountDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-md p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>
            {mode === "self" ? "Account" : `Manage ${user.display_name || user.username}`}
          </DialogTitle>
          <DialogDescription>
            {mode === "self"
              ? "Update your details and password."
              : "Update this user's details, password, or access."}
          </DialogDescription>
        </DialogHeader>
        {mode === "self" ? (
          <SelfBody user={user} />
        ) : (
          <AdminBody user={user} onOpenChange={onOpenChange} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SelfBody({ user }: { user: User }) {
  const profileMutation = useUpdateUserProfile();
  const passwordMutation = useUpdatePassword();

  const detailsForm = useFormWithValidation<DetailsValues>({
    resolver: zodResolver(detailsSchema),
    defaultValues: { display_name: user.display_name ?? "", username: user.username ?? "" },
  });
  const passwordForm = useFormWithValidation<SelfPasswordValues>({
    resolver: zodResolver(selfPasswordSchema),
    defaultValues: { current_password: "", new_password: "", confirm_password: "" },
  });

  async function onDetails(data: DetailsValues) {
    try {
      await profileMutation.mutateAsync({
        display_name: data.display_name,
        username: data.username.trim(),
      });
      toast.success("Profile updated");
    } catch (err) {
      const handled = await handleApiFormError(err, detailsForm.setError, Object.keys(detailsForm.getValues()));
      if (!handled) toast.error(err instanceof Error ? err.message : "Failed to update profile");
    }
  }

  async function onPassword(data: SelfPasswordValues) {
    try {
      await passwordMutation.mutateAsync({
        current_password: data.current_password,
        new_password: data.new_password,
      });
      toast.success("Password changed");
      passwordForm.reset();
    } catch (err) {
      const handled = await handleApiFormError(err, passwordForm.setError, Object.keys(passwordForm.getValues()));
      if (!handled) toast.error(err instanceof Error ? err.message : "Failed to change password");
    }
  }

  return (
    <div className="space-y-6">
      <Form {...detailsForm}>
        <TracedForm id="account_details_self" onSubmit={detailsForm.handleSubmit(onDetails)} className="space-y-4">
          <DetailsFields form={detailsForm} />
          <div className="flex justify-end">
            <Button type="submit" disabled={detailsForm.formState.isSubmitting}>
              {detailsForm.formState.isSubmitting ? "Saving..." : "Save details"}
            </Button>
          </div>
        </TracedForm>
      </Form>
      <Separator />
      <Form {...passwordForm}>
        <TracedForm id="account_password_self" onSubmit={passwordForm.handleSubmit(onPassword)} className="space-y-4">
          <FormField
            control={passwordForm.control}
            name="current_password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Current password</FormLabel>
                <FormControl>
                  <Input {...field} type="password" autoComplete="current-password" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <PasswordFields form={passwordForm} />
          <div className="flex justify-end">
            <Button type="submit" disabled={passwordForm.formState.isSubmitting}>
              {passwordForm.formState.isSubmitting ? "Changing..." : "Change password"}
            </Button>
          </div>
        </TracedForm>
      </Form>
    </div>
  );
}

function AdminBody({ user, onOpenChange }: { user: User; onOpenChange: (open: boolean) => void }) {
  const updateUserMutation = useUpdateUser();
  const passwordMutation = useUpdateUser();
  const resetClaimMutation = useResetUserClaim();
  const isClaimed = !!user.claimed_at;

  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [issuedClaimUrl, setIssuedClaimUrl] = useState<string | null>(null);

  const detailsForm = useFormWithValidation<DetailsValues>({
    resolver: zodResolver(detailsSchema),
    defaultValues: { display_name: user.display_name ?? "", username: user.username ?? "" },
  });
  const passwordForm = useFormWithValidation<AdminPasswordValues>({
    resolver: zodResolver(adminPasswordSchema),
    defaultValues: { new_password: "", confirm_password: "" },
  });

  // Re-seed details when the managed user changes.
  useEffect(() => {
    detailsForm.reset({ display_name: user.display_name ?? "", username: user.username ?? "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  async function onDetails(data: DetailsValues) {
    try {
      await updateUserMutation.mutateAsync({
        userId: user.id,
        data: { username: data.username.trim(), display_name: data.display_name },
      });
      toast.success("User updated");
    } catch (err) {
      const handled = await handleApiFormError(err, detailsForm.setError, Object.keys(detailsForm.getValues()));
      if (!handled) toast.error(err instanceof Error ? err.message : "Failed to update user");
    }
  }

  async function onPassword(data: AdminPasswordValues) {
    try {
      await passwordMutation.mutateAsync({ userId: user.id, data: { password: data.new_password } });
      toast.success("Password changed");
      passwordForm.reset();
    } catch (err) {
      const handled = await handleApiFormError(err, passwordForm.setError, Object.keys(passwordForm.getValues()));
      if (!handled) toast.error(err instanceof Error ? err.message : "Failed to change password");
    }
  }

  async function issueClaim() {
    try {
      const response = await resetClaimMutation.mutateAsync(user.id);
      const invite: InviteResponse = await response.json();
      setIssuedClaimUrl(`${window.location.origin}${invite.claim_path}`);
    } catch {
      toast.error("Failed to create link");
    }
  }

  return (
    <div className="space-y-6">
      <Form {...detailsForm}>
        <TracedForm id="account_details_admin" onSubmit={detailsForm.handleSubmit(onDetails)} className="space-y-4">
          <DetailsFields form={detailsForm} />
          <div className="flex justify-end">
            <Button type="submit" disabled={detailsForm.formState.isSubmitting}>
              {detailsForm.formState.isSubmitting ? "Saving..." : "Save details"}
            </Button>
          </div>
        </TracedForm>
      </Form>

      <Separator />

      {isClaimed ? (
        <div className="space-y-4">
          <Form {...passwordForm}>
            <TracedForm id="account_password_admin" onSubmit={passwordForm.handleSubmit(onPassword)} className="space-y-4">
              <PasswordFields form={passwordForm} />
              <div className="flex justify-end">
                <Button type="submit" disabled={passwordForm.formState.isSubmitting}>
                  {passwordForm.formState.isSubmitting ? "Changing..." : "Set password"}
                </Button>
              </div>
            </TracedForm>
          </Form>
          <Button type="button" variant="outline" className="w-full gap-2" onClick={() => setResetConfirmOpen(true)}>
            <KeyRound className="h-4 w-4" aria-hidden />
            Reset password (send claim link)
          </Button>
        </div>
      ) : (
        <Button type="button" variant="outline" className="w-full gap-2" onClick={issueClaim}>
          <Copy className="h-4 w-4" aria-hidden />
          Copy invite link
        </Button>
      )}

      <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <AlertDialogContent className="w-[calc(100vw-1rem)] max-w-sm p-4 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset {user.display_name || user.username}'s password?</AlertDialogTitle>
            <AlertDialogDescription>
              This signs them out and clears their current password. You'll get a link to share so they can pick a new password.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setResetConfirmOpen(false);
                issueClaim();
              }}
            >
              Reset password
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!issuedClaimUrl} onOpenChange={(next) => { if (!next) { setIssuedClaimUrl(null); onOpenChange(false); } }}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-md p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Sign-in link ready</DialogTitle>
            <DialogDescription>
              Show this QR code to the user or send them the link. They'll pick a username and password. Valid for 7 days.
            </DialogDescription>
          </DialogHeader>
          {issuedClaimUrl && <ClaimLinkPanel url={issuedClaimUrl} />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setIssuedClaimUrl(null); onOpenChange(false); }}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Shared field groups. `form` is typed loosely because both DetailsValues forms
// share field names; the control is structurally compatible.
function DetailsFields({ form }: { form: ReturnType<typeof useFormWithValidation<DetailsValues>> }) {
  return (
    <>
      <FormField
        control={form.control}
        name="username"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Username</FormLabel>
            <FormControl>
              <Input {...field} autoComplete="username" spellCheck={false} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="display_name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Display name</FormLabel>
            <FormControl>
              <Input {...field} placeholder="How others see you" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}

function PasswordFields<T extends { new_password: string; confirm_password: string }>({
  form,
}: {
  form: ReturnType<typeof useFormWithValidation<T>>;
}) {
  return (
    <>
      <FormField
        control={form.control}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        name={"new_password" as any}
        render={({ field }) => (
          <FormItem>
            <FormLabel>New password</FormLabel>
            <FormControl>
              <Input {...field} type="password" autoComplete="new-password" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        name={"confirm_password" as any}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Confirm password</FormLabel>
            <FormControl>
              <Input {...field} type="password" autoComplete="new-password" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
```

Note: `DetailsFields` is typed concretely to `DetailsValues` (both self/admin details forms share that exact type). `PasswordFields` is generic because self and admin password forms differ (self adds `current_password`); it shares only the two common fields, hence the `as any` on the field names with the eslint-disable. If the project lints clean without the disable, remove it.

- [ ] **Step 2: Verify type-check + lint**

Run: `cd frontend && npx tsc --noEmit && npx eslint src/components/account-dialog.tsx`
Expected: no errors. If `Separator` import path differs, confirm against `app/profile/page.tsx` (`@/components/ui/separator`). If `useFormWithValidation` generic helper signature rejects `ReturnType<typeof useFormWithValidation<T>>`, fall back to typing `form` as `UseFormReturn<T>` from `react-hook-form` (import the type) — check how `useFormWithValidation` is declared in `frontend/src/components/hooks/useFormErrors.ts` first and match it.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/account-dialog.tsx
git commit -m "feat(frontend): add shared AccountDialog (self + admin account management)"
```

---

## Task 6: Profile page — preview sections + account/archive

**Files:**
- Modify: `frontend/src/app/student-profile/page.tsx`

- [ ] **Step 1: Add imports + queries**

In `frontend/src/app/student-profile/page.tsx`:
1. Add to the lucide import: `Settings` (account button), keep `Pin`, `NotebookPen`, `Archive`, `ChevronRight`. Add `Archive` to the lucide import list.
2. Add imports:

```tsx
import { Accordion } from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { TechniqueRow } from "@/components/technique-row";
import { AccountDialog } from "@/components/account-dialog";
import { SyllabusAssignmentRow } from "@/app/student-syllabi/components/syllabus-assignment-row";
import { EmptyState } from "@/components/empty-state";
import {
  useStudentSyllabi,
  useStudentPinnedTechniques,
} from "@/lib/queries";
import { useArchiveStudent } from "@/lib/mutations";
import { isAdmin } from "@/lib/api";
```

Confirm whether the path alias `@/app/...` resolves (check `tsconfig`/`vite` alias in another file that imports from `@/app/...`; if not used elsewhere, use a relative import `../student-syllabi/components/syllabus-assignment-row`).

- [ ] **Step 2: Add state + derived flags inside `ProfileHub`**

After the existing `const canCreateCamp = ...` line:

```tsx
  const viewerIsAdmin = isAdmin(viewer);
  const isCoach = isCoachOrAdmin(viewer);
  const canManageAccount = isOwnView || (viewerIsAdmin && !isOwnView);
  const canArchive = isCoach && !isOwnView;
  const [accountOpen, setAccountOpen] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const archiveMutation = useArchiveStudent();
  const syllabiQuery = useStudentSyllabi(studentId);
  const pinnedQuery = useStudentPinnedTechniques(studentId);
  const [pinnedExpanded, setPinnedExpanded] = useState<string>("");
  const previewSyllabi = (syllabiQuery.data ?? []).slice(0, 5);
  const previewPinned = (pinnedQuery.data ?? []).slice(0, 5);
```

(`isCoachOrAdmin` is already imported in this file.)

- [ ] **Step 3: Add account + archive controls to the header section**

Replace the header `<section className="flex items-center gap-4">...</section>` (lines ~162-180) so the name block stays, an "Archived" badge shows, and an actions column is added on the right:

```tsx
      <section className="flex items-center gap-4">
        <Avatar size="lg" className="shrink-0">
          <AvatarFallback>{initials(student)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 truncate text-base font-semibold">
            {displayName}
            {student.archived && (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <Archive className="h-3 w-3" aria-hidden />
                Archived
              </Badge>
            )}
          </h1>
          {student.display_name && student.display_name !== student.username && (
            <p className="truncate text-xs text-muted-foreground">{student.username}</p>
          )}
          <p className="mt-1 text-xs capitalize text-muted-foreground">{student.role}</p>
        </div>
        {(canManageAccount || canArchive) && (
          <div className="flex shrink-0 items-center gap-2">
            {canManageAccount && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAccountOpen(true)}>
                <Settings className="h-4 w-4" aria-hidden />
                <span>Account</span>
              </Button>
            )}
            {canArchive && !viewerIsAdmin && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setArchiveConfirmOpen(true)}>
                <Archive className="h-4 w-4" aria-hidden />
                <span>{student.archived ? "Unarchive" : "Archive"}</span>
              </Button>
            )}
          </div>
        )}
      </section>
```

Note: when the viewer is admin, archive lives inside the AccountDialog is NOT implemented (the dialog has no archive control). To keep behavior simple and consistent, render the standalone Archive button for BOTH coach and admin. So change the condition to just `{canArchive && (...)}` (drop `&& !viewerIsAdmin`). Use this final version:

```tsx
            {canArchive && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setArchiveConfirmOpen(true)}>
                <Archive className="h-4 w-4" aria-hidden />
                <span>{student.archived ? "Unarchive" : "Archive"}</span>
              </Button>
            )}
```

- [ ] **Step 4: Replace the Syllabi + Pinned HubLinks with preview sections**

In the `JON SHARP'S SPACES` card (the `<div className="overflow-hidden rounded-lg border border-border bg-card">` containing `HubLink`s, ~lines 206-239), remove the two `HubLink`s for syllabi and pinned. Keep Library (owner) + Camps/Matches (gated). The card already conditionally renders entries; leave it. (No empty-card guard needed because Library always renders for owner, and for a coach with camps gated the card may be empty — wrap the whole spaces `<section>` so it only renders when it has at least one entry:)

Change the spaces section open so it renders only with content:

```tsx
      {(isOwnView || campsUiEnabled) && (
        <section className="space-y-2">
          {/* ...existing heading + New camp button... */}
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {isOwnView && <HubLink to="/library" icon={BookOpen} title="Library" />}
            {campsUiEnabled && (
              <>
                <HubLink to={`/student/${studentId}/camps`} icon={Dumbbell} title="Camps" />
                <HubLink to={`/student/${studentId}/matches`} icon={Medal} title={isOwnView ? "My matches" : "Matches"} last />
              </>
            )}
          </div>
        </section>
      )}
```

Then add two new sections immediately after the spaces section (before the Discussion section):

```tsx
      {/* Syllabi preview */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <NotebookPen className="h-3.5 w-3.5" aria-hidden />
            {isOwnView ? "My syllabi" : "Syllabi"}
          </h2>
          <Link to={`/student/${studentId}/syllabi`} className="text-xs text-muted-foreground hover:text-foreground">
            See all
          </Link>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {syllabiQuery.isLoading ? (
            <div className="px-4 py-4">
              <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            </div>
          ) : previewSyllabi.length === 0 ? (
            <EmptyState icon={NotebookPen} title="No syllabi yet" description={isOwnView ? "A coach has not assigned you a syllabus yet." : "This student has no active syllabus assignments."} />
          ) : (
            <ul className="divide-y divide-border">
              {previewSyllabi.map((a) => (
                <li key={a.id}>
                  <SyllabusAssignmentRow studentId={studentId} assignment={a} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Pinned preview */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Pin className="h-3.5 w-3.5" aria-hidden />
            {isOwnView ? "Pinned" : "Pinned techniques"}
          </h2>
          <Link to={`/student/${studentId}/pinned`} className="text-xs text-muted-foreground hover:text-foreground">
            See all
          </Link>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {pinnedQuery.isLoading ? (
            <div className="px-4 py-4">
              <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            </div>
          ) : previewPinned.length === 0 ? (
            <EmptyState icon={Pin} title="No pins yet" description={isOwnView ? "Pin techniques from the library to keep them within reach." : "This student has not pinned anything yet."} />
          ) : (
            <Accordion type="single" collapsible value={pinnedExpanded} onValueChange={setPinnedExpanded}>
              {previewPinned.map((t) => {
                const value = String(t.id);
                return (
                  <TechniqueRow
                    key={t.id}
                    technique={t}
                    context={{ kind: "student-pinned", studentId, studentName: isOwnView ? null : displayName }}
                    value={value}
                    isOpen={pinnedExpanded === value}
                  />
                );
              })}
            </Accordion>
          )}
        </div>
      </section>
```

(`Link`, `BookOpen`, `Dumbbell`, `Medal`, `NotebookPen`, `Pin` are already imported in this file. Add `Settings` and `Archive` to the lucide import.)

- [ ] **Step 5: Render the dialogs at the end of the component**

Just before the closing `</div>` of the returned tree, add:

```tsx
      {canManageAccount && (
        <AccountDialog
          open={accountOpen}
          onOpenChange={setAccountOpen}
          user={student}
          mode={isOwnView ? "self" : "admin"}
        />
      )}

      <AlertDialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <AlertDialogContent className="w-[calc(100vw-1rem)] max-w-sm p-4 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {student.archived ? `Unarchive ${displayName}?` : `Archive ${displayName}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {student.archived
                ? "They return to the active roster."
                : "They drop off the active roster. Their data is preserved and you can unarchive any time."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setArchiveConfirmOpen(false);
                try {
                  await archiveMutation.mutateAsync({ studentId, archived: !student.archived });
                  toast.success(student.archived ? "Student unarchived" : "Student archived");
                } catch {
                  toast.error("Failed to update student");
                }
              }}
            >
              {student.archived ? "Unarchive" : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
```

(`toast` is already imported.)

- [ ] **Step 6: Verify type-check + lint + existing tests**

Run: `cd frontend && npx tsc --noEmit && npx eslint src/app/student-profile/page.tsx`
Expected: no errors. Note `student-profile-activity.test.tsx` exists; it runs in CI only. Read it to confirm none of the removed HubLinks are asserted; if a test asserts the "Syllabi"/"Pinned techniques" HubLink, update it to the new section headings ("Syllabi"/"Pinned techniques" `<h2>` + "See all" links).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/student-profile/page.tsx
git commit -m "feat(profile): preview sections plus account and archive controls"
```

---

## Task 7: Syllabus detail — full buttons + manage account

**Files:**
- Modify: `frontend/src/app/student-syllabi/[syllabusId]/page.tsx`

- [ ] **Step 1: Swap imports**

In `frontend/src/app/student-syllabi/[syllabusId]/page.tsx`:
1. Remove the `DropdownMenu*` import block (lines ~37-43) and the `EllipsisVertical` lucide import.
2. Add `Settings` to the lucide import.
3. Add `import { AccountDialog } from '@/components/account-dialog';`
4. Add `isAdmin` to the existing `import { isCoachOrAdmin } from '@/lib/api';` -> `import { isCoachOrAdmin, isAdmin } from '@/lib/api';`

- [ ] **Step 2: Resolve the managed student User + admin flag**

The detail component has `studentId` and `usersQuery` (via `useAllUsers`). Add inside `Detail`, after `studentName` is computed:

```tsx
  const viewerIsAdmin = isAdmin(user);
  const managedStudent = useMemo(
    () => (usersQuery.data ?? []).find((u) => u.id === studentId) ?? null,
    [usersQuery.data, studentId],
  );
  const [accountOpen, setAccountOpen] = useState(false);
```

`user` is already in scope via `useUser()` at the page level — pass it into `Detail` or call `useUser()` inside `Detail`. Currently `Detail` does NOT receive `user`; add `const user = useUser();` at the top of `Detail` (the import already exists).

- [ ] **Step 3: Replace the dropdown with buttons**

Replace the `{!isOwnView && (<div className="pt-0.5"><DropdownMenu>...</DropdownMenu></div>)}` block (lines ~260-300) with a wrapping button row:

```tsx
        {!isOwnView && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setDiffOpen(true)}>
              <GitCompare className="h-4 w-4" aria-hidden />
              Sync with current syllabus
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setGraduateOpen(true)}>
              <GraduationCap className={cn("h-4 w-4", assignment.graduated_at && "text-status-green")} aria-hidden />
              {assignment.graduated_at ? "Ungraduate syllabus" : "Graduate syllabus"}
            </Button>
            {viewerIsAdmin && managedStudent && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAccountOpen(true)}>
                <Settings className="h-4 w-4" aria-hidden />
                Manage account
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-destructive focus-visible:text-destructive"
              onClick={() => setUnassignOpen(true)}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              Unassign syllabus
            </Button>
          </div>
        )}
```

- [ ] **Step 4: Render the AccountDialog**

Before the final closing `</div>` of the returned tree (after `<AddToStudentDialog ... />`), add:

```tsx
      {viewerIsAdmin && managedStudent && (
        <AccountDialog
          open={accountOpen}
          onOpenChange={setAccountOpen}
          user={managedStudent}
          mode="admin"
        />
      )}
```

- [ ] **Step 5: Verify type-check + lint**

Run: `cd frontend && npx tsc --noEmit && npx eslint src/app/student-syllabi/[syllabusId]/page.tsx`
Expected: no errors. Confirm `EllipsisVertical`, `DropdownMenu*` are no longer referenced (eslint flags unused imports).

- [ ] **Step 6: Commit**

```bash
git add 'frontend/src/app/student-syllabi/[syllabusId]/page.tsx'
git commit -m "feat(syllabus): promote actions to buttons and add manage account"
```

---

## Task 8: Full verify + manual check

- [ ] **Step 1: Run the full gate**

Run: `nix develop .#ci --command just verify`
Expected: PASS (Rust build/clippy/test + frontend lint + vitest unit). Fix any fallout (most likely: a profile test asserting old HubLink text, or an unused import).

- [ ] **Step 2: Manual smoke (optional, via `just run` / dev stack)**

- Admin on a student profile: Account button opens the admin dialog (edit details, set/reset password, copy-invite when unclaimed); Archive button toggles + shows "Archived" badge.
- Coach on a student profile: only Archive button (no Account button).
- Student on own profile: Account button opens self dialog (details + current-password change).
- Profile shows Syllabi + Pinned preview sections (max 5), headings deep-link, pinned rows expand in place.
- Syllabus detail (coach/admin): Sync / Graduate / Unassign render as buttons; admin also sees Manage account.
- Dashboard: a coach's edits across two students no longer collapse into one "and N more" row.

- [ ] **Step 3: Final commit (if any verify fixes were needed)**

```bash
git add -A
git commit -m "fix: address verify fallout for profile/syllabus tweaks"
```

---

## Self-Review Notes

- **Spec coverage:** Change 1 (syllabus buttons + account) → Task 7. Change 2 (profile sections) → Tasks 4, 6. Change 3 (profile account + archive) → Tasks 1, 2, 5, 6. Change 4 (coalescing) → Task 3. Backend archive → Task 1. Shared AccountDialog → Task 5. All covered.
- **Admins-only credentials:** AccountDialog admin mode gated by `isAdmin` at every call site (Tasks 6, 7); coaches get archive only. Matches the locked decision.
- **Archive single code path:** both coach and admin profile archive use `useArchiveStudent` → coach endpoint (Task 6 Step 3 final version drops the `!viewerIsAdmin` guard).
- **Type consistency:** mutation `useArchiveStudent` takes `{ studentId, archived }` (Task 2) and is called with that shape (Task 6). `AccountDialog` props `{ open, onOpenChange, user, mode }` consistent across Tasks 5/6/7. `SyllabusAssignmentRow` props `{ studentId, assignment }` consistent across Tasks 4/6.
- **Known risk:** `PasswordFields` generic typing against `useFormWithValidation` — Task 5 Step 2 calls out the fallback (`UseFormReturn<T>`) if the `ReturnType<...>` form is rejected by the helper's signature.
