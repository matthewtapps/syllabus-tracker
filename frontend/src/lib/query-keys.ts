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

  studentTechnique: (stId: number) => ["studentTechnique", stId] as const,
  attempts: (stId: number) => ["studentTechnique", stId, "attempts"] as const,

  tags: () => ["tags"] as const,

  collections: () => ["collections"] as const,
  collection: (id: number) => ["collection", id] as const,
  collectionStudents: (id: number) => ["collection", id, "students"] as const,

  libraryStats: () => ["libraryStats"] as const,
  libraryTechniques: () => ["libraryTechniques"] as const,

  studentLibrary: (studentId: number) =>
    ["student", studentId, "library"] as const,
  pinnedTechniques: (studentId: number) =>
    ["student", studentId, "pinned_techniques"] as const,

  syllabi: () => ["syllabi"] as const,
  syllabus: (sid: number) => ["syllabus", sid] as const,
  syllabusTechniques: (sid: number) => ["syllabus", sid, "techniques"] as const,
  syllabusStudents: (sid: number) => ["syllabus", sid, "students"] as const,
  studentSyllabi: (studentId: number) =>
    ["student", studentId, "syllabi"] as const,
  studentSyllabusTechniques: (studentId: number, syllabusId: number) =>
    ["student", studentId, "syllabus", syllabusId, "techniques"] as const,
  syllabusAttempts: (sstId: number) =>
    ["syllabus", "sst", sstId, "attempts"] as const,
  studentSyllabusDiff: (studentId: number, syllabusId: number) =>
    ["student", studentId, "syllabus", syllabusId, "diff"] as const,
  syllabusTechniqueVideos: (
    studentId: number,
    syllabusId: number,
    techniqueId: number,
  ) =>
    [
      "student",
      studentId,
      "syllabus",
      syllabusId,
      "technique",
      techniqueId,
      "videos",
    ] as const,

  techniqueVideos: (techniqueId: number, forStudent: number | null = null) =>
    ["technique", techniqueId, "videos", forStudent] as const,
  // Prefix matcher for all `techniqueVideos` cache buckets for a technique,
  // regardless of `forStudent`. Use when invalidating after a mutation that
  // could affect every viewer's copy of the list.
  techniqueVideosAll: (techniqueId: number) =>
    ["technique", techniqueId, "videos"] as const,
  videoStats: (videoId: number) => ["video", videoId, "stats"] as const,

  // Limit omitted -> the ["activity", "feed"] prefix, which invalidateQueries
  // matches against every per-limit variant.
  activityFeed: (limit?: number) =>
    limit === undefined
      ? (["activity", "feed"] as const)
      : (["activity", "feed", limit] as const),
  activityDigest: () => ["activity", "digest"] as const,
  dashboardActivityFeed: () => ["activity", "dashboard-feed"] as const,
  studentActivityFeed: (studentId: number, limit: number) =>
    ["student", studentId, "activityFeed", limit] as const,
  // Infinite (paginated) feeds for the social feed surface.
  activityFeedInfinite: (limit: number) =>
    ["activity", "feed", "infinite", limit] as const,
  studentActivityFeedInfinite: (studentId: number, limit: number) =>
    ["student", studentId, "activityFeed", "infinite", limit] as const,
  // Feed head id, polled to drive the "new activity" pill.
  activityFeedHeadId: () => ["activity", "feed", "headId"] as const,
  activityUnreadCount: () => ["activity", "unreadCount"] as const,

  campsForStudent: (studentId: number) =>
    ["camps", "student", studentId] as const,
  camp: (id: number) => ["camps", id] as const,
  campVideos: (campId: number) => ["camps", campId, "videos"] as const,
  // Camp-only reference videos for a (camp, technique). Distinct bucket from
  // both `campVideos` (all of a camp's footage) and `techniqueVideos` (the
  // technique's global videos).
  campTechniqueVideos: (campId: number, techniqueId: number) =>
    ["camps", campId, "techniques", techniqueId, "videos"] as const,

  // camp_technique lists are cached per (technique, camp) so a technique's
  // camp-scoped conversation never collides with its global-library one.
  threads: (anchorKind: string, anchorId: number, campId?: number) =>
    campId === undefined
      ? (["threads", anchorKind, anchorId] as const)
      : (["threads", anchorKind, anchorId, "camp", campId] as const),
  thread: (id: number) => ["thread", id] as const,

  studentSyllabusTechniquesFlat: (studentId: number) =>
    ["student", studentId, "syllabusTechniquesFlat"] as const,
  studentRecentSyllabusAttempts: (studentId: number, limit: number) =>
    ["student", studentId, "recentSyllabusAttempts", limit] as const,
  studentSyllabusAttemptHeatmap: (studentId: number) =>
    ["student", studentId, "syllabusAttemptHeatmap"] as const,

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
    anyCollection: (q: Query) => q.queryKey[0] === "collection",
    anyTechniqueVideos: (q: Query) =>
      q.queryKey[0] === "technique" && q.queryKey[2] === "videos",
    anyStudentSyllabusTechniques: (q: Query) =>
      q.queryKey[0] === "student" &&
      q.queryKey[2] === "syllabus" &&
      q.queryKey[4] === "techniques",
    anySyllabus: (q: Query) => q.queryKey[0] === "syllabus",
  },
};
