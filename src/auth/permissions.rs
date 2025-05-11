use anyhow::Error;
use once_cell::sync::Lazy;
use rocket::serde::Serialize;
use std::collections::HashSet;
use std::fmt;

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

    EditUserRoles,
    DeleteUsers,
    EditUserCredentials,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum Role {
    Student,
    Coach,
    Admin,
}

static STUDENT_PERMISSIONS: Lazy<HashSet<Permission>> = Lazy::new(|| {
    let mut permissions = HashSet::new();

    permissions.insert(Permission::ViewOwnProfile);
    permissions.insert(Permission::EditOwnProfile);
    permissions.insert(Permission::ViewOwnTechniques);
    permissions.insert(Permission::EditOwnNotes);

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

    permissions
});

static ADMIN_PERMISSIONS: Lazy<HashSet<Permission>> = Lazy::new(|| {
    let mut permissions = HashSet::new();

    permissions.extend(COACH_PERMISSIONS.iter().copied());

    permissions.insert(Permission::EditUserRoles);
    permissions.insert(Permission::DeleteUsers);
    permissions.insert(Permission::EditUserCredentials);

    permissions
});

impl Role {
    pub fn permissions(&self) -> &'static HashSet<Permission> {
        match self {
            Role::Student => &STUDENT_PERMISSIONS,
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
            Role::Coach => "coach",
            Role::Admin => "admin",
        }
    }

    pub fn from_str(s: &str) -> Result<Self, Error> {
        match s {
            "student" => Ok(Role::Student),
            "coach" => Ok(Role::Coach),
            "admin" => Ok(Role::Admin),
            _ => Err(Error::msg(format!("Unknown role: {}", s))),
        }
    }
}

impl fmt::Display for Role {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Role::Student => write!(f, "student"),
            Role::Coach => write!(f, "coach"),
            Role::Admin => write!(f, "admin"),
        }
    }
}
