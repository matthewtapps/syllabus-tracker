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

export interface User {
  id: number;
  username: string;
  display_name: string;
  role: string;
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
}

export async function getCurrentUser(): Promise<User | null> {
  try {
    const response = await fetch("/api/me", {
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

  return await response.json();
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
}

export interface SignedUrl {
  url: string;
  expires_at: string;
}

export interface UploadResponse {
  video_id: number;
  processing_status: ProcessingStatus;
}

export async function listVideos(techniqueId: number): Promise<Video[]> {
  const response = await fetch(`/api/techniques/${techniqueId}/videos`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to load videos");
  const body = await response.json();
  return body.videos as Video[];
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
