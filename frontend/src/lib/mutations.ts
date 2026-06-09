import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  addTagToTechnique,
  addTechniquesToCollection,
  assignCollectionToStudent,
  assignTechniquesToStudent,
  approveUser,
  createAndAssignTechnique,
  createAttempt,
  createCollection,
  createTag,
  createTechniqueInCollection,
  deleteAttempt,
  deleteCollection,
  deleteTag,
  deleteVideo,
  inviteUser,
  linkVideo,
  markStudentTechniqueSeen,
  removeTagFromTechnique,
  removeTechniqueFromCollection,
  reorderVideos,
  resetUserClaim,
  setStudentGraduated,
  setStudentRank,
  setVideoGlobalHidden,
  setVideoStudentVisibility,
  updateAttempt,
  updateCollection,
  updateLibraryTechnique,
  updatePassword,
  updateTechnique,
  updateUser,
  updateUserProfile,
  updateVideo,
} from "./api";
import type {
  RankUpdate,
  SingleStudentTechnique,
  StudentTechniques,
  Technique,
  TechniqueUpdate,
  User,
} from "./api";
import { qk } from "./query-keys";

// Wrap a Response-returning api fn so non-2xx surfaces through `onError` /
// `mutateAsync` catch blocks. The thrown Response preserves the body so
// TracedForm can still extract validation errors.
async function unwrap(res: Response): Promise<Response> {
  if (!res.ok) throw res;
  return res;
}

// ============================================================
// Auth / profile
// ============================================================

export function useUpdateUserProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { display_name: string; username?: string }) =>
      unwrap(await updateUserProfile(data)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.currentUser() });
      qc.invalidateQueries({ queryKey: qk.users() });
    },
  });
}

export function useUpdatePassword() {
  return useMutation({
    mutationFn: async (data: { current_password: string; new_password: string }) =>
      unwrap(await updatePassword(data)),
  });
}

// ============================================================
// Users / admin
// ============================================================

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      userId: number;
      data: {
        username?: string;
        display_name?: string;
        password?: string;
        archived?: boolean;
        graduated?: boolean;
        role?: string;
      };
    }) => unwrap(await updateUser(vars.userId, vars.data)),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: qk.users() });
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: qk.student(vars.userId) });
    },
  });
}

// Optimistic archive toggle for the admin user list.
export function useToggleUserArchived() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { userId: number; archived: boolean }) =>
      unwrap(await updateUser(vars.userId, { archived: vars.archived })),
    onMutate: async ({ userId, archived }) => {
      await qc.cancelQueries({ queryKey: qk.users() });
      const previous = qc.getQueryData<User[]>(qk.users());
      qc.setQueryData<User[]>(qk.users(), (prev) =>
        prev?.map((u) => (u.id === userId ? { ...u, archived } : u)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(qk.users(), ctx.previous);
    },
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.users() }),
        qc.invalidateQueries({ queryKey: ["students"] }),
      ]),
  });
}

export function useResetUserClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: number) => unwrap(await resetUserClaim(userId)),
    onSuccess: (_res, userId) => {
      qc.invalidateQueries({ queryKey: qk.users() });
      qc.invalidateQueries({ queryKey: qk.student(userId) });
    },
  });
}

export function useApproveUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: number) => unwrap(await approveUser(userId)),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.users() }),
        qc.invalidateQueries({ queryKey: ["students"] }),
      ]),
  });
}

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { display_name: string; role: string }) =>
      unwrap(await inviteUser(data)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.users() });
      qc.invalidateQueries({ queryKey: ["students"] });
    },
  });
}

// Optimistic graduate toggle used on both /students and /admin.
export function useSetStudentGraduated() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: number; graduated: boolean }) =>
      unwrap(await setStudentGraduated(vars.id, vars.graduated)),
    onMutate: async ({ id, graduated }) => {
      const stamp = graduated ? new Date().toISOString() : null;
      // Cancel any in-flight lists so they don't overwrite the optimistic state.
      await qc.cancelQueries({ queryKey: ["students"] });
      await qc.cancelQueries({ queryKey: qk.users() });

      const previousStudents = qc.getQueriesData<User[]>({ queryKey: ["students"] });
      const previousUsers = qc.getQueryData<User[]>(qk.users());

      qc.setQueriesData<User[]>({ queryKey: ["students"] }, (prev) =>
        prev?.map((s) => (s.id === id ? { ...s, graduated_at: stamp } : s)),
      );
      qc.setQueryData<User[]>(qk.users(), (prev) =>
        prev?.map((s) => (s.id === id ? { ...s, graduated_at: stamp } : s)),
      );

      return { previousStudents, previousUsers };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previousStudents?.forEach(([key, data]) => qc.setQueryData(key, data));
      if (ctx?.previousUsers) qc.setQueryData(qk.users(), ctx.previousUsers);
    },
    onSettled: (_res, _err, { id }) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["students"] }),
        qc.invalidateQueries({ queryKey: qk.users() }),
        qc.invalidateQueries({ queryKey: qk.student(id) }),
      ]),
  });
}

// Coach-only edit of a student's belt + stripes + last grading date.
// Optimistic patch keeps the profile header in sync the moment the
// modal closes; rollback on error.
export function useSetStudentRank() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: number; rank: RankUpdate }) =>
      unwrap(await setStudentRank(vars.id, vars.rank)),
    onMutate: async ({ id, rank }) => {
      await qc.cancelQueries({ queryKey: ["students"] });
      await qc.cancelQueries({ queryKey: qk.users() });

      const previousStudents = qc.getQueriesData<User[]>({ queryKey: ["students"] });
      const previousUsers = qc.getQueryData<User[]>(qk.users());

      const patch = (u: User): User =>
        u.id === id
          ? {
              ...u,
              belt: rank.belt,
              stripes: rank.stripes,
              last_graded_at: rank.last_graded_at,
            }
          : u;

      qc.setQueriesData<User[]>({ queryKey: ["students"] }, (prev) => prev?.map(patch));
      qc.setQueryData<User[]>(qk.users(), (prev) => prev?.map(patch));

      return { previousStudents, previousUsers };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previousStudents?.forEach(([key, data]) => qc.setQueryData(key, data));
      if (ctx?.previousUsers) qc.setQueryData(qk.users(), ctx.previousUsers);
    },
    onSettled: (_res, _err, { id }) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["students"] }),
        qc.invalidateQueries({ queryKey: qk.users() }),
        qc.invalidateQueries({ queryKey: qk.student(id) }),
      ]),
  });
}

// ============================================================
// Techniques (per-student)
// ============================================================

export function useUpdateTechnique() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      studentTechniqueId: number;
      updates: TechniqueUpdate;
    }) => unwrap(await updateTechnique(vars.studentTechniqueId, vars.updates)),
    // Optimistic patch across every cached student-technique list and the
    // single-technique detail cache so the row updates instantly.
    onMutate: async ({ studentTechniqueId, updates }) => {
      await qc.cancelQueries({ predicate: qk.matches.anyStudentTechniqueScope });

      const techPatch: Partial<Technique> = {};
      if (updates.status !== undefined) techPatch.status = updates.status;
      if (updates.student_notes !== undefined)
        techPatch.student_notes = updates.student_notes;
      if (updates.coach_notes !== undefined)
        techPatch.coach_notes = updates.coach_notes;
      if (updates.technique_name !== undefined)
        techPatch.technique_name = updates.technique_name;
      if (updates.technique_description !== undefined)
        techPatch.technique_description = updates.technique_description;

      const snapshots = qc.getQueriesData<StudentTechniques>({
        queryKey: ["student"],
      });

      // Update student technique lists.
      qc.setQueriesData<StudentTechniques>(
        { queryKey: ["student"] },
        (prev) => {
          if (!prev || !Array.isArray(prev.techniques)) return prev;
          return {
            ...prev,
            techniques: prev.techniques.map((t) => {
              if (t.id === studentTechniqueId) return { ...t, ...techPatch };
              // Definition fields (name/description) propagate to every row
              // sharing the same library technique_id.
              if (
                (updates.technique_name !== undefined ||
                  updates.technique_description !== undefined) &&
                techPatch.technique_name !== undefined
              ) {
                // Best-effort propagation: only safe if technique_id matches.
                if (t.technique_id === undefined) return t;
                if (t.id === studentTechniqueId) return { ...t, ...techPatch };
              }
              return t;
            }),
          };
        },
      );

      // Update the single-technique detail cache.
      const detailSnap = qc.getQueryData<SingleStudentTechnique>(
        qk.studentTechnique(studentTechniqueId),
      );
      qc.setQueryData<SingleStudentTechnique>(
        qk.studentTechnique(studentTechniqueId),
        (prev) =>
          prev
            ? { ...prev, technique: { ...prev.technique, ...techPatch } }
            : prev,
      );

      return { snapshots, detailSnap, studentTechniqueId };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.snapshots?.forEach(([key, data]) => qc.setQueryData(key, data));
      if (ctx?.detailSnap !== undefined && ctx?.studentTechniqueId !== undefined) {
        qc.setQueryData(qk.studentTechnique(ctx.studentTechniqueId), ctx.detailSnap);
      }
    },
    // Returning the promise keeps isPending true until the cascading refetches
    // complete, so the calling UI sees fresh data the moment the spinner clears.
    onSettled: (_res, _err, { studentTechniqueId }) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.studentTechnique(studentTechniqueId) }),
        qc.invalidateQueries({ predicate: qk.matches.anyStudentTechniques }),
        qc.invalidateQueries({ queryKey: ["students"] }),
      ]),
  });
}

export function useAddTagToTechnique() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { techniqueId: number; tagId: number }) =>
      unwrap(await addTagToTechnique(vars.techniqueId, vars.tagId)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.libraryTechniques() });
      qc.invalidateQueries({ predicate: qk.matches.anyStudentTechniqueScope });
    },
  });
}

export function useRemoveTagFromTechnique() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { techniqueId: number; tagId: number }) =>
      unwrap(await removeTagFromTechnique(vars.techniqueId, vars.tagId)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.libraryTechniques() });
      qc.invalidateQueries({ predicate: qk.matches.anyStudentTechniqueScope });
    },
  });
}

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => unwrap(await createTag(name)),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tags() }),
  });
}

export function useDeleteTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tagId: number) => unwrap(await deleteTag(tagId)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.tags() });
      qc.invalidateQueries({ predicate: qk.matches.anyStudentTechniqueScope });
    },
  });
}

// Fire-and-forget; flips has_unseen_activity optimistically. Server side
// just records the read; failures are non-fatal.
export function useMarkStudentTechniqueSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (studentTechniqueId: number) => {
      await markStudentTechniqueSeen(studentTechniqueId);
    },
    onMutate: async (studentTechniqueId) => {
      qc.setQueriesData<StudentTechniques>(
        { queryKey: ["student"] },
        (prev) => {
          if (!prev || !Array.isArray(prev.techniques)) return prev;
          return {
            ...prev,
            techniques: prev.techniques.map((t) =>
              t.id === studentTechniqueId
                ? { ...t, has_unseen_activity: false }
                : t,
            ),
          };
        },
      );
    },
  });
}

// ============================================================
// Assignment
// ============================================================

export function useAssignTechniquesToStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      studentId: number;
      techniqueIds: number[];
      collectionId?: number | null;
    }) =>
      unwrap(
        await assignTechniquesToStudent(
          vars.studentId,
          vars.techniqueIds,
          vars.collectionId,
        ),
      ),
    onSuccess: (_res, { studentId }) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.studentTechniques(studentId) }),
        qc.invalidateQueries({ queryKey: qk.studentUnassigned(studentId) }),
        qc.invalidateQueries({ queryKey: ["students"] }),
      ]),
  });
}

export function useCreateAndAssignTechnique() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      studentId: number;
      name: string;
      description: string;
      collectionId?: number | null;
    }) =>
      unwrap(
        await createAndAssignTechnique(
          vars.studentId,
          vars.name,
          vars.description,
          vars.collectionId,
        ),
      ),
    onSuccess: (_res, { studentId }) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.studentTechniques(studentId) }),
        qc.invalidateQueries({ queryKey: qk.studentUnassigned(studentId) }),
        qc.invalidateQueries({ queryKey: qk.libraryStats() }),
        qc.invalidateQueries({ queryKey: qk.collections() }),
        qc.invalidateQueries({ queryKey: ["students"] }),
      ]),
  });
}

export function useAssignCollectionToStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { studentId: number; collectionId: number }) =>
      unwrap(await assignCollectionToStudent(vars.studentId, vars.collectionId)),
    onSuccess: (_res, { studentId, collectionId }) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.studentTechniques(studentId) }),
        qc.invalidateQueries({ queryKey: qk.studentUnassigned(studentId) }),
        qc.invalidateQueries({ queryKey: qk.collection(collectionId) }),
        qc.invalidateQueries({ queryKey: qk.collectionStudents(collectionId) }),
        qc.invalidateQueries({ queryKey: ["students"] }),
      ]),
  });
}

// ============================================================
// Collections
// ============================================================

export function useCreateCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; description?: string }) =>
      unwrap(await createCollection(data)),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.collections() }),
  });
}

export function useUpdateCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      id: number;
      data: { name: string; description?: string };
    }) => unwrap(await updateCollection(vars.id, vars.data)),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: qk.collections() });
      qc.invalidateQueries({ queryKey: qk.collection(id) });
    },
  });
}

export function useDeleteCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => unwrap(await deleteCollection(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.collections() }),
  });
}

export function useAddTechniquesToCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { collectionId: number; techniqueIds: number[] }) =>
      unwrap(
        await addTechniquesToCollection(vars.collectionId, vars.techniqueIds),
      ),
    onSuccess: (_res, { collectionId }) => {
      qc.invalidateQueries({ queryKey: qk.collection(collectionId) });
      qc.invalidateQueries({ queryKey: qk.collections() });
    },
  });
}

export function useCreateTechniqueInCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      collectionId: number;
      name: string;
      description: string;
    }) =>
      unwrap(
        await createTechniqueInCollection(
          vars.collectionId,
          vars.name,
          vars.description,
        ),
      ),
    onSuccess: (_res, { collectionId }) => {
      qc.invalidateQueries({ queryKey: qk.collection(collectionId) });
      qc.invalidateQueries({ queryKey: qk.collections() });
      qc.invalidateQueries({ queryKey: qk.libraryStats() });
    },
  });
}

export function useUpdateLibraryTechnique() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      techniqueId: number;
      data: { name: string; description: string };
    }) => unwrap(await updateLibraryTechnique(vars.techniqueId, vars.data)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.collections() });
      qc.invalidateQueries({ predicate: qk.matches.anyCollection });
      qc.invalidateQueries({ queryKey: qk.libraryTechniques() });
      qc.invalidateQueries({ predicate: qk.matches.anyStudentTechniqueScope });
    },
  });
}

export function useRemoveTechniqueFromCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { collectionId: number; techniqueId: number }) =>
      unwrap(
        await removeTechniqueFromCollection(vars.collectionId, vars.techniqueId),
      ),
    onSuccess: (_res, { collectionId }) => {
      qc.invalidateQueries({ queryKey: qk.collection(collectionId) });
      qc.invalidateQueries({ queryKey: qk.collections() });
    },
  });
}

// ============================================================
// Attempts
// ============================================================

export function useCreateAttempt(studentId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      studentTechniqueId: number;
      data?: { note?: string | null; attempted_at?: string | null };
    }) => createAttempt(vars.studentTechniqueId, vars.data ?? {}),
    onSuccess: (_res, { studentTechniqueId }) => {
      const tasks: Promise<unknown>[] = [
        qc.invalidateQueries({ queryKey: qk.attempts(studentTechniqueId) }),
        qc.invalidateQueries({ queryKey: qk.studentTechnique(studentTechniqueId) }),
        qc.invalidateQueries({
          queryKey: ["studentTechnique", studentTechniqueId, "sparkline"],
        }),
        qc.invalidateQueries({ queryKey: ["students"] }),
      ];
      if (studentId !== undefined) {
        tasks.push(
          qc.invalidateQueries({ queryKey: qk.attemptSummary(studentId) }),
          qc.invalidateQueries({ queryKey: qk.attemptHeatmap(studentId) }),
          qc.invalidateQueries({
            queryKey: ["student", studentId, "recentAttempts"],
          }),
          qc.invalidateQueries({ queryKey: qk.studentTechniques(studentId) }),
        );
      }
      return Promise.all(tasks);
    },
  });
}

export function useUpdateAttempt(studentTechniqueId?: number, studentId?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      attemptId: number;
      data: {
        note?: string | null;
        clear_note?: boolean;
        attempted_at?: string | null;
      };
    }) => unwrap(await updateAttempt(vars.attemptId, vars.data)),
    onSuccess: () => {
      const tasks: Promise<unknown>[] = [];
      if (studentTechniqueId !== undefined) {
        tasks.push(
          qc.invalidateQueries({ queryKey: qk.attempts(studentTechniqueId) }),
          qc.invalidateQueries({ queryKey: qk.studentTechnique(studentTechniqueId) }),
          qc.invalidateQueries({
            queryKey: ["studentTechnique", studentTechniqueId, "sparkline"],
          }),
        );
      }
      if (studentId !== undefined) {
        tasks.push(
          qc.invalidateQueries({ queryKey: qk.attemptSummary(studentId) }),
          qc.invalidateQueries({ queryKey: qk.attemptHeatmap(studentId) }),
          qc.invalidateQueries({
            queryKey: ["student", studentId, "recentAttempts"],
          }),
        );
      }
      return Promise.all(tasks);
    },
  });
}

export function useDeleteAttempt(studentTechniqueId?: number, studentId?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (attemptId: number) => unwrap(await deleteAttempt(attemptId)),
    onSuccess: () => {
      const tasks: Promise<unknown>[] = [
        qc.invalidateQueries({ queryKey: ["students"] }),
      ];
      if (studentTechniqueId !== undefined) {
        tasks.push(
          qc.invalidateQueries({ queryKey: qk.attempts(studentTechniqueId) }),
          qc.invalidateQueries({ queryKey: qk.studentTechnique(studentTechniqueId) }),
          qc.invalidateQueries({
            queryKey: ["studentTechnique", studentTechniqueId, "sparkline"],
          }),
        );
      }
      if (studentId !== undefined) {
        tasks.push(
          qc.invalidateQueries({ queryKey: qk.attemptSummary(studentId) }),
          qc.invalidateQueries({ queryKey: qk.attemptHeatmap(studentId) }),
          qc.invalidateQueries({
            queryKey: ["student", studentId, "recentAttempts"],
          }),
        );
      }
      return Promise.all(tasks);
    },
  });
}

// ============================================================
// Videos
// ============================================================

export function useLinkVideo(techniqueId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      title: string;
      description?: string;
      url: string;
    }) => linkVideo(techniqueId, payload),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: qk.techniqueVideos(techniqueId) }),
  });
}

export function useUpdateVideo(techniqueId?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      videoId: number;
      payload: { title?: string; description?: string; position?: number };
    }) => {
      await updateVideo(vars.videoId, vars.payload);
    },
    onSuccess: () => {
      if (techniqueId !== undefined) {
        qc.invalidateQueries({ queryKey: qk.techniqueVideos(techniqueId) });
      } else {
        qc.invalidateQueries({ predicate: qk.matches.anyTechniqueVideos });
      }
    },
  });
}

export function useReorderVideos(techniqueId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderedIds: number[]) => {
      await reorderVideos(techniqueId, orderedIds);
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: qk.techniqueVideosAll(techniqueId) }),
  });
}

export function useDeleteVideo(techniqueId?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (videoId: number) => {
      await deleteVideo(videoId);
    },
    onSuccess: () => {
      if (techniqueId !== undefined) {
        qc.invalidateQueries({ queryKey: qk.techniqueVideosAll(techniqueId) });
      } else {
        qc.invalidateQueries({ predicate: qk.matches.anyTechniqueVideos });
      }
    },
  });
}

export function useSetVideoGlobalHidden(techniqueId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { videoId: number; hidden: boolean }) => {
      const response = await setVideoGlobalHidden(vars.videoId, vars.hidden);
      if (!response.ok) throw new Error("Failed to update visibility");
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: qk.techniqueVideosAll(techniqueId) }),
  });
}

export function useSetVideoStudentVisibility(techniqueId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      videoId: number;
      studentId: number;
      visible: boolean | null;
    }) => {
      const response = await setVideoStudentVisibility(
        vars.videoId,
        vars.studentId,
        vars.visible,
      );
      if (!response.ok) throw new Error("Failed to update visibility");
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: qk.techniqueVideosAll(techniqueId) }),
  });
}

// Predicate moved to qk.matches.anyStudentTechniqueScope in query-keys.ts.
