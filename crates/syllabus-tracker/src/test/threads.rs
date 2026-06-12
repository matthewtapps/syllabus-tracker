#[cfg(test)]
mod tests {
    use crate::db::threads::{
        create_comment, create_thread, get_thread, soft_delete_comment, Anchor, AnchorKind,
        NewThread, ThreadVisibility, Viewer,
    };
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
            r#"SELECT anchor_kind, student_id AS "student_id?: i64",
                      visibility, scope_student_id AS "scope?: i64", body
               FROM threads WHERE id = ?"#,
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

    async fn db_three_users() -> crate::test::test_utils::TestDb {
        TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .student("student2", Some("Mia"))
            .build()
            .await
            .unwrap()
    }

    #[rocket::async_test]
    async fn comments_and_visibility_round_trip() {
        let db = db_three_users().await;
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();
        let other_student_id = db.user_id("student2").unwrap();

        let thread_id = create_thread(
            &db.pool,
            NewThread {
                author_id: student_id,
                anchor: Anchor {
                    kind: AnchorKind::StudentProfile,
                    id: student_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "question".to_string(),
            },
        )
        .await
        .unwrap();

        create_comment(&db.pool, thread_id, None, coach_id, "answer")
            .await
            .unwrap();

        let owner_view = get_thread(
            &db.pool,
            thread_id,
            Viewer { user_id: student_id, is_coach: false },
        )
        .await
        .unwrap();
        assert!(owner_view.is_some());
        assert_eq!(owner_view.unwrap().comments.len(), 1);

        let coach_view = get_thread(
            &db.pool,
            thread_id,
            Viewer { user_id: coach_id, is_coach: true },
        )
        .await
        .unwrap();
        assert!(coach_view.is_some());

        let stranger = get_thread(
            &db.pool,
            thread_id,
            Viewer { user_id: other_student_id, is_coach: false },
        )
        .await
        .unwrap();
        assert!(stranger.is_none(), "private thread leaked to another student");
    }

    #[rocket::async_test]
    async fn reply_to_reply_is_rejected() {
        let db = db_three_users().await;
        let student_id = db.user_id("student_user").unwrap();
        let thread_id = create_thread(
            &db.pool,
            NewThread {
                author_id: student_id,
                anchor: Anchor {
                    kind: AnchorKind::StudentProfile,
                    id: student_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "q".to_string(),
            },
        )
        .await
        .unwrap();
        let top =
            create_comment(&db.pool, thread_id, None, student_id, "top").await.unwrap();
        create_comment(&db.pool, thread_id, Some(top), student_id, "ok reply")
            .await
            .unwrap();
        let nested = create_comment(
            &db.pool,
            thread_id,
            Some(
                create_comment(&db.pool, thread_id, Some(top), student_id, "another reply")
                    .await
                    .unwrap(),
            ),
            student_id,
            "reply to a reply",
        )
        .await;
        assert!(nested.is_err(), "replying to a reply must be rejected");
    }

    #[rocket::async_test]
    async fn soft_delete_tombstones_comment_body() {
        let db = db_three_users().await;
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();
        let thread_id = create_thread(
            &db.pool,
            NewThread {
                author_id: student_id,
                anchor: Anchor {
                    kind: AnchorKind::StudentProfile,
                    id: student_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "q".to_string(),
            },
        )
        .await
        .unwrap();
        let comment_id =
            create_comment(&db.pool, thread_id, None, student_id, "oops").await.unwrap();
        soft_delete_comment(&db.pool, comment_id, coach_id).await.unwrap();

        let view = get_thread(
            &db.pool,
            thread_id,
            Viewer { user_id: coach_id, is_coach: true },
        )
        .await
        .unwrap()
        .unwrap();
        let c = view.comments.iter().find(|c| c.id == comment_id).unwrap();
        assert!(c.deleted_at.is_some());
        assert!(c.body.is_none(), "deleted comment body must be tombstoned (None)");
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
