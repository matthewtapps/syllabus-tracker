use chrono::{NaiveDateTime, Utc};
use rand::{Rng, distr::Alphanumeric, rng};
use rocket::http::Status;
use serde::Serialize;

use super::{Permission, Role};

#[derive(Debug, Serialize, Clone)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub role: Role,
    pub display_name: String,
    pub archived: bool,
    pub last_update: Option<String>,
}

#[derive(sqlx::FromRow, Clone)]
pub struct DbUser {
    pub id: Option<i64>,
    pub username: Option<String>,
    pub role: Option<String>,
    pub display_name: Option<String>,
    pub archived: Option<bool>,
}

impl From<DbUser> for User {
    fn from(user: DbUser) -> Self {
        Self {
            id: user.id.unwrap_or_default(),
            username: user.username.unwrap_or_default(),
            role: Role::from_str(&user.role.unwrap_or_default()).unwrap(),
            display_name: user.display_name.unwrap_or_default(),
            archived: user.archived.unwrap_or_default(),
            last_update: None,
        }
    }
}

impl User {
    pub fn has_permission(&self, permission: Permission) -> bool {
        self.role.has_permission(permission)
    }

    pub fn require_permission(&self, permission: Permission) -> Result<(), Status> {
        if self.role.has_permission(permission) {
            Ok(())
        } else {
            tracing::warn!(
                username = %self.username,
                role = %self.role.as_str(),
                permission = ?permission,
                "Permission denied"
            );
            Err(Status::Forbidden)
        }
    }

    // Just in case this is useful later
    pub fn _require_any_permission(&self, permissions: &[Permission]) -> Result<(), Status> {
        if permissions.iter().any(|p| self.role.has_permission(*p)) {
            Ok(())
        } else {
            tracing::warn!(
                username = %self.username,
                role = %self.role.as_str(),
                permissions = ?permissions,
                "Permission denied (require any)"
            );
            Err(Status::Forbidden)
        }
    }

    pub fn require_all_permissions(&self, permissions: &[Permission]) -> Result<(), Status> {
        if permissions.iter().all(|p| self.role.has_permission(*p)) {
            Ok(())
        } else {
            tracing::warn!(
                username = %self.username,
                role = %self.role.as_str(),
                permissions = ?permissions,
                "Permission denied (require all)"
            );
            Err(Status::Forbidden)
        }
    }
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct UserSession {
    pub id: i64,
    pub user_id: i64,
    pub token: String,
    pub created_at: Option<NaiveDateTime>,
    pub expires_at: NaiveDateTime,
}

#[derive(Debug, sqlx::FromRow, Clone)]
pub struct DbUserSession {
    pub id: Option<i64>,
    pub user_id: Option<i64>,
    pub token: Option<String>,
    pub created_at: Option<NaiveDateTime>,
    pub expires_at: Option<NaiveDateTime>,
}

impl From<DbUserSession> for UserSession {
    fn from(db_session: DbUserSession) -> Self {
        Self {
            id: db_session.id.unwrap_or_default(),
            user_id: db_session.user_id.unwrap_or_default(),
            token: db_session.token.unwrap_or_default(),
            created_at: db_session.created_at,
            expires_at: db_session
                .expires_at
                .unwrap_or_else(|| Utc::now().naive_utc()),
        }
    }
}

impl UserSession {
    pub fn is_valid(&self) -> bool {
        let now = Utc::now().naive_utc();
        self.expires_at > now
    }

    pub fn generate_token() -> String {
        let mut rng = rng();
        let token: String = std::iter::repeat(())
            .map(|()| rng.sample(Alphanumeric))
            .map(char::from)
            .take(32)
            .collect();
        token
    }
}
