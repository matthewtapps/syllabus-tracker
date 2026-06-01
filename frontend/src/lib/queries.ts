import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  getAdminStorage,
  getAllTags,
  getAllUsers,
  getAttemptHeatmap,
  getAttemptSparkline,
  getAttemptSummary,
  getCapabilities,
  getCollection,
  getCollectionStudents,
  getCollections,
  getCurrentUser,
  getDashboardVideoOverview,
  getLibraryStats,
  getLibraryTechniques,
  getRecentAttemptsForStudent,
  getStudentTechniqueDetail,
  getStudentTechniques,
  getStudents,
  getTechniquesForAssignment,
  getVideoStats,
  getVideoStatus,
  listAttempts,
  listVideos,
} from "./api";
import { qk } from "./query-keys";

// ---- Auth / session ----

export function useCurrentUser() {
  return useQuery({
    queryKey: qk.currentUser(),
    queryFn: getCurrentUser,
  });
}

export function useCapabilities() {
  return useQuery({
    queryKey: qk.capabilities(),
    queryFn: getCapabilities,
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

export function useStudentTechniques(studentId: number | undefined) {
  return useQuery({
    queryKey: qk.studentTechniques(studentId ?? 0),
    queryFn: () => getStudentTechniques(studentId as number),
    enabled: typeof studentId === "number" && Number.isFinite(studentId),
  });
}

export function useStudentTechniqueDetail(stId: number | undefined) {
  return useQuery({
    queryKey: qk.studentTechnique(stId ?? 0),
    queryFn: () => getStudentTechniqueDetail(stId as number),
    enabled: typeof stId === "number" && Number.isFinite(stId),
  });
}

export function useStudentUnassignedTechniques(studentId: number | undefined) {
  return useQuery({
    queryKey: qk.studentUnassigned(studentId ?? 0),
    queryFn: () => getTechniquesForAssignment(studentId as number),
    enabled: typeof studentId === "number" && Number.isFinite(studentId),
  });
}

// ---- Attempts ----

export function useAttempts(stId: number | undefined) {
  return useQuery({
    queryKey: qk.attempts(stId ?? 0),
    queryFn: () => listAttempts(stId as number),
    enabled: typeof stId === "number" && Number.isFinite(stId),
  });
}

export function useAttemptSummary(studentId: number | undefined) {
  return useQuery({
    queryKey: qk.attemptSummary(studentId ?? 0),
    queryFn: () => getAttemptSummary(studentId as number),
    enabled: typeof studentId === "number" && Number.isFinite(studentId),
  });
}

export function useAttemptHeatmap(studentId: number | undefined) {
  return useQuery({
    queryKey: qk.attemptHeatmap(studentId ?? 0),
    queryFn: () => getAttemptHeatmap(studentId as number),
    enabled: typeof studentId === "number" && Number.isFinite(studentId),
  });
}

export function useAttemptSparkline(stId: number | undefined, weeks: number = 12) {
  return useQuery({
    queryKey: qk.attemptSparkline(stId ?? 0, weeks),
    queryFn: () => getAttemptSparkline(stId as number, weeks),
    enabled: typeof stId === "number" && Number.isFinite(stId),
  });
}

export function useRecentAttempts(studentId: number | undefined, limit: number = 5) {
  return useQuery({
    queryKey: qk.recentAttempts(studentId ?? 0, limit),
    queryFn: () => getRecentAttemptsForStudent(studentId as number, limit),
    enabled: typeof studentId === "number" && Number.isFinite(studentId),
  });
}

// ---- Tags ----

export function useAllTags() {
  return useQuery({
    queryKey: qk.tags(),
    queryFn: getAllTags,
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
    queryFn: () => getCollection(id as number),
    enabled: typeof id === "number" && Number.isFinite(id),
  });
}

export function useCollectionStudents(collectionId: number | undefined) {
  return useQuery({
    queryKey: qk.collectionStudents(collectionId ?? 0),
    queryFn: () => getCollectionStudents(collectionId as number),
    enabled: typeof collectionId === "number" && Number.isFinite(collectionId),
  });
}

// ---- Library stats ----

export function useLibraryStats() {
  return useQuery({
    queryKey: qk.libraryStats(),
    queryFn: getLibraryStats,
  });
}

export function useLibraryTechniques() {
  return useQuery({
    queryKey: qk.libraryTechniques(),
    queryFn: getLibraryTechniques,
  });
}

// ---- Videos ----

// Polls every 2s while any video is still processing; otherwise no interval.
export function useTechniqueVideos(techniqueId: number | undefined) {
  return useQuery({
    queryKey: qk.techniqueVideos(techniqueId ?? 0),
    queryFn: () => listVideos(techniqueId as number),
    enabled: typeof techniqueId === "number" && Number.isFinite(techniqueId),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      return data.some((v) => v.processing_status === "processing") ? 2000 : false;
    },
  });
}

// Status endpoint for a single video; polls while still processing.
export function useVideoStatus(videoId: number | undefined, enabled: boolean = true) {
  return useQuery({
    queryKey: qk.videoStatus(videoId ?? 0),
    queryFn: () => getVideoStatus(videoId as number),
    enabled: enabled && typeof videoId === "number" && Number.isFinite(videoId),
    refetchInterval: (query) =>
      query.state.data?.processing_status === "processing" ? 2000 : false,
  });
}

export function useVideoStats(videoId: number | undefined) {
  return useQuery({
    queryKey: qk.videoStats(videoId ?? 0),
    queryFn: () => getVideoStats(videoId as number),
    enabled: typeof videoId === "number" && Number.isFinite(videoId),
  });
}

export function useDashboardVideoOverview(enabled: boolean = true) {
  return useQuery({
    queryKey: qk.dashboardVideoOverview(),
    queryFn: getDashboardVideoOverview,
    enabled,
  });
}

export function useAdminStorage(enabled: boolean = true) {
  return useQuery({
    queryKey: qk.adminStorage(),
    queryFn: getAdminStorage,
    enabled,
  });
}
