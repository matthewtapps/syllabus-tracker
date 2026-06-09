use anyhow::Error;
use once_cell::sync::Lazy;
use rocket::serde::Serialize;
use std::collections::HashSet;
use std::fmt;
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Permission {
    ViewOwnProfile,
    EditOwnProfile,
    ViewOwnTechniques,
    EditOwnNotes,

    ViewAllStudents,
    EditAllTechniques,
    AssignTechniques,
    CreateTechniques,
    RegisterUsers,
    ManageTags,

    EditUserRoles,
    DeleteUsers,
    EditUserCredentials,

    UploadVideos,
    DeleteVideos,
    ManageVideoVisibility,
    ViewWatchStats,
    ViewStorageStats,

    EditStudentRank,

    SubmitFootage,
    /// Coach-level toggle between `Student` and `FootageSubmitterStudent`.
    /// Distinct from `EditUserRoles` (admin-only, can set any role) so
    /// coaches can grant/revoke footage rights without touching the
    /// broader user-management surface.
    ManageFootageSubmitter,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum Role {
    Student,
    FootageSubmitterStudent,
    Coach,
    Admin,
}

impl Role {
    /// True for any role we treat as a student for roster, dashboard,
    /// and routing purposes (`Student` and `FootageSubmitterStudent`).
    /// The dashboard's roster SQL must use `IN ('student',
    /// 'footage_submitter_student')` to stay in sync with this.
    pub fn is_student(&self) -> bool {
        matches!(self, Role::Student | Role::FootageSubmitterStudent)
    }
}

static STUDENT_PERMISSIONS: Lazy<HashSet<Permission>> = Lazy::new(|| {
    let mut permissions = HashSet::new();

    permissions.insert(Permission::ViewOwnProfile);
    permissions.insert(Permission::EditOwnProfile);
    permissions.insert(Permission::ViewOwnTechniques);
    permissions.insert(Permission::EditOwnNotes);

    permissions
});

static FOOTAGE_SUBMITTER_PERMISSIONS: Lazy<HashSet<Permission>> = Lazy::new(|| {
    let mut permissions = HashSet::new();

    permissions.extend(STUDENT_PERMISSIONS.iter().copied());

    permissions.insert(Permission::SubmitFootage);

    permissions
});

static COACH_PERMISSIONS: Lazy<HashSet<Permission>> = Lazy::new(|| {
    let mut permissions = HashSet::new();

    permissions.extend(STUDENT_PERMISSIONS.iter().copied());

    permissions.insert(Permission::ViewAllStudents);
    permissions.insert(Permission::EditAllTechniques);
    permissions.insert(Permission::AssignTechniques);
    permissions.insert(Permission::CreateTechniques);
    permissions.insert(Permission::RegisterUsers);
    permissions.insert(Permission::ManageTags);

    permissions.insert(Permission::UploadVideos);
    permissions.insert(Permission::DeleteVideos);
    permissions.insert(Permission::ManageVideoVisibility);
    permissions.insert(Permission::ViewWatchStats);

    permissions.insert(Permission::EditStudentRank);

    permissions.insert(Permission::SubmitFootage);
    permissions.insert(Permission::ManageFootageSubmitter);

    permissions
});

static ADMIN_PERMISSIONS: Lazy<HashSet<Permission>> = Lazy::new(|| {
    let mut permissions = HashSet::new();

    permissions.extend(COACH_PERMISSIONS.iter().copied());

    permissions.insert(Permission::EditUserRoles);
    permissions.insert(Permission::DeleteUsers);
    permissions.insert(Permission::EditUserCredentials);

    permissions.insert(Permission::ViewStorageStats);

    permissions
});

impl Role {
    pub fn permissions(&self) -> &'static HashSet<Permission> {
        match self {
            Role::Student => &STUDENT_PERMISSIONS,
            Role::FootageSubmitterStudent => &FOOTAGE_SUBMITTER_PERMISSIONS,
            Role::Coach => &COACH_PERMISSIONS,
            Role::Admin => &ADMIN_PERMISSIONS,
        }
    }

    pub fn has_permission(&self, permission: Permission) -> bool {
        self.permissions().contains(&permission)
    }

    pub fn as_str(&self) -> &str {
        match self {
            Role::Student => "student",
            Role::FootageSubmitterStudent => "footage_submitter_student",
            Role::Coach => "coach",
            Role::Admin => "admin",
        }
    }
}

impl Permission {
    /// Stable wire-format name (matches the Debug derivation; used in
    /// the `permissions: string[]` payload on /api/me so the frontend
    /// can do `user.permissions.includes("SubmitFootage")`).
    pub fn as_str(&self) -> &'static str {
        match self {
            Permission::ViewOwnProfile => "ViewOwnProfile",
            Permission::EditOwnProfile => "EditOwnProfile",
            Permission::ViewOwnTechniques => "ViewOwnTechniques",
            Permission::EditOwnNotes => "EditOwnNotes",
            Permission::ViewAllStudents => "ViewAllStudents",
            Permission::EditAllTechniques => "EditAllTechniques",
            Permission::AssignTechniques => "AssignTechniques",
            Permission::CreateTechniques => "CreateTechniques",
            Permission::RegisterUsers => "RegisterUsers",
            Permission::ManageTags => "ManageTags",
            Permission::EditUserRoles => "EditUserRoles",
            Permission::DeleteUsers => "DeleteUsers",
            Permission::EditUserCredentials => "EditUserCredentials",
            Permission::UploadVideos => "UploadVideos",
            Permission::DeleteVideos => "DeleteVideos",
            Permission::ManageVideoVisibility => "ManageVideoVisibility",
            Permission::ViewWatchStats => "ViewWatchStats",
            Permission::ViewStorageStats => "ViewStorageStats",
            Permission::EditStudentRank => "EditStudentRank",
            Permission::SubmitFootage => "SubmitFootage",
            Permission::ManageFootageSubmitter => "ManageFootageSubmitter",
        }
    }
}

impl FromStr for Role {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "student" => Ok(Role::Student),
            "footage_submitter_student" => Ok(Role::FootageSubmitterStudent),
            "coach" => Ok(Role::Coach),
            "admin" => Ok(Role::Admin),
            _ => Err(Error::msg(format!("Unknown role: {}", s))),
        }
    }
}

impl fmt::Display for Role {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}
