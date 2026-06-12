#[cfg(test)]
mod tests {
    use crate::test::test_utils::create_standard_test_db;

    #[rocket::async_test]
    async fn migrator_creates_thread_tables() {
        let db = create_standard_test_db().await;
        let names: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master \
             WHERE type='table' AND name IN ('threads','thread_comments') \
             ORDER BY name",
        )
        .fetch_all(&db.pool)
        .await
        .unwrap();
        assert_eq!(names, vec!["thread_comments", "threads"]);
    }
}
