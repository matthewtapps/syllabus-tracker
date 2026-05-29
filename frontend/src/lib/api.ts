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
  } catch (error) {
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
  } catch (error) {
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
  has_new_student_activity?: boolean | null;
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
  } catch (error) {
    return null;
  }
}

// Get unassigned techniques for a student
export async function getTechniquesForAssignment(
  studentId: number,
): Promise<any[]> {
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
  has_new_student_activity: boolean;
  collection_id: number | null;
  collection_name: string | null;
  tags: Tag[];
}

export interface LibraryTechnique {
  id: number;
  name: string;
  description: string;
  coach_id: number;
  coach_name: string;
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

export interface SeenResponse {
  previous_last_seen_at: string | null;
}

export async function markDashboardSeen(): Promise<SeenResponse | null> {
  try {
    const response = await fetch("/api/me/seen", {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
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
