#[cfg(test)]
pub mod test_db {
    use crate::auth::Role;
    use crate::db::{
        assign_technique_to_student, create_technique, create_user, update_student_technique,
    };
    use crate::error::AppError;
    use sqlx::{Pool, Sqlite, SqlitePool};
    use std::collections::HashMap;
    use std::sync::Once;
    use tracing::log::LevelFilter;

    static INIT: Once = Once::new();
    static STANDARD_PASSWORD: &str = "password123";

    #[derive(Default)]
    pub struct TestDbBuilder {
        users: Vec<TestUser>,
        techniques: Vec<TestTechnique>,
        student_techniques: Vec<TestStudentTechnique>,
    }

    pub struct TestUser {
        pub username: String,
        pub display_name: Option<String>,
        pub role: Role,
        pub password: String,
    }

    pub struct TestTechnique {
        pub name: String,
        pub description: String,
        pub coach_username: Option<String>,
    }

    pub struct TestStudentTechnique {
        pub technique_name: Option<String>,
        pub student_username: Option<String>,
        pub status: String,
        pub student_notes: String,
        pub coach_notes: String,
    }

    impl TestDbBuilder {
        pub fn new() -> Self {
            Self::default()
        }

        pub fn student(mut self, username: &str, display_name: Option<&str>) -> Self {
            self.users.push(TestUser {
                username: username.to_string(),
                display_name: display_name.map(String::from),
                role: Role::Student,
                password: STANDARD_PASSWORD.to_string(),
            });
            self
        }

        pub fn coach(mut self, username: &str, display_name: Option<&str>) -> Self {
            self.users.push(TestUser {
                username: username.to_string(),
                display_name: display_name.map(String::from),
                role: Role::Coach,
                password: STANDARD_PASSWORD.to_string(),
            });
            self
        }

        pub fn admin(mut self, username: &str, display_name: Option<&str>) -> Self {
            self.users.push(TestUser {
                username: username.to_string(),
                display_name: display_name.map(String::from),
                role: Role::Admin,
                password: STANDARD_PASSWORD.to_string(),
            });
            self
        }

        pub fn user_with_password(
            mut self,
            username: &str,
            display_name: Option<&str>,
            role: Role,
            password: &str,
        ) -> Self {
            self.users.push(TestUser {
                username: username.to_string(),
                display_name: display_name.map(String::from),
                role,
                password: password.to_string(),
            });
            self
        }

        pub fn technique(
            mut self,
            name: &str,
            description: &str,
            coach_username: Option<&str>,
        ) -> Self {
            self.techniques.push(TestTechnique {
                name: name.to_string(),
                description: description.to_string(),
                coach_username: coach_username.map(String::from),
            });
            self
        }

        pub fn assign_technique(
            mut self,
            technique_name: Option<&str>,
            student_username: Option<&str>,
            status: &str,
            student_notes: &str,
            coach_notes: &str,
        ) -> Self {
            self.student_techniques.push(TestStudentTechnique {
                technique_name: technique_name.map(String::from),
                student_username: student_username.map(String::from),
                status: status.to_string(),
                student_notes: student_notes.to_string(),
                coach_notes: coach_notes.to_string(),
            });
            self
        }

        pub async fn build(self) -> Result<TestDb, AppError> {
            INIT.call_once(|| {
                let _ = env_logger::builder()
                    .filter_level(LevelFilter::Debug)
                    .is_test(true)
                    .try_init();
            });

            let pool = SqlitePool::connect("sqlite::memory:").await?;

            sqlx::migrate!("./migrations").run(&pool).await?;

            let mut user_id_map: HashMap<String, i64> = HashMap::new();
            let mut technique_id_map: HashMap<String, i64> = HashMap::new();

            for user in &self.users {
                let role_str = match user.role {
                    Role::Student => "student",
                    Role::Coach => "coach",
                    Role::Admin => "admin",
                };

                let user_id = create_user(&pool, &user.username, &user.password, role_str).await?;

                user_id_map.insert(user.username.clone(), user_id);
            }

            for technique in &self.techniques {
                let coach_id = match &technique.coach_username {
                    Some(coach_name) => user_id_map.get(coach_name).copied(),
                    None => self
                        .users
                        .iter()
                        .find(|u| matches!(u.role, Role::Coach))
                        .map(|u| user_id_map[&u.username]),
                };

                if let Some(coach_id) = coach_id {
                    let technique_id =
                        create_technique(&pool, &technique.name, &technique.description, coach_id)
                            .await?;

                    technique_id_map.insert(technique.name.clone(), technique_id);
                } else if !self.users.is_empty() {
                    let first_user_id = user_id_map.values().next().copied().unwrap_or(1);
                    let technique_id = create_technique(
                        &pool,
                        &technique.name,
                        &technique.description,
                        first_user_id,
                    )
                    .await?;

                    technique_id_map.insert(technique.name.clone(), technique_id);
                }
            }

            for st in &self.student_techniques {
                let student_id = match &st.student_username {
                    Some(username) => user_id_map.get(username).copied(),
                    None => self
                        .users
                        .iter()
                        .find(|u| matches!(u.role, Role::Student))
                        .map(|u| user_id_map[&u.username]),
                };

                let technique_id = match &st.technique_name {
                    Some(name) => technique_id_map.get(name).copied(),
                    None => {
                        if !technique_id_map.is_empty() {
                            Some(*technique_id_map.values().next().unwrap())
                        } else {
                            None
                        }
                    }
                };

                if let (Some(s_id), Some(t_id)) = (student_id, technique_id) {
                    let assignment_id = assign_technique_to_student(&pool, t_id, s_id).await?;

                    if st.status != "red"
                        || !st.student_notes.is_empty()
                        || !st.coach_notes.is_empty()
                    {
                        update_student_technique(
                            &pool,
                            assignment_id,
                            &st.status,
                            &st.student_notes,
                            &st.coach_notes,
                        )
                        .await?;
                    }
                }
            }

            Ok(TestDb {
                pool,
                user_id_map,
                technique_id_map,
            })
        }
    }

    pub struct TestDb {
        pub pool: Pool<Sqlite>,
        pub user_id_map: HashMap<String, i64>,
        pub technique_id_map: HashMap<String, i64>,
    }

    impl TestDb {
        pub fn user_id(&self, username: &str) -> Option<i64> {
            self.user_id_map.get(username).copied()
        }

        pub fn technique_id(&self, name: &str) -> Option<i64> {
            self.technique_id_map.get(name).copied()
        }

        pub async fn student_technique_id(
            &self,
            student_username: &str,
            technique_name: &str,
        ) -> Result<i64, sqlx::Error> {
            let student_id = self
                .user_id(student_username)
                .ok_or_else(|| sqlx::Error::RowNotFound)?;

            let technique_id = self
                .technique_id(technique_name)
                .ok_or_else(|| sqlx::Error::RowNotFound)?;

            let result = sqlx::query!(
                "SELECT id FROM student_techniques 
             WHERE student_id = ? AND technique_id = ?",
                student_id,
                technique_id
            )
            .fetch_one(&self.pool)
            .await?;

            Ok(result.id)
        }

        pub async fn student_technique_ids(
            &self,
            student_username: &str,
        ) -> Result<Vec<i64>, sqlx::Error> {
            let student_id = self
                .user_id(student_username)
                .ok_or_else(|| sqlx::Error::RowNotFound)?;

            let results = sqlx::query!(
                "SELECT id FROM student_techniques WHERE student_id = ?",
                student_id
            )
            .fetch_all(&self.pool)
            .await?;

            Ok(results.into_iter().map(|row| row.id).collect())
        }

        pub async fn first_student_technique_id(
            &self,
            student_username: &str,
        ) -> Result<i64, sqlx::Error> {
            let student_id = self
                .user_id(student_username)
                .ok_or_else(|| sqlx::Error::RowNotFound)?;

            let result = sqlx::query!(
                "SELECT id FROM student_techniques WHERE student_id = ? LIMIT 1",
                student_id
            )
            .fetch_one(&self.pool)
            .await?;

            Ok(result.id)
        }

        pub async fn get_student_technique(
            &self,
            id: i64,
        ) -> Result<crate::models::StudentTechnique, crate::error::AppError> {
            crate::db::get_student_technique(&self.pool, id).await
        }
    }
}
