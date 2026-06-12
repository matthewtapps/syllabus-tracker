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
    async fn list_filters_private_threads_for_non_scope_viewer() {
        use crate::db::threads::list_threads_for_anchor;
        let db = db_three_users().await;
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();
        let other = db.user_id("student2").unwrap();

        create_thread(&db.pool, NewThread {
            author_id: coach_id,
            anchor: Anchor { kind: AnchorKind::StudentProfile, id: student_id, video_ts_seconds: None, pinned_student_id: None },
            visibility: ThreadVisibility::Private,
            scope_student_id: Some(student_id),
            body: "hi".to_string(),
        }).await.unwrap();

        let anchor = Anchor { kind: AnchorKind::StudentProfile, id: student_id, video_ts_seconds: None, pinned_student_id: None };
        let as_owner = list_threads_for_anchor(&db.pool, anchor, Viewer { user_id: student_id, is_coach: false }).await.unwrap();
        assert_eq!(as_owner.len(), 1);
        let as_other = list_threads_for_anchor(&db.pool, anchor, Viewer { user_id: other, is_coach: false }).await.unwrap();
        assert_eq!(as_other.len(), 0, "another student must not see the private profile thread");
    }

    #[rocket::async_test]
    async fn soft_delete_thread_tombstones_body() {
        use crate::db::threads::soft_delete_thread;
        let db = db_three_users().await;
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();
        let t = create_thread(&db.pool, NewThread {
            author_id: student_id,
            anchor: Anchor { kind: AnchorKind::StudentProfile, id: student_id, video_ts_seconds: None, pinned_student_id: None },
            visibility: ThreadVisibility::Private,
            scope_student_id: Some(student_id),
            body: "q".to_string(),
        }).await.unwrap();

        soft_delete_thread(&db.pool, t, coach_id).await.unwrap();
        let view = get_thread(&db.pool, t, Viewer { user_id: coach_id, is_coach: true }).await.unwrap().unwrap();
        assert!(view.deleted_at.is_some());
        assert!(view.body.is_none(), "deleted thread body must be tombstoned");
    }

    // ---- Video / VideoTimestamp anchor tests ----

    /// Helper: insert a live (not deleted, not hidden) video row for a technique
    /// and return its id. The builder doesn't create videos, so we INSERT directly.
    async fn insert_live_video(pool: &sqlx::Pool<sqlx::Sqlite>, technique_id: i64, uploader_id: i64) -> i64 {
        sqlx::query_scalar!(
            r#"INSERT INTO videos
                  (technique_id, title, kind, processing_status, uploaded_by_id,
                   deleted_at, hidden_at)
               VALUES (?, 'Test Video', 'external', 'ready', ?, NULL, NULL)
               RETURNING id AS "id!: i64""#,
            technique_id,
            uploader_id,
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[rocket::async_test]
    async fn video_thread_round_trips() {
        use crate::db::threads::list_threads_for_anchor;
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .student("student2", Some("Mia"))
            .technique("Armbar", "an armbar", Some("coach_user"))
            .build()
            .await
            .unwrap();
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();
        let other_id = db.user_id("student2").unwrap();
        let technique_id = db.technique_id("Armbar").unwrap();
        let video_id = insert_live_video(&db.pool, technique_id, coach_id).await;

        let thread_id = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor { kind: AnchorKind::Video, id: video_id, video_ts_seconds: None, pinned_student_id: None },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "Great video!".to_string(),
            },
        )
        .await
        .unwrap();

        // Owner can see it
        let anchor = Anchor { kind: AnchorKind::Video, id: video_id, video_ts_seconds: None, pinned_student_id: None };
        let as_owner = list_threads_for_anchor(&db.pool, anchor, Viewer { user_id: student_id, is_coach: false }).await.unwrap();
        assert_eq!(as_owner.len(), 1);
        assert_eq!(as_owner[0].id, thread_id);

        // Another student cannot see the private thread
        let as_other = list_threads_for_anchor(&db.pool, anchor, Viewer { user_id: other_id, is_coach: false }).await.unwrap();
        assert_eq!(as_other.len(), 0, "private video thread must not leak to another student");
    }

    #[rocket::async_test]
    async fn video_timestamp_thread_surfaces_alongside_video_thread() {
        use crate::db::threads::list_threads_for_anchor;
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .technique("Armbar", "an armbar", Some("coach_user"))
            .build()
            .await
            .unwrap();
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();
        let technique_id = db.technique_id("Armbar").unwrap();
        let video_id = insert_live_video(&db.pool, technique_id, coach_id).await;

        // Create a whole-video thread and a timestamped thread on the same video
        let _whole = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor { kind: AnchorKind::Video, id: video_id, video_ts_seconds: None, pinned_student_id: None },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "Overall comment".to_string(),
            },
        )
        .await
        .unwrap();

        let _ts = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor { kind: AnchorKind::VideoTimestamp, id: video_id, video_ts_seconds: Some(42), pinned_student_id: None },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "At 42 seconds".to_string(),
            },
        )
        .await
        .unwrap();

        // Listing by video anchor returns BOTH kinds
        let anchor = Anchor { kind: AnchorKind::Video, id: video_id, video_ts_seconds: None, pinned_student_id: None };
        let views = list_threads_for_anchor(&db.pool, anchor, Viewer { user_id: student_id, is_coach: false }).await.unwrap();
        assert_eq!(views.len(), 2, "video anchor list must include both video and video_timestamp threads");

        // Also listing by video_timestamp anchor returns both
        let anchor_ts = Anchor { kind: AnchorKind::VideoTimestamp, id: video_id, video_ts_seconds: Some(42), pinned_student_id: None };
        let views_ts = list_threads_for_anchor(&db.pool, anchor_ts, Viewer { user_id: student_id, is_coach: false }).await.unwrap();
        assert_eq!(views_ts.len(), 2, "video_timestamp anchor list must also return both kinds");
    }

    #[rocket::async_test]
    async fn validate_anchor_rejects_missing_video() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();

        let result = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor { kind: AnchorKind::Video, id: 9999, video_ts_seconds: None, pinned_student_id: None },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "should fail".to_string(),
            },
        )
        .await;
        assert!(result.is_err(), "creating a video thread with no video must be rejected");
    }

    // ---- SST anchor tests ----

    /// Helper: create a syllabus, add a technique, assign it to a student, and
    /// return the SST id. Uses the public `db::*` helpers the same way syllabus
    /// tests do.
    async fn insert_sst(
        pool: &sqlx::Pool<sqlx::Sqlite>,
        coach_id: i64,
        student_id: i64,
        technique_id: i64,
    ) -> i64 {
        use crate::db::{PropagationMode, add_technique_to_syllabus, assign, create_syllabus};
        let syllabus_id = create_syllabus(pool, "Test Syllabus", None, coach_id).await.unwrap();
        add_technique_to_syllabus(pool, syllabus_id, technique_id, coach_id, PropagationMode::SyllabusOnly).await.unwrap();
        let _assignment_id = assign(pool, coach_id, student_id, syllabus_id).await.unwrap();
        sqlx::query_scalar!(
            r#"SELECT id AS "id!: i64" FROM student_syllabus_techniques
               WHERE technique_id = ?
               LIMIT 1"#,
            technique_id,
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[rocket::async_test]
    async fn sst_thread_round_trips() {
        use crate::db::threads::list_threads_for_anchor;
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .technique("Armbar", "an armbar", Some("coach_user"))
            .build()
            .await
            .unwrap();
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();
        let technique_id = db.technique_id("Armbar").unwrap();
        let sst_id = insert_sst(&db.pool, coach_id, student_id, technique_id).await;

        let thread_id = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor { kind: AnchorKind::Sst, id: sst_id, video_ts_seconds: None, pinned_student_id: None },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "Work on your grip here.".to_string(),
            },
        )
        .await
        .unwrap();

        let anchor = Anchor { kind: AnchorKind::Sst, id: sst_id, video_ts_seconds: None, pinned_student_id: None };
        let views = list_threads_for_anchor(&db.pool, anchor, Viewer { user_id: student_id, is_coach: false }).await.unwrap();
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].id, thread_id);
    }

    // ---- PinnedTechnique anchor tests ----

    #[rocket::async_test]
    async fn pinned_technique_thread_requires_pin_to_exist() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .technique("Armbar", "an armbar", Some("coach_user"))
            .build()
            .await
            .unwrap();
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();
        let technique_id = db.technique_id("Armbar").unwrap();

        // No pin inserted yet — should be rejected
        let result = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::PinnedTechnique,
                    id: technique_id,
                    video_ts_seconds: None,
                    pinned_student_id: Some(student_id),
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "should fail".to_string(),
            },
        )
        .await;
        assert!(result.is_err(), "pinned_technique thread must be rejected when no pin exists");
    }

    #[rocket::async_test]
    async fn pinned_technique_thread_missing_student_rejected() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .technique("Armbar", "an armbar", Some("coach_user"))
            .build()
            .await
            .unwrap();
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();
        let technique_id = db.technique_id("Armbar").unwrap();

        let result = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::PinnedTechnique,
                    id: technique_id,
                    video_ts_seconds: None,
                    pinned_student_id: None, // missing
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "should fail".to_string(),
            },
        )
        .await;
        assert!(result.is_err(), "pinned_technique thread without pinned_student_id must be rejected");
    }

    #[rocket::async_test]
    async fn pinned_technique_thread_round_trips() {
        use crate::db::{pin_technique, threads::list_threads_for_anchor};
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .technique("Armbar", "an armbar", Some("coach_user"))
            .build()
            .await
            .unwrap();
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();
        let technique_id = db.technique_id("Armbar").unwrap();

        pin_technique(&db.pool, student_id, technique_id).await.unwrap();

        let thread_id = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::PinnedTechnique,
                    id: technique_id,
                    video_ts_seconds: None,
                    pinned_student_id: Some(student_id),
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "Nice pin!".to_string(),
            },
        )
        .await
        .unwrap();

        let anchor = Anchor {
            kind: AnchorKind::PinnedTechnique,
            id: technique_id,
            video_ts_seconds: None,
            pinned_student_id: Some(student_id),
        };
        let views = list_threads_for_anchor(&db.pool, anchor, Viewer { user_id: student_id, is_coach: false }).await.unwrap();
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].id, thread_id);
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

    // --- HTTP endpoint tests ---

    use crate::test::test_utils::{login_test_user, setup_test_client, TestDbBuilder as TB};
    use rocket::http::{ContentType, Status as HttpStatus};
    use serde_json::{json, Value};

    async fn client_with_users() -> (rocket::local::asynchronous::Client, crate::test::test_utils::TestDb) {
        let db = TB::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .student("student2", Some("Mia"))
            .build().await.unwrap();
        setup_test_client(db).await
    }

    #[rocket::async_test]
    async fn coach_creates_profile_thread_student_replies() {
        let (client, db) = client_with_users().await;
        let student_id = db.user_id("student_user").unwrap();

        login_test_user(&client, "coach_user", "password123").await;
        let create = client.post("/api/threads").header(ContentType::JSON)
            .body(json!({"anchor_kind":"student_profile","anchor_id":student_id,"visibility":"private","scope_student_id":student_id,"body":"Plan your six weeks."}).to_string())
            .dispatch().await;
        assert_eq!(create.status(), HttpStatus::Ok);
        let thread_id = create.into_json::<Value>().await.unwrap()["id"].as_i64().unwrap();

        login_test_user(&client, "student_user", "password123").await;
        let reply = client.post(format!("/api/threads/{thread_id}/comments")).header(ContentType::JSON)
            .body(json!({"body":"Sounds good."}).to_string()).dispatch().await;
        assert_eq!(reply.status(), HttpStatus::Ok);
    }

    #[rocket::async_test]
    async fn student_cannot_post_on_another_students_profile() {
        let (client, db) = client_with_users().await;
        let victim_id = db.user_id("student2").unwrap();
        login_test_user(&client, "student_user", "password123").await;
        let res = client.post("/api/threads").header(ContentType::JSON)
            .body(json!({"anchor_kind":"student_profile","anchor_id":victim_id,"visibility":"private","scope_student_id":victim_id,"body":"intrusion"}).to_string())
            .dispatch().await;
        assert_eq!(res.status(), HttpStatus::Forbidden);
    }

    #[rocket::async_test]
    async fn student_cannot_broadcast() {
        let (client, _db) = client_with_users().await;
        login_test_user(&client, "student_user", "password123").await;
        let res = client.post("/api/threads").header(ContentType::JSON)
            .body(json!({"anchor_kind":"technique","anchor_id":1,"visibility":"broadcast","body":"everyone look"}).to_string())
            .dispatch().await;
        assert_eq!(res.status(), HttpStatus::Forbidden);
    }
}
