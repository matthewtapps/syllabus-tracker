// Centralised query key factory. Hierarchical so partial invalidation works:
// invalidating `qk.student(id)` also matches `qk.studentTechniques(id)`.
import type { Query } from "@tanstack/react-query";

export const qk = {
  currentUser: () => ["currentUser"] as const,
  capabilities: () => ["capabilities"] as const,

  users: () => ["users"] as const,

  students: (sort?: string, includeArchived?: boolean) =>
    ["students", { sort: sort ?? null, includeArchived: !!includeArchived }] as const,

  student: (id: number) => ["student", id] as const,
  studentTechniques: (id: number) => ["student", id, "techniques"] as const,
  studentUnassigned: (id: number) => ["student", id, "unassignedTechniques"] as const,
  attemptSummary: (id: number) => ["student", id, "attemptSummary"] as const,
  attemptHeatmap: (id: number) => ["student", id, "attemptHeatmap"] as const,
  recentAttempts: (id: number, limit: number) =>
    ["student", id, "recentAttempts", limit] as const,

  studentTechnique: (stId: number) => ["studentTechnique", stId] as const,
  attempts: (stId: number) => ["studentTechnique", stId, "attempts"] as const,
  attemptSparkline: (stId: number, weeks: number) =>
    ["studentTechnique", stId, "sparkline", weeks] as const,

  tags: () => ["tags"] as const,

  syllabuses: () => ["syllabuses"] as const,
  syllabus: (id: number) => ["syllabus", id] as const,
  syllabusStudents: (id: number) => ["syllabus", id, "students"] as const,

  libraryStats: () => ["libraryStats"] as const,
  libraryTechniques: () => ["libraryTechniques"] as const,
  libraryTechniqueStats: (id: number) =>
    ["libraryTechnique", id, "stats"] as const,

  techniqueVideos: (
    techniqueId: number,
    forStudent: number | null = null,
    ctx: string | null = null,
  ) => ["technique", techniqueId, "videos", forStudent, ctx] as const,
  studentFeed: (studentId: number) => ["student", studentId, "feed"] as const,
  studentPins: (studentId: number) => ["student", studentId, "pins"] as const,
  // Prefix matcher for all `techniqueVideos` cache buckets for a technique,
  // regardless of `forStudent`. Use when invalidating after a mutation that
  // could affect every viewer's copy of the list.
  techniqueVideosAll: (techniqueId: number) =>
    ["technique", techniqueId, "videos"] as const,
  videoStatus: (videoId: number) => ["video", videoId, "status"] as const,
  videoStats: (videoId: number) => ["video", videoId, "stats"] as const,

  dashboardVideoOverview: () => ["dashboard", "videoOverview"] as const,
  adminStorage: () => ["admin", "storage"] as const,

  // Predicate matchers for queryClient.invalidateQueries({ predicate }).
  // Keep matcher logic colocated with the keys it inspects so renaming a
  // segment in one place doesn't silently miss the other.
  matches: {
    anyStudentTechniques: (q: Query) =>
      q.queryKey[0] === "student" && q.queryKey[2] === "techniques",
    anyStudentTechniqueDetail: (q: Query) => q.queryKey[0] === "studentTechnique",
    anyStudentTechniqueScope: (q: Query) =>
      (q.queryKey[0] === "student" && q.queryKey[2] === "techniques") ||
      q.queryKey[0] === "studentTechnique",
    anySyllabus: (q: Query) => q.queryKey[0] === "syllabus",
    anyTechniqueVideos: (q: Query) =>
      q.queryKey[0] === "technique" && q.queryKey[2] === "videos",
  },
};
