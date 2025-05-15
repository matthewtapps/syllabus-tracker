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

// Assign multiple techniques to a student
export async function assignTechniquesToStudent(
  studentId: number,
  techniqueIds: number[],
): Promise<void> {
  const response = await fetch(`/api/student/${studentId}/add_techniques`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ technique_ids: techniqueIds }),
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Failed to assign techniques: ${response.statusText}`);
  }
}

export async function createAndAssignTechnique(
  studentId: number,
  name: string,
  description: string,
): Promise<void> {
  const response = await fetch(`/api/student/${studentId}/create_technique`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, description }),
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Failed to create technique: ${response.statusText}`);
  }
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
}

export interface StudentTechniques {
  student: User;
  techniques: Technique[];
  can_edit_all_techniques: boolean;
  can_assign_techniques: boolean;
  can_create_techniques: boolean;
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
): Promise<void> {
  const response = await fetch(`/api/student_technique/${techniqueId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updates),
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Failed to update technique: ${response.statusText}`);
  }
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
): Promise<void> {
  const response = await fetch("/api/profile", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to update profile");
  }
}

export interface PasswordUpdateData {
  current_password: string;
  new_password: string;
}

export async function updatePassword(data: PasswordUpdateData): Promise<void> {
  const response = await fetch("/api/change-password", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to change password");
  }
}

export interface UserRegistrationData {
  username: string;
  display_name: string;
  password: string;
  role: string;
}

export async function registerUser(data: UserRegistrationData): Promise<void> {
  const response = await fetch("/api/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to register user");
  }
}

export interface UserUpdateData {
  username?: string;
  display_name?: string;
  password?: string;
  archived?: boolean;
}

export async function updateUser(
  userId: number,
  data: UserUpdateData,
): Promise<void> {
  const response = await fetch(`/api/admin/users/${userId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to update user");
  }
}
