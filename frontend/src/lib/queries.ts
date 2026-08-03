import {
  keepPreviousData,
  skipToken,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  getAllTags,
  getAllUsers,
  getActivityDigest,
  getActivityFeed,
  getCampComponents,
  getDashboardActivityFeed,
  getCamp,
  getCampVideos,
  getCampTechniques,
  getCampsForStudent,
  searchCamp,
  getStudentActivityFeed,
  getActivityFeedHeadId,
  getActivityUnreadCount,
  getAttemptSummary,
  getCapabilities,
  getCollection,
  getCollectionStudents,
  getCollections,
  getCurrentUser,
  getLibraryStats,
  getLibraryTechniques,
  getRecentSyllabusAttemptsForStudent,
  getStudentLibrary,
  getStudentPinnedTechniques,
  getStudentSyllabusTechniquesApi,
  getStudentSyllabusTechniquesFlat,
  getStudentSyllabiApi,
  getStudentTechniqueDetail,
  getStudentTechniques,
  getStudents,
  getSyllabusDetail,
  getSyllabi,
  getSyllabusAttemptHeatmap,
  listSyllabusStudentsApi,
  getTechniquesForAssignment,
  listSyllabusAttemptsApi,
  getVideoStats,
  listAttempts,
  listVideos,
  listThreads,
  getThread,
} from "./api";
import type { AnchorKind, CampComponent, CampComponentCursor } from "./api";
import type { ActivityRow } from "./activity-line";
import { qk } from "./query-keys";

// ---- Auth / session ----

// Session-scoped: changes only on login or logout, both of which call
// queryClient.clear() to evict the cache. No reason to refetch on every
// component mount.
export function useCurrentUser() {
  return useQuery({
    queryKey: qk.currentUser(),
    queryFn: getCurrentUser,
    staleTime: Infinity,
  });
}

export function useCapabilities() {
  return useQuery({
    queryKey: qk.capabilities(),
    queryFn: getCapabilities,
    staleTime: Infinity,
  });
}

// ---- Users / students ----

export function useAllUsers() {
  return useQuery({
    queryKey: qk.users(),
    queryFn: getAllUsers,
  });
}

export function useStudents(sortBy?: string, includeArchived: boolean = false) {
  return useQuery({
    queryKey: qk.students(sortBy, includeArchived),
    queryFn: () => getStudents(sortBy, includeArchived),
    placeholderData: keepPreviousData,
  });
}

// ---- Student techniques ----

// Helper: returns the queryFn only when the id is a finite number, else
// skipToken so the query stays idle. Removes the `as number` cast pattern
// that the project's no-cast rule forbids.
function whenId<T>(
  id: number | undefined,
  fn: (id: number) => Promise<T>,
): typeof skipToken | (() => Promise<T>) {
  return typeof id === "number" && Number.isFinite(id) ? () => fn(id) : skipToken;
}

export function useStudentTechniques(studentId: number | undefined) {
  return useQuery({
    queryKey: qk.studentTechniques(studentId ?? 0),
    queryFn: whenId(studentId, getStudentTechniques),
  });
}

export function useStudentTechniqueDetail(stId: number | undefined) {
  return useQuery({
    queryKey: qk.studentTechnique(stId ?? 0),
    queryFn: whenId(stId, getStudentTechniqueDetail),
  });
}

export function useStudentUnassignedTechniques(studentId: number | undefined) {
  return useQuery({
    queryKey: qk.studentUnassigned(studentId ?? 0),
    queryFn: whenId(studentId, getTechniquesForAssignment),
  });
}

// ---- Attempts ----

export function useAttempts(stId: number | undefined) {
  return useQuery({
    queryKey: qk.attempts(stId ?? 0),
    queryFn: whenId(stId, listAttempts),
  });
}

export function useAttemptSummary(studentId: number | undefined) {
  return useQuery({
    queryKey: qk.attemptSummary(studentId ?? 0),
    queryFn: whenId(studentId, getAttemptSummary),
  });
}

// ---- Tags ----

// Tags change rarely; tolerate a 5-minute cache window before background
// refetch fires.
export function useAllTags() {
  return useQuery({
    queryKey: qk.tags(),
    queryFn: getAllTags,
    staleTime: 5 * 60 * 1000,
  });
}

// ---- Collections ----

export function useCollections() {
  return useQuery({
    queryKey: qk.collections(),
    queryFn: getCollections,
  });
}

export function useCollection(id: number | undefined) {
  return useQuery({
    queryKey: qk.collection(id ?? 0),
    queryFn: whenId(id, getCollection),
  });
}

export function useCollectionStudents(collectionId: number | undefined) {
  return useQuery({
    queryKey: qk.collectionStudents(collectionId ?? 0),
    queryFn: whenId(collectionId, getCollectionStudents),
  });
}

// ---- Library stats ----

export function useLibraryStats() {
  return useQuery({
    queryKey: qk.libraryStats(),
    queryFn: getLibraryStats,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLibraryTechniques() {
  return useQuery({
    queryKey: qk.libraryTechniques(),
    queryFn: getLibraryTechniques,
  });
}

export function useStudentLibrary(studentId: number | undefined) {
  return useQuery({
    queryKey: qk.studentLibrary(studentId ?? 0),
    queryFn:
      typeof studentId === "number" && Number.isFinite(studentId)
        ? () => getStudentLibrary(studentId)
        : skipToken,
  });
}

export function useStudentPinnedTechniques(studentId: number | undefined) {
  return useQuery({
    queryKey: qk.pinnedTechniques(studentId ?? 0),
    queryFn:
      typeof studentId === "number" && Number.isFinite(studentId)
        ? () => getStudentPinnedTechniques(studentId)
        : skipToken,
  });
}

// ---- Videos ----

// Polls every 1.5s while any video is still processing; otherwise no
// interval. Polling continues in background tabs so users that switch away
// during a long upload come back to a finished video.
//
// `forStudent` partitions the cache: coaches viewing different students'
// pages get separate cache entries with the right per-student override
// annotations on each video.
export function useTechniqueVideos(
  techniqueId: number | undefined,
  forStudent?: number,
  syllabus?: { studentId: number; syllabusId: number },
) {
  // Syllabus context gets its own cache bucket so library-context and
  // syllabus-context views of the same technique don't collide.
  const queryKey = syllabus
    ? qk.syllabusTechniqueVideos(
        syllabus.studentId,
        syllabus.syllabusId,
        techniqueId ?? 0,
      )
    : qk.techniqueVideos(techniqueId ?? 0, forStudent ?? null);
  return useQuery({
    queryKey,
    queryFn:
      typeof techniqueId === "number" && Number.isFinite(techniqueId)
        ? () => listVideos(techniqueId, { forStudent, syllabus })
        : skipToken,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: true,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      return data.some((v) => v.processing_status === "processing") ? 1500 : false;
    },
  });
}

export function useVideoStats(videoId: number | undefined) {
  return useQuery({
    queryKey: qk.videoStats(videoId ?? 0),
    queryFn: whenId(videoId, getVideoStats),
  });
}

// ---- Syllabi ----

export function useSyllabi() {
  return useQuery({
    queryKey: qk.syllabi(),
    queryFn: getSyllabi,
  });
}

export function useSyllabus(syllabusId: number | undefined) {
  return useQuery({
    queryKey: qk.syllabus(syllabusId ?? 0),
    queryFn:
      typeof syllabusId === "number" && Number.isFinite(syllabusId)
        ? () => getSyllabusDetail(syllabusId)
        : skipToken,
  });
}

export function useStudentSyllabi(studentId: number | undefined) {
  return useQuery({
    queryKey: qk.studentSyllabi(studentId ?? 0),
    queryFn:
      typeof studentId === "number" && Number.isFinite(studentId)
        ? () => getStudentSyllabiApi(studentId)
        : skipToken,
  });
}

export function useStudentSyllabusTechniques(
  studentId: number | undefined,
  syllabusId: number | undefined,
) {
  return useQuery({
    queryKey: qk.studentSyllabusTechniques(studentId ?? 0, syllabusId ?? 0),
    queryFn:
      typeof studentId === "number" &&
      typeof syllabusId === "number" &&
      Number.isFinite(studentId) &&
      Number.isFinite(syllabusId)
        ? () => getStudentSyllabusTechniquesApi(studentId, syllabusId)
        : skipToken,
  });
}

export function useSyllabusAttempts(sstId: number | undefined) {
  return useQuery({
    queryKey: qk.syllabusAttempts(sstId ?? 0),
    queryFn:
      typeof sstId === "number" && Number.isFinite(sstId)
        ? () => listSyllabusAttemptsApi(sstId)
        : skipToken,
  });
}

export function useSyllabusStudents(syllabusId: number | undefined) {
  return useQuery({
    queryKey: qk.syllabusStudents(syllabusId ?? 0),
    queryFn:
      typeof syllabusId === "number" && Number.isFinite(syllabusId)
        ? () => listSyllabusStudentsApi(syllabusId)
        : skipToken,
  });
}

import { getAssignmentDiffApi } from "./api";

export function useAssignmentDiff(
  studentId: number | undefined,
  syllabusId: number | undefined,
) {
  return useQuery({
    queryKey: qk.studentSyllabusDiff(studentId ?? 0, syllabusId ?? 0),
    queryFn:
      typeof studentId === "number" &&
      typeof syllabusId === "number" &&
      Number.isFinite(studentId) &&
      Number.isFinite(syllabusId)
        ? () => getAssignmentDiffApi(studentId, syllabusId)
        : skipToken,
  });
}

// ---- Activity feed (PR 2) ----

// The viewer's own activity feed. For a student this returns rows where
// they are the target; for a coach it returns all gym activity except their
// own actions. `enabled` lets callers gate the query on auth state.
export function useActivityFeed(enabled: boolean = true, limit = 20) {
  return useQuery({
    queryKey: qk.activityFeed(limit),
    queryFn: enabled ? () => getActivityFeed({ limit }) : skipToken,
  });
}

// Student-scoped activity feed. Returns rows where target_student_id = studentId.
// Used by the student-profile page so a coach sees that student's activity
// (not the gym-wide feed). The student can also call this for their own profile.
export function useStudentActivityFeed(studentId: number | undefined, limit = 20) {
  return useQuery({
    queryKey: qk.studentActivityFeed(studentId ?? 0, limit),
    queryFn:
      typeof studentId === "number" && Number.isFinite(studentId)
        ? () => getStudentActivityFeed(studentId, { limit })
        : skipToken,
  });
}

// Keyset cursor for the next older page: the last row's (occurred_at, id).
type FeedCursor = { before_ts: string; before_id: number } | undefined;

function nextFeedCursor(lastPage: ActivityRow[], limit: number): FeedCursor {
  // A short page means we reached the end; stop paginating.
  if (lastPage.length < limit) return undefined;
  const last = lastPage[lastPage.length - 1];
  return { before_ts: last.occurred_at, before_id: last.id };
}

// Infinite (keyset-paginated) gym feed for the social-feed surface. Each page is
// `limit` rows; `getNextPageParam` walks the (occurred_at, id) cursor backwards.
export function useInfiniteActivityFeed(enabled = true, limit = 20) {
  return useInfiniteQuery({
    queryKey: qk.activityFeedInfinite(limit),
    enabled,
    initialPageParam: undefined as FeedCursor,
    queryFn: ({ pageParam }) => getActivityFeed({ limit, ...(pageParam ?? {}) }),
    getNextPageParam: (lastPage) => nextFeedCursor(lastPage, limit),
  });
}

// Infinite student-scoped feed (the student's own social feed surface).
export function useInfiniteStudentActivityFeed(studentId: number | undefined, limit = 20) {
  const valid = typeof studentId === "number" && Number.isFinite(studentId);
  return useInfiniteQuery({
    queryKey: qk.studentActivityFeedInfinite(studentId ?? 0, limit),
    enabled: valid,
    initialPageParam: undefined as FeedCursor,
    queryFn: ({ pageParam }) =>
      getStudentActivityFeed(studentId as number, { limit, ...(pageParam ?? {}) }),
    getNextPageParam: (lastPage) => nextFeedCursor(lastPage, limit),
  });
}

// Polls the id at the top of the viewer's feed (no cursor advance) so the feed
// can show a "new activity" pill when the server head differs from the loaded
// head. 30s interval; pauses when the tab is hidden.
export function useActivityFeedHeadId(enabled = true) {
  return useQuery({
    queryKey: qk.activityFeedHeadId(),
    queryFn: enabled ? getActivityFeedHeadId : skipToken,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useActivityDigest(enabled: boolean = true) {
  return useQuery({
    queryKey: qk.activityDigest(),
    queryFn: enabled ? getActivityDigest : skipToken,
    staleTime: 60 * 1000,
  });
}

export function useDashboardActivityFeed(enabled: boolean = true) {
  return useQuery({
    queryKey: qk.dashboardActivityFeed(),
    queryFn: enabled ? () => getDashboardActivityFeed(30) : skipToken,
  });
}

export function useActivityUnreadCount(enabled: boolean = true) {
  return useQuery({
    queryKey: qk.activityUnreadCount(),
    queryFn: enabled ? getActivityUnreadCount : skipToken,
    refetchOnWindowFocus: true,
  });
}

// ---- Syllabus-backed student dashboard reads ----

export function useStudentSyllabusTechniquesFlat(studentId: number | undefined) {
  return useQuery({
    queryKey: qk.studentSyllabusTechniquesFlat(studentId ?? 0),
    queryFn: whenId(studentId, getStudentSyllabusTechniquesFlat),
  });
}

export function useRecentSyllabusAttempts(
  studentId: number | undefined,
  limit: number = 5,
) {
  return useQuery({
    queryKey: qk.studentRecentSyllabusAttempts(studentId ?? 0, limit),
    queryFn:
      typeof studentId === "number" && Number.isFinite(studentId)
        ? () => getRecentSyllabusAttemptsForStudent(studentId, limit)
        : skipToken,
  });
}

export function useSyllabusAttemptHeatmap(studentId: number | undefined) {
  return useQuery({
    queryKey: qk.studentSyllabusAttemptHeatmap(studentId ?? 0),
    queryFn: whenId(studentId, getSyllabusAttemptHeatmap),
  });
}

/**
 * The camp's content as components, newest touch first. Each component arrives
 * with its discussion, which is written into the per-anchor thread caches so an
 * expanded component reads it instead of fetching its own.
 */
export function useInfiniteCampComponents(campId: number | undefined, limit = 10) {
  const qc = useQueryClient();
  const id = campId ?? 0;
  return useInfiniteQuery({
    queryKey: qk.campComponents(id, limit),
    enabled: typeof campId === "number" && Number.isFinite(campId),
    initialPageParam: null as CampComponentCursor | null,
    queryFn: async ({ pageParam }) => {
      const page = await getCampComponents(id, { before: pageParam, limit });
      seedComponentThreads(qc, id, page.components);
      return page;
    },
    getNextPageParam: (lastPage) => lastPage.next_cursor,
  });
}

function seedComponentThreads(
  qc: QueryClient,
  campId: number,
  components: CampComponent[],
): void {
  for (const component of components) {
    if (component.kind === "technique") {
      qc.setQueryData(qk.threads("camp_technique", component.id, campId), component.threads);
    } else if (component.kind === "video") {
      qc.setQueryData(qk.threads("video", component.id), component.threads);
    } else if (component.thread) {
      qc.setQueryData(qk.thread(component.id), component.thread);
    }
  }
}

// ---- Camps ----

export function useCampsForStudent(studentId: number | undefined) {
  return useQuery({
    queryKey: qk.campsForStudent(studentId ?? 0),
    queryFn: whenId(studentId, getCampsForStudent),
  });
}

export function useCamp(id: number | undefined) {
  return useQuery({
    queryKey: qk.camp(id ?? 0),
    queryFn: whenId(id, getCamp),
  });
}

/**
 * The camp's attached techniques. Separate from the library list because a
 * camp-scoped technique (is_global = 0) never appears there, so camp surfaces
 * that read the library alone cannot hydrate one.
 */
export function useCampTechniques(campId: number | undefined) {
  return useQuery({
    queryKey: qk.campTechniques(campId ?? 0),
    queryFn: whenId(campId, getCampTechniques),
  });
}

export function useCampVideos(campId: number | undefined) {
  return useQuery({
    queryKey: qk.campVideos(campId ?? 0),
    queryFn: whenId(campId, getCampVideos),
  });
}

/**
 * Camp search query. Only fires when q.trim() is non-empty and campId is valid.
 * Results are cached per (campId, q, kind) triple so flipping kind chips is
 * instant on a warm cache.
 */
export function useCampSearch(
  campId: number | undefined,
  q: string,
  kind?: "technique" | "video" | "thread",
) {
  const trimmed = q.trim();
  const valid =
    typeof campId === "number" && Number.isFinite(campId) && trimmed.length > 0;
  return useQuery({
    queryKey: qk.campSearch(campId ?? 0, trimmed, kind),
    queryFn: valid ? () => searchCamp(campId as number, trimmed, kind) : skipToken,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

// ---- Threads ----

/**
 * One thread by id, for a surface addressing a single thread by URL (a camp's
 * thread page). Polls a processing clip to playable on the same rule the anchor
 * list uses, so a video reply behaves the same whichever surface shows it.
 */
export function useThread(threadId: number | undefined) {
  return useQuery({
    queryKey: qk.thread(threadId ?? 0),
    queryFn: whenId(threadId, getThread),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const processing =
        data.video?.processing_status === "processing" ||
        data.comments.some((c) => c.video?.processing_status === "processing");
      return processing ? 1500 : false;
    },
  });
}

export function useThreadsForAnchor(
  anchorKind: AnchorKind,
  anchorId: number | undefined,
  campId?: number,
) {
  // camp_technique lists are scoped to a (technique, camp) pair so they cache
  // and invalidate separately from the global-library technique conversation.
  const keyCampId = anchorKind === "camp_technique" ? campId : undefined;
  return useQuery({
    queryKey: qk.threads(anchorKind, anchorId ?? 0, keyCampId),
    queryFn: whenId(anchorId, (id) => listThreads(anchorKind, id, keyCampId)),
    // A freshly posted video reply lands in the "processing" state; poll until
    // every attached clip (root or comment) resolves to playable.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const processing = data.some(
        (t) =>
          t.video?.processing_status === "processing" ||
          t.comments.some((c) => c.video?.processing_status === "processing"),
      );
      return processing ? 1500 : false;
    },
  });
}

