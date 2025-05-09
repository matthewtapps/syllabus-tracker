use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub role: String,
    pub display_name: String,
}

#[derive(sqlx::FromRow, Clone)]
pub struct DbUser {
    pub id: Option<i64>,
    pub username: Option<String>,
    pub role: Option<String>,
    pub display_name: Option<String>,
}

impl From<DbUser> for User {
    fn from(user: DbUser) -> Self {
        Self {
            id: user.id.unwrap_or_default(),
            username: user.username.unwrap_or_default(),
            role: user.role.unwrap_or_default(),
            display_name: user.display_name.unwrap_or_default(),
        }
    }
}
