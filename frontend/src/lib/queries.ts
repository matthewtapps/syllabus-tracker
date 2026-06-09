import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import {
  getAdminStorage,
  getAllTags,
  getAllUsers,
  getAttemptHeatmap,
  getAttemptSparkline,
  getAttemptSummary,
  getCapabilities,
  getSyllabus,
  getSyllabusStudents,
  getSyllabuses,
  getCurrentUser,
  getDashboardVideoOverview,
  getLibraryStats,
  getLibraryTechniques,
  getLibraryTechniqueStats,
  getRecentAttemptsForStudent,
  getStudentFeed,
  getStudentTechniqueDetail,
  getStudentTechniques,
  getStudents,
  getTechniquesForAssignment,
  getVideoStats,
  getVideoStatus,
  listAttempts,
  listVideos,
  type VisibilityCtx,
} from "./api";
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

export function useAttemptHeatmap(studentId: number | undefined) {
  return useQuery({
    queryKey: qk.attemptHeatmap(studentId ?? 0),
    queryFn: whenId(studentId, getAttemptHeatmap),
  });
}

export function useAttemptSparkline(stId: number | undefined, weeks: number = 12) {
  return useQuery({
    queryKey: qk.attemptSparkline(stId ?? 0, weeks),
    queryFn:
      typeof stId === "number" && Number.isFinite(stId)
        ? () => getAttemptSparkline(stId, weeks)
        : skipToken,
  });
}

export function useRecentAttempts(studentId: number | undefined, limit: number = 5) {
  return useQuery({
    queryKey: qk.recentAttempts(studentId ?? 0, limit),
    queryFn:
      typeof studentId === "number" && Number.isFinite(studentId)
        ? () => getRecentAttemptsForStudent(studentId, limit)
        : skipToken,
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

// ---- Syllabuses ----

export function useSyllabuses() {
  return useQuery({
    queryKey: qk.syllabuses(),
    queryFn: getSyllabuses,
  });
}

export function useSyllabus(id: number | undefined) {
  return useQuery({
    queryKey: qk.syllabus(id ?? 0),
    queryFn: whenId(id, getSyllabus),
  });
}

export function useSyllabusStudents(syllabusId: number | undefined) {
  return useQuery({
    queryKey: qk.syllabusStudents(syllabusId ?? 0),
    queryFn: whenId(syllabusId, getSyllabusStudents),
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

export function useLibraryTechniqueStats(
  techniqueId: number | undefined,
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: qk.libraryTechniqueStats(techniqueId ?? 0),
    queryFn:
      enabled && typeof techniqueId === "number" && Number.isFinite(techniqueId)
        ? () => getLibraryTechniqueStats(techniqueId)
        : skipToken,
  });
}

export function useStudentFeed(studentId: number | undefined) {
  return useQuery({
    queryKey: qk.studentFeed(studentId ?? 0),
    queryFn:
      typeof studentId === "number" && Number.isFinite(studentId)
        ? () => getStudentFeed(studentId)
        : skipToken,
    staleTime: 0,
    refetchOnWindowFocus: true,
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
  ctx?: VisibilityCtx,
) {
  return useQuery({
    queryKey: qk.techniqueVideos(techniqueId ?? 0, forStudent ?? null, ctx ?? null),
    queryFn:
      typeof techniqueId === "number" && Number.isFinite(techniqueId)
        ? () => listVideos(techniqueId, { forStudent, ctx })
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

// Status endpoint for a single video; polls while still processing.
export function useVideoStatus(videoId: number | undefined, enabled: boolean = true) {
  return useQuery({
    queryKey: qk.videoStatus(videoId ?? 0),
    queryFn:
      enabled && typeof videoId === "number" && Number.isFinite(videoId)
        ? () => getVideoStatus(videoId)
        : skipToken,
    refetchInterval: (query) =>
      query.state.data?.processing_status === "processing" ? 2000 : false,
  });
}

export function useVideoStats(videoId: number | undefined) {
  return useQuery({
    queryKey: qk.videoStats(videoId ?? 0),
    queryFn: whenId(videoId, getVideoStats),
  });
}

export function useDashboardVideoOverview(enabled: boolean = true) {
  return useQuery({
    queryKey: qk.dashboardVideoOverview(),
    queryFn: enabled ? getDashboardVideoOverview : skipToken,
  });
}

export function useAdminStorage(enabled: boolean = true) {
  return useQuery({
    queryKey: qk.adminStorage(),
    queryFn: enabled ? getAdminStorage : skipToken,
  });
}
