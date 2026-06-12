#[cfg(test)]
mod tests {
    use crate::db::threads::{create_thread, Anchor, AnchorKind, NewThread, ThreadVisibility};
    use crate::test::test_utils::{create_standard_test_db, TestDbBuilder};

    async fn db_with_coach_and_student() -> crate::test::test_utils::TestDb {
        TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap()
    }

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

    #[rocket::async_test]
    async fn create_private_profile_thread_persists_row() {
        let db = db_with_coach_and_student().await;
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();

        let id = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::StudentProfile,
                    id: student_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "Let's plan your next six weeks.".to_string(),
            },
        )
        .await
        .unwrap();

        let row = sqlx::query!(
            r#"SELECT t.anchor_kind, t.student_id AS "student_id?: i64",
                      t.visibility, t.scope_student_id AS "scope?: i64",
                      c.body
               FROM threads t
               JOIN thread_comments c ON c.thread_id = t.id
               WHERE t.id = ?"#,
            id
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(row.anchor_kind, "student_profile");
        assert_eq!(row.student_id, Some(student_id));
        assert_eq!(row.visibility, "private");
        assert_eq!(row.scope, Some(student_id));
        assert_eq!(row.body, "Let's plan your next six weeks.");
    }

    #[rocket::async_test]
    async fn broadcast_on_profile_anchor_is_rejected() {
        let db = db_with_coach_and_student().await;
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();

        let result = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::StudentProfile,
                    id: student_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                },
                visibility: ThreadVisibility::Broadcast,
                scope_student_id: None,
                body: "nope".to_string(),
            },
        )
        .await;
        assert!(result.is_err(), "broadcast on a profile anchor must be rejected");
    }
}
