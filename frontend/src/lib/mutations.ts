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
  pinTechniqueForStudent,
  removeTagFromTechnique,
  removeTechniqueFromCollection,
  reorderVideos,
  resetUserClaim,
  setStudentGraduated,
  setVideoGlobalHidden,
  setVideoStudentVisibility,
  unpinTechniqueForStudent,
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
  LibraryTechniqueRow,
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

// ============================================================
// Pinned techniques
// ============================================================

// Optimistically toggles the pinned state across the student's pinned list
// and any open student-library cache for the same student. The plan calls
// for pin/unpin to be optimistic; flash-before-refetch is more disruptive
// than a rare rollback on backend failure.
export function usePinTechnique(studentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (technique: LibraryTechniqueRow) => {
      await pinTechniqueForStudent(studentId, technique.id);
      return technique;
    },
    onMutate: async (technique) => {
      await qc.cancelQueries({ queryKey: qk.pinnedTechniques(studentId) });
      await qc.cancelQueries({ queryKey: qk.studentLibrary(studentId) });

      const prevPinned = qc.getQueryData<LibraryTechniqueRow[]>(
        qk.pinnedTechniques(studentId),
      );
      const prevLibrary = qc.getQueryData<LibraryTechniqueRow[]>(
        qk.studentLibrary(studentId),
      );

      qc.setQueryData<LibraryTechniqueRow[]>(
        qk.pinnedTechniques(studentId),
        (prev) => {
          const next = prev ? [...prev] : [];
          if (!next.some((t) => t.id === technique.id)) {
            next.unshift({ ...technique, is_pinned: true });
          }
          return next;
        },
      );
      qc.setQueryData<LibraryTechniqueRow[]>(
        qk.studentLibrary(studentId),
        (prev) =>
          prev?.map((t) =>
            t.id === technique.id ? { ...t, is_pinned: true } : t,
          ),
      );

      return { prevPinned, prevLibrary };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevPinned !== undefined) {
        qc.setQueryData(qk.pinnedTechniques(studentId), ctx.prevPinned);
      }
      if (ctx?.prevLibrary !== undefined) {
        qc.setQueryData(qk.studentLibrary(studentId), ctx.prevLibrary);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.pinnedTechniques(studentId) });
      qc.invalidateQueries({ queryKey: qk.studentLibrary(studentId) });
    },
  });
}

export function useUnpinTechnique(studentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (techniqueId: number) => {
      await unpinTechniqueForStudent(studentId, techniqueId);
      return techniqueId;
    },
    onMutate: async (techniqueId) => {
      await qc.cancelQueries({ queryKey: qk.pinnedTechniques(studentId) });
      await qc.cancelQueries({ queryKey: qk.studentLibrary(studentId) });

      const prevPinned = qc.getQueryData<LibraryTechniqueRow[]>(
        qk.pinnedTechniques(studentId),
      );
      const prevLibrary = qc.getQueryData<LibraryTechniqueRow[]>(
        qk.studentLibrary(studentId),
      );

      qc.setQueryData<LibraryTechniqueRow[]>(
        qk.pinnedTechniques(studentId),
        (prev) => prev?.filter((t) => t.id !== techniqueId),
      );
      qc.setQueryData<LibraryTechniqueRow[]>(
        qk.studentLibrary(studentId),
        (prev) =>
          prev?.map((t) =>
            t.id === techniqueId ? { ...t, is_pinned: false } : t,
          ),
      );

      return { prevPinned, prevLibrary };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevPinned !== undefined) {
        qc.setQueryData(qk.pinnedTechniques(studentId), ctx.prevPinned);
      }
      if (ctx?.prevLibrary !== undefined) {
        qc.setQueryData(qk.studentLibrary(studentId), ctx.prevLibrary);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.pinnedTechniques(studentId) });
      qc.invalidateQueries({ queryKey: qk.studentLibrary(studentId) });
    },
  });
}

// ============================================================
// Syllabi (PR 3)
// ============================================================

import {
  addTechniqueToSyllabusApi,
  assignSyllabusApi,
  createSyllabusApi,
  createSyllabusAttemptApi,
  deleteSyllabusApi,
  deleteSyllabusAttemptApi,
  removeTechniqueFromSyllabusApi,
  unassignSyllabusApi,
  updateSstApi,
  updateSyllabusApi,
  updateSyllabusAttemptApi,
  type PropagationMode,
} from "./api";

export function useCreateSyllabus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      createSyllabusApi(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.syllabi() }),
  });
}

export function useUpdateSyllabus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      syllabusId: number;
      data: { name?: string; description?: string | null };
    }) => updateSyllabusApi(vars.syllabusId, vars.data),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: qk.syllabi() });
      qc.invalidateQueries({ queryKey: qk.syllabus(vars.syllabusId) });
    },
  });
}

export function useDeleteSyllabus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (syllabusId: number) => deleteSyllabusApi(syllabusId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.syllabi() });
      qc.invalidateQueries({ predicate: qk.matches.anySyllabus });
    },
  });
}

export function useAddTechniqueToSyllabus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      syllabusId: number;
      techniqueId: number;
      propagation: PropagationMode;
    }) =>
      addTechniqueToSyllabusApi(
        vars.syllabusId,
        vars.techniqueId,
        vars.propagation,
      ),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: qk.syllabus(vars.syllabusId) });
      // A Cascade write may have mutated SST in every active assignment.
      qc.invalidateQueries({
        predicate: qk.matches.anyStudentSyllabusTechniques,
      });
    },
  });
}

export function useRemoveTechniqueFromSyllabus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      syllabusId: number;
      techniqueId: number;
      propagation: PropagationMode;
    }) =>
      removeTechniqueFromSyllabusApi(
        vars.syllabusId,
        vars.techniqueId,
        vars.propagation,
      ),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: qk.syllabus(vars.syllabusId) });
      qc.invalidateQueries({
        predicate: qk.matches.anyStudentSyllabusTechniques,
      });
    },
  });
}

export function useAssignSyllabusToStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { studentId: number; syllabusId: number }) =>
      assignSyllabusApi(vars.studentId, vars.syllabusId),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: qk.studentSyllabi(vars.studentId) });
      qc.invalidateQueries({
        queryKey: qk.studentSyllabusTechniques(vars.studentId, vars.syllabusId),
      });
      // Per-syllabus student list + the list page's active assignment count.
      qc.invalidateQueries({ queryKey: qk.syllabusStudents(vars.syllabusId) });
      qc.invalidateQueries({ queryKey: qk.syllabi() });
    },
  });
}

export function useUnassignSyllabusFromStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { studentId: number; syllabusId: number }) =>
      unassignSyllabusApi(vars.studentId, vars.syllabusId),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: qk.studentSyllabi(vars.studentId) });
      qc.invalidateQueries({ queryKey: qk.syllabusStudents(vars.syllabusId) });
      qc.invalidateQueries({ queryKey: qk.syllabi() });
    },
  });
}

export function useUpdateStudentSyllabusTechnique() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      sstId: number;
      studentId: number;
      syllabusId: number;
      data: { status?: string; student_notes?: string; coach_notes?: string };
    }) => updateSstApi(vars.sstId, vars.data),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({
        queryKey: qk.studentSyllabusTechniques(vars.studentId, vars.syllabusId),
      });
      qc.invalidateQueries({ queryKey: qk.studentSyllabi(vars.studentId) });
    },
  });
}

export function useCreateSyllabusAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      sstId: number;
      data: { attempted_at: string; coach_note?: string; student_note?: string };
    }) => createSyllabusAttemptApi(vars.sstId, vars.data),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: qk.syllabusAttempts(vars.sstId) });
      qc.invalidateQueries({
        predicate: qk.matches.anyStudentSyllabusTechniques,
      });
    },
  });
}

export function useUpdateSyllabusAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      attemptId: number;
      sstId: number;
      data: {
        attempted_at?: string;
        coach_note?: string | null;
        student_note?: string | null;
      };
    }) => updateSyllabusAttemptApi(vars.attemptId, vars.data),
    onSuccess: (_res, vars) =>
      qc.invalidateQueries({ queryKey: qk.syllabusAttempts(vars.sstId) }),
  });
}

export function useDeleteSyllabusAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { attemptId: number; sstId: number }) =>
      deleteSyllabusAttemptApi(vars.attemptId),
    onSuccess: (_res, vars) =>
      qc.invalidateQueries({ queryKey: qk.syllabusAttempts(vars.sstId) }),
  });
}

// ============================================================
// PR 4: graduation, diff apply, per-student curation, video overrides
// ============================================================

import {
  addTechniqueToStudentSyllabusApi,
  applyAssignmentDiffApi,
  setAssignmentGraduatedApi,
  setSstHiddenApi,
  setVideoSyllabusVisibilityApi,
  type GhostActionEntry,
  type MissingActionEntry,
  type SyllabusAssignmentDiff,
  type SstRow,
  type StudentSyllabusDetailResponse,
} from "./api";

export function useSetAssignmentGraduated() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      studentId: number;
      syllabusId: number;
      graduated: boolean;
    }) =>
      setAssignmentGraduatedApi(
        vars.studentId,
        vars.syllabusId,
        vars.graduated ? new Date().toISOString() : null,
      ),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({
        queryKey: qk.studentSyllabusTechniques(vars.studentId, vars.syllabusId),
      });
      qc.invalidateQueries({ queryKey: qk.studentSyllabi(vars.studentId) });
    },
  });
}

export function useAddTechniqueToStudentSyllabus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      studentId: number;
      syllabusId: number;
      techniqueId: number;
    }) =>
      addTechniqueToStudentSyllabusApi(
        vars.studentId,
        vars.syllabusId,
        vars.techniqueId,
      ),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({
        queryKey: qk.studentSyllabusTechniques(vars.studentId, vars.syllabusId),
      });
      qc.invalidateQueries({
        queryKey: qk.studentSyllabusDiff(vars.studentId, vars.syllabusId),
      });
    },
  });
}

export function useSetSstHidden() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      sstId: number;
      studentId: number;
      syllabusId: number;
      hidden: boolean;
    }) => setSstHiddenApi(vars.sstId, vars.hidden),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({
        queryKey: qk.studentSyllabusTechniques(vars.studentId, vars.syllabusId),
      });
      qc.invalidateQueries({
        queryKey: qk.studentSyllabusDiff(vars.studentId, vars.syllabusId),
      });
    },
  });
}

export function useSetVideoSyllabusVisibility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      studentId: number;
      syllabusId: number;
      videoId: number;
      visible: boolean | null;
      techniqueId: number;
    }) =>
      setVideoSyllabusVisibilityApi(
        vars.studentId,
        vars.syllabusId,
        vars.videoId,
        vars.visible,
      ),
    onSuccess: (_res, vars) =>
      qc.invalidateQueries({
        queryKey: qk.syllabusTechniqueVideos(
          vars.studentId,
          vars.syllabusId,
          vars.techniqueId,
        ),
      }),
  });
}

// Bundled diff apply mutation. The plan calls this the second optimistic
// patch in PR 4 (pin/unpin from PR 1 is the first). On mutate we patch
// the studentSyllabusTechniques + studentSyllabusDiff caches; on error
// we roll the patches back.
export function useApplyAssignmentDiff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      studentId: number;
      syllabusId: number;
      ghost_actions: GhostActionEntry[];
      missing_actions: MissingActionEntry[];
    }) =>
      applyAssignmentDiffApi(vars.studentId, vars.syllabusId, {
        ghost_actions: vars.ghost_actions,
        missing_actions: vars.missing_actions,
      }),
    onMutate: async (vars) => {
      const sstKey = qk.studentSyllabusTechniques(
        vars.studentId,
        vars.syllabusId,
      );
      const diffKey = qk.studentSyllabusDiff(vars.studentId, vars.syllabusId);
      await qc.cancelQueries({ queryKey: sstKey });
      await qc.cancelQueries({ queryKey: diffKey });
      const prevSst =
        qc.getQueryData<StudentSyllabusDetailResponse>(sstKey);
      const prevDiff = qc.getQueryData<SyllabusAssignmentDiff>(diffKey);

      // Optimistic patch on the SST list: hidden ghosts drop out of the
      // student-visible set; nothing else changes structurally (we don't
      // know the SST id for "add_to_student" until the server returns).
      const hiddenIds = new Set(
        vars.ghost_actions
          .filter((g) => g.action === "hide_locally")
          .map((g) => g.sst_id),
      );
      if (prevSst) {
        qc.setQueryData<StudentSyllabusDetailResponse>(sstKey, {
          ...prevSst,
          techniques: prevSst.techniques.map((sst: SstRow) =>
            hiddenIds.has(sst.id)
              ? { ...sst, hidden_at: new Date().toISOString() }
              : sst,
          ),
        });
      }
      // Optimistic patch on the diff: drop entries that were acted on.
      if (prevDiff) {
        const ghostSstIds = new Set(
          vars.ghost_actions
            .filter((g) => g.action !== "ignore")
            .map((g) => g.sst_id),
        );
        const missingTechIds = new Set(
          vars.missing_actions
            .filter((m) => m.action !== "ignore")
            .map((m) => m.technique_id),
        );
        qc.setQueryData<SyllabusAssignmentDiff>(diffKey, {
          ghosts: prevDiff.ghosts.filter((g) => !ghostSstIds.has(g.sst_id)),
          missing: prevDiff.missing.filter(
            (m) => !missingTechIds.has(m.technique_id),
          ),
        });
      }
      return { prevSst, prevDiff, sstKey, diffKey };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevSst !== undefined && ctx.sstKey) {
        qc.setQueryData(ctx.sstKey, ctx.prevSst);
      }
      if (ctx?.prevDiff !== undefined && ctx.diffKey) {
        qc.setQueryData(ctx.diffKey, ctx.prevDiff);
      }
    },
    onSettled: (_res, _err, vars) => {
      qc.invalidateQueries({
        queryKey: qk.studentSyllabusTechniques(vars.studentId, vars.syllabusId),
      });
      qc.invalidateQueries({
        queryKey: qk.studentSyllabusDiff(vars.studentId, vars.syllabusId),
      });
      qc.invalidateQueries({ queryKey: qk.syllabus(vars.syllabusId) });
    },
  });
}
