// Centralised query key factory. Hierarchical so partial invalidation works:
// invalidating `qk.student(id)` also matches `qk.studentTechniques(id)`.

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

  collections: () => ["collections"] as const,
  collection: (id: number) => ["collection", id] as const,
  collectionStudents: (id: number) => ["collection", id, "students"] as const,

  libraryStats: () => ["libraryStats"] as const,
  libraryTechniques: () => ["libraryTechniques"] as const,

  techniqueVideos: (techniqueId: number) =>
    ["technique", techniqueId, "videos"] as const,
  videoStatus: (videoId: number) => ["video", videoId, "status"] as const,
  videoStats: (videoId: number) => ["video", videoId, "stats"] as const,

  dashboardVideoOverview: () => ["dashboard", "videoOverview"] as const,
  adminStorage: () => ["admin", "storage"] as const,
};
