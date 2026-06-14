export interface LoginCredentials {
  username: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  user?: User;
  error?: string;
  redirect_url?: string;
}

export interface Tag {
  id: number;
  name: string;
}

export async function login(
  credentials: LoginCredentials,
): Promise<LoginResponse> {
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(credentials),
      credentials: "include",
    });

    return await response.json();
  } catch {
    return {
      success: false,
      error: "Network error. Please try again.",
    };
  }
}

export async function logout(): Promise<void | null> {
  try {
    const response = await fetch("/api/logout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
    });

    return await response.json();
  } catch {
    return null;
  }
}

export type Role = "student" | "coach" | "admin";

function normaliseRole(raw: unknown): Role {
  if (typeof raw !== "string") return "student";
  const lower = raw.toLowerCase();
  if (lower === "coach" || lower === "admin" || lower === "student") return lower;
  return "student";
}

export function isCoachOrAdmin(user: User | null): user is User & {
  role: "coach" | "admin";
} {
  return !!user && (user.role === "coach" || user.role === "admin");
}

export function isAdmin(user: User | null): user is User & { role: "admin" } {
  return !!user && user.role === "admin";
}

export interface User {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  last_update?: string;
  archived: boolean;
  graduated_at?: string | null;
  email?: string | null;
  claimed_at?: string | null;
  approved_at?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  reset_requested_at?: string | null;
  last_coach_update_at?: string | null;
  total_techniques?: number | null;
  red_count?: number | null;
  amber_count?: number | null;
  green_count?: number | null;
  has_unseen_activity?: boolean | null;
  last_student_initiative_at?: string | null;
  last_watch_at?: string | null;
  last_watch_video_title?: string | null;
  last_student_activity_at?: string | null;
  last_coach_activity_at?: string | null;
  pinned_count?: number | null;
  recent_activity_count?: number | null;
}

export async function getCurrentUser(): Promise<User | null> {
  try {
    const response = await fetch("/api/me", {
      credentials: "include",
    });

    if (!response.ok) {
      return null;
    }

    const user: User = await response.json();
    return { ...user, role: normaliseRole(user.role) };
  } catch {
    return null;
  }
}

export interface Capabilities {
  videos: boolean;
}

export async function getCapabilities(): Promise<Capabilities | null> {
  try {
    const response = await fetch("/api/capabilities", {
      credentials: "include",
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

// Get unassigned techniques for a student
export async function getTechniquesForAssignment(
  studentId: number,
): Promise<AssignableTechnique[]> {
  const response = await fetch(
    `/api/student/${studentId}/unassigned_techniques`,
    {
      credentials: "include",
    },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch unassigned techniques: ${response.statusText}`,
    );
  }

  return await response.json();
}

export async function assignTechniquesToStudent(
  studentId: number,
  techniqueIds: number[],
  collectionId?: number | null,
): Promise<Response> {
  return await fetch(`/api/student/${studentId}/add_techniques`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      technique_ids: techniqueIds,
      collection_id: collectionId ?? null,
    }),
    credentials: "include",
  });
}

export async function createAndAssignTechnique(
  studentId: number,
  name: string,
  description: string,
  collectionId?: number | null,
): Promise<Response> {
  return await fetch(`/api/student/${studentId}/create_technique`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      description,
      collection_id: collectionId ?? null,
    }),
    credentials: "include",
  });
}

export interface Technique {
  id: number;
  technique_id: number;
  technique_name: string;
  technique_description: string;
  status: "red" | "amber" | "green";
  student_notes: string;
  coach_notes: string;
  created_at: string;
  updated_at: string;
  last_coach_update_at: string | null;
  last_coach_update_by_name: string | null;
  last_student_update_at: string | null;
  last_student_update_by_name: string | null;
  has_unseen_activity: boolean;
  collection_id: number | null;
  collection_name: string | null;
  tags: Tag[];
  attempt_count: number;
  last_attempt_at: string | null;
}

export interface LibraryTechnique {
  id: number;
  name: string;
  description: string;
  coach_id: number;
  coach_name: string;
}

/// Shape returned by `/api/student/<id>/unassigned_techniques`. Includes the
/// library tags so assignment dialogs can show them as chips.
export interface AssignableTechnique extends LibraryTechnique {
  tags: Tag[];
}

export interface Collection {
  id: number;
  name: string;
  description: string;
  coach_id: number | null;
  created_at: string;
  technique_count: number;
  student_count: number;
  techniques: LibraryTechnique[];
  can_create_techniques: boolean;
  can_edit_all_techniques: boolean;
}

export async function getCollections(): Promise<Collection[]> {
  const response = await fetch("/api/collections", { credentials: "include" });
  if (!response.ok) throw new Error("Failed to fetch collections");
  return await response.json();
}

export async function getCollection(id: number): Promise<Collection> {
  const response = await fetch(`/api/collections/${id}`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to fetch collection");
  return await response.json();
}

export async function createCollection(data: {
  name: string;
  description?: string;
}): Promise<Response> {
  return await fetch("/api/collections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    credentials: "include",
  });
}

export async function updateCollection(
  id: number,
  data: { name: string; description?: string },
): Promise<Response> {
  return await fetch(`/api/collections/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    credentials: "include",
  });
}

export async function deleteCollection(id: number): Promise<Response> {
  return await fetch(`/api/collections/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
}

export async function addTechniquesToCollection(
  collectionId: number,
  techniqueIds: number[],
): Promise<Response> {
  return await fetch(`/api/collections/${collectionId}/techniques`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ technique_ids: techniqueIds }),
    credentials: "include",
  });
}

export async function createTechniqueInCollection(
  collectionId: number,
  name: string,
  description: string,
): Promise<Response> {
  return await fetch(`/api/collections/${collectionId}/create_technique`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description }),
    credentials: "include",
  });
}

export async function updateLibraryTechnique(
  techniqueId: number,
  data: { name: string; description: string },
): Promise<Response> {
  return await fetch(`/api/techniques/${techniqueId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    credentials: "include",
  });
}

export async function removeTechniqueFromCollection(
  collectionId: number,
  techniqueId: number,
): Promise<Response> {
  return await fetch(
    `/api/collections/${collectionId}/techniques/${techniqueId}`,
    {
      method: "DELETE",
      credentials: "include",
    },
  );
}

export async function getCollectionStudents(
  collectionId: number,
): Promise<User[]> {
  const response = await fetch(`/api/collections/${collectionId}/students`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to fetch collection students");
  return await response.json();
}

export async function assignCollectionToStudent(
  studentId: number,
  collectionId: number,
): Promise<Response> {
  return await fetch(
    `/api/student/${studentId}/assign_collection/${collectionId}`,
    {
      method: "POST",
      credentials: "include",
    },
  );
}

export interface StudentTechniques {
  student: User;
  techniques: Technique[];
  can_edit_all_techniques: boolean;
  can_assign_techniques: boolean;
  can_create_techniques: boolean;
  can_manage_tags: boolean;
}

export interface SingleStudentTechnique {
  technique: Technique;
  student: User;
  can_edit_all_techniques: boolean;
  can_manage_tags: boolean;
}

export async function getStudentTechniqueDetail(
  studentTechniqueId: number,
): Promise<SingleStudentTechnique> {
  const response = await fetch(`/api/student_technique/${studentTechniqueId}`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to fetch technique");
  return await response.json();
}

export async function getStudentTechniques(
  studentId: number,
): Promise<StudentTechniques> {
  const response = await fetch(`/api/student/${studentId}/techniques`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch techniques: ${response.statusText}`);
  }

  return await response.json();
}

export interface TechniqueUpdate {
  status?: "red" | "amber" | "green";
  student_notes?: string;
  coach_notes?: string;
  technique_name?: string;
  technique_description?: string;
}

export async function updateTechnique(
  techniqueId: number,
  updates: TechniqueUpdate,
): Promise<Response> {
  const response = await fetch(`/api/student_technique/${techniqueId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updates),
    credentials: "include",
  });

  return response; // Return raw response instead of throwing
}

export async function getStudents(
  sortBy?: string,
  includeArchived: boolean = false,
): Promise<User[]> {
  let url = "/api/students?";

  const params = new URLSearchParams();
  if (sortBy) {
    params.append("sort_by", sortBy);
  }
  if (includeArchived) {
    params.append("include_archived", "true");
  }

  url += params.toString();

  const response = await fetch(url, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch students");
  }

  return await response.json();
}

export interface ProfileUpdateData {
  display_name: string;
  username?: string;
}

export async function updateUserProfile(
  data: ProfileUpdateData,
): Promise<Response> {
  const response = await fetch("/api/profile", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
    credentials: "include",
  });

  return response; // Return raw response
}

export interface PasswordUpdateData {
  current_password: string;
  new_password: string;
}

export async function updatePassword(
  data: PasswordUpdateData,
): Promise<Response> {
  const response = await fetch("/api/change-password", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
    credentials: "include",
  });

  return response; // Return raw response
}

export interface UserRegistrationData {
  username: string;
  display_name: string;
  password: string;
  confirm_password: string;
  role: string;
}

export async function registerUser(
  data: UserRegistrationData,
): Promise<Response> {
  return await fetch("/api/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
    credentials: "include",
  });
}

export interface UserUpdateData {
  username?: string;
  display_name?: string;
  password?: string;
  archived?: boolean;
  graduated?: boolean;
  role?: string;
}

export async function updateUser(
  userId: number,
  data: UserUpdateData,
): Promise<Response> {
  return await fetch(`/api/admin/users/${userId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
    credentials: "include",
  });
}

export async function getAllTags(): Promise<Tag[]> {
  const response = await fetch("/api/tags", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch tags: ${response.statusText}`);
  }

  const data = await response.json();
  return data.tags;
}

export async function createTag(name: string): Promise<Response> {
  const response = await fetch("/api/tags", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
    credentials: "include",
  });

  return response;
}

export async function deleteTag(tagId: number): Promise<Response> {
  const response = await fetch(`/api/tags/${tagId}`, {
    method: "DELETE",
    credentials: "include",
  });

  return response;
}

export async function addTagToTechnique(
  techniqueId: number,
  tagId: number,
): Promise<Response> {
  const response = await fetch("/api/technique/tag", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ technique_id: techniqueId, tag_id: tagId }),
    credentials: "include",
  });

  return response;
}

export async function removeTagFromTechnique(
  techniqueId: number,
  tagId: number,
): Promise<Response> {
  const response = await fetch(
    `/api/technique/${techniqueId}/tag/${tagId}`,
    {
      method: "DELETE",
      credentials: "include",
    },
  );

  return response;
}

export async function getAllUsers(): Promise<User[]> {
  const response = await fetch("/api/admin/users", {
    credentials: "include",
  });

  const users: User[] = await response.json();
  return users.map((u) => ({ ...u, role: normaliseRole(u.role) }));
}

export async function markStudentTechniqueSeen(id: number): Promise<void> {
  try {
    await fetch(`/api/student_technique/${id}/mark_seen`, {
      method: "POST",
      credentials: "include",
    });
  } catch (err) {
    console.error("Failed to mark technique seen", err);
  }
}

export interface InviteUserData {
  display_name: string;
  role: string;
}

export interface InviteResponse {
  user_id: number;
  token: string;
  claim_path: string;
}

export async function inviteUser(
  data: InviteUserData,
): Promise<Response> {
  return await fetch("/api/admin/invite_user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    credentials: "include",
  });
}

export interface InviteInfo {
  display_name: string;
  email: string | null;
  role: string;
}

export async function getInvite(token: string): Promise<Response> {
  return await fetch(`/api/invite/${encodeURIComponent(token)}`, {
    credentials: "include",
  });
}

export interface ClaimInviteData {
  username: string;
  password: string;
}

export async function claimInvite(
  token: string,
  data: ClaimInviteData,
): Promise<Response> {
  return await fetch(`/api/invite/${encodeURIComponent(token)}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    credentials: "include",
  });
}

export interface SelfRegisterData {
  username: string;
  password: string;
  first_name?: string;
  last_name?: string;
}

export async function requestPasswordReset(username: string): Promise<Response> {
  return await fetch("/api/forgot_password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
    credentials: "include",
  });
}

export async function selfRegister(data: SelfRegisterData): Promise<Response> {
  return await fetch("/api/register/self", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    credentials: "include",
  });
}

export async function approveUser(userId: number): Promise<Response> {
  return await fetch(`/api/admin/users/${userId}/approve`, {
    method: "POST",
    credentials: "include",
  });
}

export async function resetUserClaim(userId: number): Promise<Response> {
  return await fetch(`/api/admin/users/${userId}/reset_claim`, {
    method: "POST",
    credentials: "include",
  });
}

export async function setStudentGraduated(
  studentId: number,
  graduated: boolean,
): Promise<Response> {
  return await fetch(`/api/student/${studentId}/graduate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graduated }),
    credentials: "include",
  });
}

export interface LibraryStats {
  total_techniques: number;
}

export async function getLibraryStats(): Promise<LibraryStats> {
  const response = await fetch("/api/library/stats", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch library stats");
  }

  return await response.json();
}

export interface LibraryTechniqueRow {
  id: number;
  name: string;
  description: string;
  tags: Tag[];
  /** IDs of every collection this technique belongs to. */
  collection_ids: number[];
  collection_count: number;
  student_count: number;
  video_count: number;
  last_activity_at: string | null;
  /**
   * Always present. Coach-facing endpoints return false; the student
   * library endpoint sets true when the viewing student has the technique
   * pinned.
   */
  is_pinned: boolean;
}

export async function getLibraryTechniques(): Promise<LibraryTechniqueRow[]> {
  const response = await fetch("/api/techniques", {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Failed to fetch techniques");
  }
  return await response.json();
}

export async function getStudentLibrary(
  studentId: number,
): Promise<LibraryTechniqueRow[]> {
  const response = await fetch(`/api/student/${studentId}/library`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Failed to fetch student library");
  }
  return await response.json();
}

export async function getStudentPinnedTechniques(
  studentId: number,
): Promise<LibraryTechniqueRow[]> {
  const response = await fetch(`/api/student/${studentId}/pinned_techniques`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Failed to fetch pinned techniques");
  }
  return await response.json();
}

export async function pinTechniqueForStudent(
  studentId: number,
  techniqueId: number,
): Promise<void> {
  const response = await fetch(`/api/student/${studentId}/pinned_techniques`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ technique_id: techniqueId }),
  });
  if (!response.ok) {
    throw new Error("Failed to pin technique");
  }
}

export async function unpinTechniqueForStudent(
  studentId: number,
  techniqueId: number,
): Promise<void> {
  const response = await fetch(
    `/api/student/${studentId}/pinned_techniques/${techniqueId}`,
    {
      method: "DELETE",
      credentials: "include",
    },
  );
  if (!response.ok) {
    throw new Error("Failed to unpin technique");
  }
}

export interface LibraryTechniqueCollectionRef {
  id: number;
  name: string;
}

export interface AttemptWeekBucket {
  date: string;
  count: number;
}

export interface LibraryTechniqueStats {
  collections: LibraryTechniqueCollectionRef[];
  status_counts: { red: number; amber: number; green: number };
  attempts_30d: number;
  attempts_weekly_buckets: AttemptWeekBucket[];
  video_plays: number;
}

export async function getLibraryTechniqueStats(
  techniqueId: number,
): Promise<LibraryTechniqueStats> {
  const response = await fetch(`/api/techniques/${techniqueId}/stats`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Failed to fetch technique stats");
  }
  return await response.json();
}

// ---- Attempts ----

export interface Attempt {
  id: number;
  student_technique_id: number;
  recorded_by_id: number;
  recorded_by_name: string | null;
  attempted_at: string;
  coach_note: string | null;
  coach_note_by_id: number | null;
  coach_note_by_name: string | null;
  coach_note_at: string | null;
  student_note: string | null;
  student_note_at: string | null;
  created_at: string;
}

export interface CreateAttemptResult {
  attempt: Attempt;
  status_suggestion: "amber" | null;
}

export interface AttemptSummary {
  this_week: number;
  this_month: number;
  total: number;
}

export interface AttemptBucket {
  date: string;
  count: number;
}

export interface RecentAttemptItem {
  id: number;
  student_technique_id: number;
  technique_id: number;
  technique_name: string;
  attempted_at: string;
  coach_note: string | null;
  student_note: string | null;
}

export async function listAttempts(
  studentTechniqueId: number,
): Promise<Attempt[]> {
  const response = await fetch(
    `/api/student_technique/${studentTechniqueId}/attempts`,
    { credentials: "include" },
  );
  if (!response.ok) throw new Error("Failed to fetch attempts");
  const body = await response.json();
  return body.attempts as Attempt[];
}

export async function createAttempt(
  studentTechniqueId: number,
  data: { note?: string | null; attempted_at?: string | null } = {},
): Promise<CreateAttemptResult> {
  const response = await fetch(
    `/api/student_technique/${studentTechniqueId}/attempts`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        note: data.note ?? null,
        attempted_at: data.attempted_at ?? null,
      }),
      credentials: "include",
    },
  );
  if (!response.ok) throw response;
  return await response.json();
}

export async function updateAttempt(
  attemptId: number,
  data: {
    note?: string | null;
    clear_note?: boolean;
    attempted_at?: string | null;
  },
): Promise<Response> {
  return await fetch(`/api/attempts/${attemptId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    credentials: "include",
  });
}

export async function deleteAttempt(attemptId: number): Promise<Response> {
  return await fetch(`/api/attempts/${attemptId}`, {
    method: "DELETE",
    credentials: "include",
  });
}

export async function getRecentAttemptsForStudent(
  studentId: number,
  limit: number = 5,
): Promise<RecentAttemptItem[]> {
  const response = await fetch(
    `/api/student/${studentId}/attempts/recent?limit=${limit}`,
    { credentials: "include" },
  );
  if (!response.ok) throw new Error("Failed to fetch recent attempts");
  const body = await response.json();
  return body.attempts as RecentAttemptItem[];
}

export async function getAttemptSummary(
  studentId: number,
): Promise<AttemptSummary> {
  const response = await fetch(`/api/student/${studentId}/attempts/summary`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to fetch attempt summary");
  return await response.json();
}

export async function getAttemptHeatmap(
  studentId: number,
  from?: string,
  to?: string,
): Promise<AttemptBucket[]> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  const url = qs
    ? `/api/student/${studentId}/attempts/heatmap?${qs}`
    : `/api/student/${studentId}/attempts/heatmap`;
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error("Failed to fetch attempt heatmap");
  const body = await response.json();
  return body.buckets as AttemptBucket[];
}

export async function getAttemptSparkline(
  studentTechniqueId: number,
  weeks: number = 12,
): Promise<AttemptBucket[]> {
  const response = await fetch(
    `/api/student_technique/${studentTechniqueId}/attempts/sparkline?weeks=${weeks}`,
    { credentials: "include" },
  );
  if (!response.ok) throw new Error("Failed to fetch sparkline");
  const body = await response.json();
  return body.buckets as AttemptBucket[];
}

export type VideoKind = "native" | "youtube" | "vimeo" | "drive" | "link";
export type ProcessingStatus = "processing" | "ready" | "failed";

export interface Video {
  id: number;
  technique_id: number;
  title: string;
  description?: string | null;
  position: number;
  kind: VideoKind;
  processing_status: ProcessingStatus;
  processing_error?: string | null;
  bytes?: number | null;
  duration_seconds?: number | null;
  width?: number | null;
  height?: number | null;
  external_url?: string | null;
  external_host?: string | null;
  external_video_id?: string | null;
  uploaded_by_id: number;
  created_at: string;
  updated_at: string;
  /** ISO timestamp when the video was globally hidden; `null` when visible.
   * Coaches always receive this. Students never see hidden videos at all. */
  hidden_at: string | null;
  /** Set only on coach views of a specific student's technique page when an
   * explicit per-student override exists for this video. Omitted otherwise. */
  override_for_student?: "show" | "hide";
}

export interface SignedUrl {
  url: string;
  expires_at: string;
}

export interface UploadResponse {
  video_id: number;
  processing_status: ProcessingStatus;
}

export async function listVideos(
  techniqueId: number,
  opts?: {
    forStudent?: number;
    /** When set, fetches the per-syllabus video list via the syllabus
     *  endpoint. Applies `student_syllabus_video_visibility` overrides
     *  on top of global visibility. Overrides `forStudent` if both are
     *  provided (the syllabus route already scopes to the student). */
    syllabus?: { studentId: number; syllabusId: number };
  },
): Promise<Video[]> {
  if (opts?.syllabus) {
    const { studentId, syllabusId } = opts.syllabus;
    const response = await fetch(
      `/api/student/${studentId}/syllabi/${syllabusId}/techniques/${techniqueId}/videos`,
      { credentials: "include" },
    );
    if (!response.ok) throw new Error("Failed to load videos");
    const body = await response.json();
    return body.videos as Video[];
  }
  const url = new URL(`/api/techniques/${techniqueId}/videos`, window.location.origin);
  if (typeof opts?.forStudent === "number") {
    url.searchParams.set("for_student", String(opts.forStudent));
  }
  const response = await fetch(url.pathname + url.search, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to load videos");
  const body = await response.json();
  return body.videos as Video[];
}

export async function setVideoGlobalHidden(
  videoId: number,
  hidden: boolean,
): Promise<Response> {
  return await fetch(`/api/videos/${videoId}/global-hidden`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hidden }),
    credentials: "include",
  });
}

export async function setVideoStudentVisibility(
  videoId: number,
  studentId: number,
  visible: boolean | null,
): Promise<Response> {
  return await fetch(`/api/videos/${videoId}/visibility/${studentId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visible }),
    credentials: "include",
  });
}

export async function getVideoStatus(
  videoId: number,
): Promise<{ processing_status: ProcessingStatus; processing_error?: string | null }> {
  const response = await fetch(`/api/videos/${videoId}/status`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to load video status");
  return await response.json();
}

export async function uploadVideo(
  techniqueId: number,
  file: File,
  fields: { title: string; description?: string },
  onProgress?: (loaded: number, total: number) => void,
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/techniques/${techniqueId}/videos/upload`);
    xhr.withCredentials = true;

    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      });
    }

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadResponse);
        } catch {
          reject(new Error("Invalid response from server"));
        }
      } else {
        // Synthesise a Response so TracedForm can extract validation errors.
        reject(
          new Response(xhr.responseText || null, {
            status: xhr.status,
            statusText: xhr.statusText,
          }),
        );
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
    xhr.addEventListener("abort", () => reject(new Error("Upload was cancelled")));

    const body = new FormData();
    body.append("file", file);
    body.append("title", fields.title);
    if (fields.description) body.append("description", fields.description);

    xhr.send(body);
  });
}

export async function linkVideo(
  techniqueId: number,
  payload: { title: string; description?: string; url: string },
): Promise<Video> {
  const response = await fetch(`/api/techniques/${techniqueId}/videos/link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw response;
  return (await response.json()) as Video;
}

export async function updateVideo(
  videoId: number,
  payload: { title?: string; description?: string; position?: number },
): Promise<void> {
  const response = await fetch(`/api/videos/${videoId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw response;
}

export async function reorderVideos(
  techniqueId: number,
  orderedIds: number[],
): Promise<void> {
  const response = await fetch(`/api/techniques/${techniqueId}/videos/reorder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ ordered_ids: orderedIds }),
  });
  if (!response.ok) throw response;
}

export async function deleteVideo(videoId: number): Promise<void> {
  const response = await fetch(`/api/videos/${videoId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) throw response;
}

export async function getPlaybackUrl(videoId: number): Promise<SignedUrl> {
  const response = await fetch(`/api/videos/${videoId}/playback-url`, {
    credentials: "include",
  });
  if (!response.ok) throw response;
  return (await response.json()) as SignedUrl;
}

export async function getDownloadUrl(videoId: number): Promise<SignedUrl> {
  const response = await fetch(`/api/videos/${videoId}/download-url`, {
    credentials: "include",
  });
  if (!response.ok) throw response;
  return (await response.json()) as SignedUrl;
}

export interface VideoStatsSnapshot {
  video_id: number;
  unique_viewers: number;
  total_plays: number;
  completed_plays: number;
  total_seconds_watched: number;
  completion_rate: number;
}

export interface DashboardVideoRow {
  video_id: number;
  video_title: string;
  technique_id: number;
  technique_name: string;
  plays_this_window: number;
  unique_viewers: number;
}

export interface DashboardVideoOverview {
  total_seconds_watched: number;
  videos_processing: number;
  top_videos: DashboardVideoRow[];
}

export interface StorageObjectRow {
  video_id: number;
  title: string;
  technique_id: number;
  technique_name: string;
  bytes: number;
}

export interface StorageOverview {
  total_bytes: number;
  total_objects: number;
  top_objects: StorageObjectRow[];
}

export async function getVideoStats(
  videoId: number,
): Promise<VideoStatsSnapshot> {
  const response = await fetch(`/api/videos/${videoId}/stats`, {
    credentials: "include",
  });
  if (!response.ok) throw response;
  return (await response.json()) as VideoStatsSnapshot;
}

export async function getDashboardVideoOverview(): Promise<DashboardVideoOverview> {
  const response = await fetch(`/api/dashboard/video-overview`, {
    credentials: "include",
  });
  if (!response.ok) throw response;
  return (await response.json()) as DashboardVideoOverview;
}

export async function getAdminStorage(): Promise<StorageOverview> {
  const response = await fetch(`/api/admin/storage`, {
    credentials: "include",
  });
  if (!response.ok) throw response;
  return (await response.json()) as StorageOverview;
}

// ============================================================
// Syllabus stack (PR 3)
// ============================================================

export interface Syllabus {
  id: number;
  name: string;
  description: string;
  created_at: string;
  created_by_id: number | null;
  updated_at: string;
  technique_count: number;
  active_assignment_count: number;
}

export interface SyllabusTechniqueRow {
  technique_id: number;
  name: string;
  description: string;
  position: number;
  added_at: string;
  tags: Tag[];
}

export interface SyllabusDetailResponse extends Syllabus {
  techniques: SyllabusTechniqueRow[];
}

export interface SyllabusAssignment {
  id: number;
  student_id: number;
  syllabus_id: number;
  syllabus_name: string;
  assigned_at: string;
  assigned_by_id: number | null;
  unassigned_at: string | null;
  unassigned_by_id: number | null;
  graduated_at: string | null;
  graduated_by_id: number | null;
  red_count: number;
  amber_count: number;
  green_count: number;
  total_count: number;
}

export interface SstRow {
  id: number;
  assignment_id: number;
  technique_id: number;
  technique_name: string;
  technique_description: string;
  status: "red" | "amber" | "green";
  student_notes: string;
  coach_notes: string;
  hidden_at: string | null;
  created_at: string;
  updated_at: string;
  last_coach_update_at: string | null;
  last_coach_update_by_id: number | null;
  last_student_update_at: string | null;
  last_student_update_by_id: number | null;
  tags: Tag[];
  attempt_count: number;
  last_attempt_at: string | null;
  /** Alive videos on the technique (global library; student-specific is future). */
  video_count: number;
}

export interface StudentSyllabusDetailResponse {
  assignment: SyllabusAssignment;
  techniques: SstRow[];
}

export interface SyllabusAttempt {
  id: number;
  student_syllabus_technique_id: number;
  recorded_by_id: number;
  attempted_at: string;
  coach_note: string | null;
  coach_note_by_id: number | null;
  coach_note_at: string | null;
  student_note: string | null;
  student_note_at: string | null;
  created_at: string;
}

export type PropagationMode = "syllabus_only" | "cascade";

export async function getSyllabi(): Promise<Syllabus[]> {
  const response = await fetch("/api/syllabi", { credentials: "include" });
  if (!response.ok) throw response;
  return await response.json();
}

export async function getSyllabusDetail(
  syllabusId: number,
): Promise<SyllabusDetailResponse> {
  const response = await fetch(`/api/syllabi/${syllabusId}`, {
    credentials: "include",
  });
  if (!response.ok) throw response;
  return await response.json();
}

export async function createSyllabusApi(data: {
  name: string;
  description?: string;
}): Promise<{ id: number }> {
  const response = await fetch("/api/syllabi", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw response;
  return await response.json();
}

export async function updateSyllabusApi(
  syllabusId: number,
  data: { name?: string; description?: string | null },
): Promise<void> {
  const response = await fetch(`/api/syllabi/${syllabusId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw response;
}

export async function deleteSyllabusApi(syllabusId: number): Promise<void> {
  const response = await fetch(`/api/syllabi/${syllabusId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) throw response;
}

export async function addTechniqueToSyllabusApi(
  syllabusId: number,
  techniqueId: number,
  propagation: PropagationMode,
): Promise<void> {
  const response = await fetch(`/api/syllabi/${syllabusId}/techniques`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ technique_id: techniqueId, propagation }),
  });
  if (!response.ok) throw response;
}

export async function removeTechniqueFromSyllabusApi(
  syllabusId: number,
  techniqueId: number,
  propagation: PropagationMode,
): Promise<void> {
  const url = `/api/syllabi/${syllabusId}/techniques/${techniqueId}?propagation=${propagation}`;
  const response = await fetch(url, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) throw response;
}

export async function assignSyllabusApi(
  studentId: number,
  syllabusId: number,
): Promise<{ id: number }> {
  const response = await fetch(
    `/api/student/${studentId}/syllabi/${syllabusId}/assignment`,
    { method: "POST", credentials: "include" },
  );
  if (!response.ok) throw response;
  return await response.json();
}

export async function unassignSyllabusApi(
  studentId: number,
  syllabusId: number,
): Promise<void> {
  const response = await fetch(
    `/api/student/${studentId}/syllabi/${syllabusId}/assignment`,
    { method: "DELETE", credentials: "include" },
  );
  if (!response.ok) throw response;
}

export async function getStudentSyllabiApi(
  studentId: number,
): Promise<SyllabusAssignment[]> {
  const response = await fetch(`/api/student/${studentId}/syllabi`, {
    credentials: "include",
  });
  if (!response.ok) throw response;
  return await response.json();
}

export async function getStudentSyllabusTechniquesApi(
  studentId: number,
  syllabusId: number,
): Promise<StudentSyllabusDetailResponse> {
  const response = await fetch(
    `/api/student/${studentId}/syllabi/${syllabusId}/techniques`,
    { credentials: "include" },
  );
  if (!response.ok) throw response;
  return await response.json();
}

export async function updateSstApi(
  sstId: number,
  data: { status?: string; student_notes?: string; coach_notes?: string },
): Promise<void> {
  const response = await fetch(`/api/student_syllabus_techniques/${sstId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw response;
}

export async function listSyllabusAttemptsApi(
  sstId: number,
): Promise<SyllabusAttempt[]> {
  const response = await fetch(
    `/api/student_syllabus_techniques/${sstId}/attempts`,
    { credentials: "include" },
  );
  if (!response.ok) throw response;
  return await response.json();
}

export async function createSyllabusAttemptApi(
  sstId: number,
  data: { attempted_at: string; coach_note?: string; student_note?: string },
): Promise<{ id: number }> {
  const response = await fetch(
    `/api/student_syllabus_techniques/${sstId}/attempts`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );
  if (!response.ok) throw response;
  return await response.json();
}

export async function updateSyllabusAttemptApi(
  attemptId: number,
  data: {
    attempted_at?: string;
    coach_note?: string | null;
    student_note?: string | null;
  },
): Promise<void> {
  const response = await fetch(`/api/syllabus_attempts/${attemptId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw response;
}

export async function deleteSyllabusAttemptApi(
  attemptId: number,
): Promise<void> {
  const response = await fetch(`/api/syllabus_attempts/${attemptId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) throw response;
}

export async function listSyllabusStudentsApi(
  syllabusId: number,
): Promise<number[]> {
  const response = await fetch(`/api/syllabi/${syllabusId}/students`, {
    credentials: "include",
  });
  if (!response.ok) throw response;
  return await response.json();
}

// ============================================================
// PR 4: graduation, diff view, per-student curation, video overrides
// ============================================================

export interface DiffGhost {
  sst_id: number;
  technique_id: number;
  technique_name: string;
  hidden: boolean;
}

export interface DiffMissing {
  technique_id: number;
  technique_name: string;
  sst_id: number | null;
}

export interface SyllabusAssignmentDiff {
  ghosts: DiffGhost[];
  missing: DiffMissing[];
}

export type GhostActionKind =
  | "readd_globally"
  | "hide_locally"
  | "ignore";

export type MissingActionKind = "add_to_student" | "ignore";

export interface GhostActionEntry {
  sst_id: number;
  technique_id: number;
  action: GhostActionKind;
}

export interface MissingActionEntry {
  technique_id: number;
  action: MissingActionKind;
}

export async function setAssignmentGraduatedApi(
  studentId: number,
  syllabusId: number,
  graduatedAt: string | null,
): Promise<void> {
  const response = await fetch(
    `/api/student/${studentId}/syllabi/${syllabusId}/assignment`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ graduated_at: graduatedAt }),
    },
  );
  if (!response.ok) throw response;
}

export async function getAssignmentDiffApi(
  studentId: number,
  syllabusId: number,
): Promise<SyllabusAssignmentDiff> {
  const response = await fetch(
    `/api/student/${studentId}/syllabi/${syllabusId}/assignment/diff`,
    { credentials: "include" },
  );
  if (!response.ok) throw response;
  return await response.json();
}

export async function applyAssignmentDiffApi(
  studentId: number,
  syllabusId: number,
  body: {
    ghost_actions: GhostActionEntry[];
    missing_actions: MissingActionEntry[];
  },
): Promise<{ applied: number }> {
  const response = await fetch(
    `/api/student/${studentId}/syllabi/${syllabusId}/assignment/diff/apply`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw response;
  return await response.json();
}

export async function addTechniqueToStudentSyllabusApi(
  studentId: number,
  syllabusId: number,
  techniqueId: number,
): Promise<{ id: number }> {
  const response = await fetch(
    `/api/student/${studentId}/syllabi/${syllabusId}/techniques`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ technique_id: techniqueId }),
    },
  );
  if (!response.ok) throw response;
  return await response.json();
}

export async function setSstHiddenApi(
  sstId: number,
  hidden: boolean,
): Promise<void> {
  const response = await fetch(
    `/api/student_syllabus_techniques/${sstId}/hidden`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden }),
    },
  );
  if (!response.ok) throw response;
}

export async function setVideoSyllabusVisibilityApi(
  studentId: number,
  syllabusId: number,
  videoId: number,
  visible: boolean | null,
): Promise<void> {
  const response = await fetch(
    `/api/student/${studentId}/syllabi/${syllabusId}/videos/${videoId}/visibility`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visible }),
    },
  );
  if (!response.ok) throw response;
}

// ============================================================
// Syllabus-backed student dashboard reads (dashboard-reporting migration)
// ============================================================

export interface StudentSyllabusTechniqueOverview {
  sst_id: number;
  technique_id: number;
  technique_name: string;
  syllabus_id: number;
  syllabus_name: string;
  status: "red" | "amber" | "green";
  updated_at: string;
  last_attempt_at: string | null;
  last_coach_update_at: string | null;
  last_student_update_at: string | null;
}

export async function getStudentSyllabusTechniquesFlat(
  studentId: number,
): Promise<StudentSyllabusTechniqueOverview[]> {
  const response = await fetch(`/api/student/${studentId}/syllabus_techniques`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to fetch syllabus techniques");
  return await response.json();
}

export async function getRecentSyllabusAttemptsForStudent(
  studentId: number,
  limit: number = 5,
): Promise<RecentAttemptItem[]> {
  const response = await fetch(
    `/api/student/${studentId}/syllabus_attempts/recent?limit=${limit}`,
    { credentials: "include" },
  );
  if (!response.ok) throw new Error("Failed to fetch recent syllabus attempts");
  return await response.json();
}

export async function getSyllabusAttemptHeatmap(
  studentId: number,
  from?: string,
  to?: string,
): Promise<AttemptBucket[]> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  const url = qs
    ? `/api/student/${studentId}/syllabus_attempts/heatmap?${qs}`
    : `/api/student/${studentId}/syllabus_attempts/heatmap`;
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error("Failed to fetch syllabus attempt heatmap");
  return await response.json();
}

// ============================================================
// Activity feed (PR 2)
// ============================================================

import type { ActivityRow } from "./activity-line";
export type { ActivityRow };

export interface ActivityUnreadCount {
  count: number;
}

export async function getActivityFeed(params?: {
  before_ts?: string;
  before_id?: number;
  limit?: number;
}): Promise<ActivityRow[]> {
  const url = new URL("/api/activity/feed", window.location.origin);
  if (params?.before_ts) url.searchParams.set("before_ts", params.before_ts);
  if (params?.before_id !== undefined)
    url.searchParams.set("before_id", String(params.before_id));
  if (params?.limit !== undefined)
    url.searchParams.set("limit", String(params.limit));
  const response = await fetch(url.toString(), { credentials: "include" });
  if (!response.ok) throw response;
  return (await response.json()) as ActivityRow[];
}

export async function getActivityUnreadCount(): Promise<ActivityUnreadCount> {
  const response = await fetch("/api/activity/unread_count", {
    credentials: "include",
  });
  if (!response.ok) throw response;
  return (await response.json()) as ActivityUnreadCount;
}

/** Fetches activity rows scoped to a specific student.
 *  Used by coaches (and the student themselves) on the student profile page
 *  to show that student's activity rather than the gym-wide feed. */
export async function getStudentActivityFeed(
  studentId: number,
  params?: {
    before_ts?: string;
    before_id?: number;
    limit?: number;
  },
): Promise<ActivityRow[]> {
  const url = new URL(
    `/api/student/${studentId}/activity_feed`,
    window.location.origin,
  );
  if (params?.before_ts) url.searchParams.set("before_ts", params.before_ts);
  if (params?.before_id !== undefined)
    url.searchParams.set("before_id", String(params.before_id));
  if (params?.limit !== undefined)
    url.searchParams.set("limit", String(params.limit));
  const response = await fetch(url.toString(), { credentials: "include" });
  if (!response.ok) throw response;
  return (await response.json()) as ActivityRow[];
}

export async function postMarkAllActivityRead(): Promise<void> {
  const response = await fetch("/api/activity/mark_all_read", {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw response;
}

export async function postMarkActivityRead(id: number): Promise<void> {
  const response = await fetch(`/api/activity/${id}/read`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw response;
}

export async function postMarkActivityUnread(id: number): Promise<void> {
  const response = await fetch(`/api/activity/${id}/unread`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw response;
}

// ============================================================
// Dashboard digest + feed
// ============================================================

export interface DigestMetric {
  key: string;
  label: string;
  count: number;
  prev_count: number;
  delta: number;
  daily: number[];
}

export interface ActivityDigest {
  window_days: number;
  metrics: DigestMetric[];
}

export async function getActivityDigest(): Promise<ActivityDigest> {
  const response = await fetch("/api/dashboard/activity_digest", {
    credentials: "include",
  });
  if (!response.ok) throw response;
  return (await response.json()) as ActivityDigest;
}

export async function getDashboardActivityFeed(limit = 30): Promise<ActivityRow[]> {
  const response = await fetch(`/api/dashboard/activity_feed?limit=${limit}`, {
    credentials: "include",
  });
  if (!response.ok) throw response;
  return (await response.json()) as ActivityRow[];
}

// ============================================================
// Threads (PR 2, Task 1)
// ============================================================

export type AnchorKind =
  | "student_profile"
  | "technique"
  | "video"
  | "video_timestamp"
  | "sst"
  | "pinned_technique";
export type ThreadVisibility = "private" | "broadcast";

export interface CommentView {
  id: number;
  thread_id: number;
  parent_comment_id: number | null;
  author_id: number;
  author_name: string;
  body: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface ThreadView {
  id: number;
  anchor_kind: string;
  author_id: number;
  author_name: string;
  visibility: string;
  scope_student_id: number | null;
  /** Anchor seconds for video_timestamp threads; null otherwise. */
  video_ts_seconds: number | null;
  body: string | null;
  created_at: string;
  deleted_at: string | null;
  comments: CommentView[];
}

export interface CreateThreadInput {
  anchor_kind: AnchorKind;
  anchor_id: number;
  video_ts_seconds?: number | null;
  pinned_student_id?: number | null;
  visibility: ThreadVisibility;
  scope_student_id?: number | null;
  body: string;
}

export async function listThreads(
  anchorKind: AnchorKind,
  anchorId: number,
): Promise<ThreadView[]> {
  const res = await fetch(
    `/api/threads?anchor_kind=${anchorKind}&anchor_id=${anchorId}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`Failed to load threads: ${res.statusText}`);
  const data = (await res.json()) as { threads: ThreadView[] };
  return data.threads;
}

export async function createThread(input: CreateThreadInput): Promise<Response> {
  return fetch(`/api/threads`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function createComment(
  threadId: number,
  body: string,
  parentCommentId?: number | null,
): Promise<Response> {
  return fetch(`/api/threads/${threadId}/comments`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, parent_comment_id: parentCommentId ?? null }),
  });
}

export async function deleteThread(threadId: number): Promise<Response> {
  return fetch(`/api/threads/${threadId}`, {
    method: "DELETE",
    credentials: "include",
  });
}

export async function deleteComment(commentId: number): Promise<Response> {
  return fetch(`/api/comments/${commentId}`, {
    method: "DELETE",
    credentials: "include",
  });
}
