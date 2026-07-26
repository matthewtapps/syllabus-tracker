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
    async fn thread_comments_has_no_reference_columns() {
        // The clip-reference feature was dropped; the columns must not exist.
        let db = create_standard_test_db().await;
        let cols: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM pragma_table_info('thread_comments') \
             WHERE name IN ('references_video_id','ref_ts_seconds') ORDER BY name",
        )
        .fetch_all(&db.pool)
        .await
        .unwrap();
        assert!(cols.is_empty(), "unexpected clip-reference columns: {cols:?}");
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
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "Let's plan your next six weeks.".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
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
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "question".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        create_comment(&db.pool, thread_id, None, coach_id, "answer", None, None, false)
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
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "q".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();
        let top =
            create_comment(&db.pool, thread_id, None, student_id, "top", None, None, false).await.unwrap();
        create_comment(&db.pool, thread_id, Some(top), student_id, "ok reply", None, None, false)
            .await
            .unwrap();
        let nested = create_comment(
            &db.pool,
            thread_id,
            Some(
                create_comment(&db.pool, thread_id, Some(top), student_id, "another reply", None, None, false)
                    .await
                    .unwrap(),
            ),
            student_id,
            "reply to a reply",
            None,
            None,
            false,
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
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "q".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();
        let comment_id =
            create_comment(&db.pool, thread_id, None, student_id, "oops", None, None, false).await.unwrap();
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
            anchor: Anchor { kind: AnchorKind::StudentProfile, id: student_id, video_ts_seconds: None, pinned_student_id: None, camp_id: None },
            visibility: ThreadVisibility::Private,
            scope_student_id: Some(student_id),
            body: "hi".to_string(),
            attached_video_id: None,
            attached_video_is_reference: false,
            attached_video_title: None,
        }).await.unwrap();

        let anchor = Anchor { kind: AnchorKind::StudentProfile, id: student_id, video_ts_seconds: None, pinned_student_id: None, camp_id: None };
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
            anchor: Anchor { kind: AnchorKind::StudentProfile, id: student_id, video_ts_seconds: None, pinned_student_id: None, camp_id: None },
            visibility: ThreadVisibility::Private,
            scope_student_id: Some(student_id),
            body: "q".to_string(),
            attached_video_id: None,
            attached_video_is_reference: false,
            attached_video_title: None,
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
                anchor: Anchor { kind: AnchorKind::Video, id: video_id, video_ts_seconds: None, pinned_student_id: None, camp_id: None },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "Great video!".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        // Owner can see it
        let anchor = Anchor { kind: AnchorKind::Video, id: video_id, video_ts_seconds: None, pinned_student_id: None, camp_id: None };
        let as_owner = list_threads_for_anchor(&db.pool, anchor, Viewer { user_id: student_id, is_coach: false }).await.unwrap();
        assert_eq!(as_owner.len(), 1);
        assert_eq!(as_owner[0].id, thread_id);

        // Another student cannot see the private thread
        let as_other = list_threads_for_anchor(&db.pool, anchor, Viewer { user_id: other_id, is_coach: false }).await.unwrap();
        assert_eq!(as_other.len(), 0, "private video thread must not leak to another student");
    }

    #[rocket::async_test]
    async fn count_video_comments_respects_visibility() {
        use crate::db::threads::count_video_comments_visible;
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

        // One private thread scoped to each student.
        for sid in [student_id, other_id] {
            create_thread(
                &db.pool,
                NewThread {
                    author_id: coach_id,
                    anchor: Anchor { kind: AnchorKind::Video, id: video_id, video_ts_seconds: None, pinned_student_id: None, camp_id: None },
                    visibility: ThreadVisibility::Private,
                    scope_student_id: Some(sid),
                    body: "note".to_string(),
                    attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
                },
            )
            .await
            .unwrap();
        }

        let ids = [video_id];
        let coach_counts = count_video_comments_visible(&db.pool, &ids, Viewer { user_id: coach_id, is_coach: true }).await.unwrap();
        assert_eq!(coach_counts.get(&video_id).copied().unwrap_or(0), 2, "coach sees every thread");

        let sam_counts = count_video_comments_visible(&db.pool, &ids, Viewer { user_id: student_id, is_coach: false }).await.unwrap();
        assert_eq!(sam_counts.get(&video_id).copied().unwrap_or(0), 1, "student sees only their own private thread");

        let mia_counts = count_video_comments_visible(&db.pool, &ids, Viewer { user_id: other_id, is_coach: false }).await.unwrap();
        assert_eq!(mia_counts.get(&video_id).copied().unwrap_or(0), 1, "other student counts only their own");
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
                anchor: Anchor { kind: AnchorKind::Video, id: video_id, video_ts_seconds: None, pinned_student_id: None, camp_id: None },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "Overall comment".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        let _ts = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor { kind: AnchorKind::VideoTimestamp, id: video_id, video_ts_seconds: Some(42), pinned_student_id: None, camp_id: None },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "At 42 seconds".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        // Listing by video anchor returns BOTH kinds
        let anchor = Anchor { kind: AnchorKind::Video, id: video_id, video_ts_seconds: None, pinned_student_id: None, camp_id: None };
        let views = list_threads_for_anchor(&db.pool, anchor, Viewer { user_id: student_id, is_coach: false }).await.unwrap();
        assert_eq!(views.len(), 2, "video anchor list must include both video and video_timestamp threads");

        // Also listing by video_timestamp anchor returns both
        let anchor_ts = Anchor { kind: AnchorKind::VideoTimestamp, id: video_id, video_ts_seconds: Some(42), pinned_student_id: None, camp_id: None };
        let views_ts = list_threads_for_anchor(&db.pool, anchor_ts, Viewer { user_id: student_id, is_coach: false }).await.unwrap();
        assert_eq!(views_ts.len(), 2, "video_timestamp anchor list must also return both kinds");
    }

    #[rocket::async_test]
    async fn video_ts_seconds_exposed_on_thread_view() {
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

        // Whole-video thread: video_ts_seconds must be None
        create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::Video,
                    id: video_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "Overall comment".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        // Timestamped thread: video_ts_seconds must be Some(42)
        create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::VideoTimestamp,
                    id: video_id,
                    video_ts_seconds: Some(42),
                    pinned_student_id: None,
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "At 42 seconds".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        // Listing by Video anchor returns both; ordered by COALESCE(video_ts_seconds, 0)
        let anchor = Anchor {
            kind: AnchorKind::Video,
            id: video_id,
            video_ts_seconds: None,
            pinned_student_id: None,
            camp_id: None,
        };
        let threads = list_threads_for_anchor(
            &db.pool,
            anchor,
            Viewer { user_id: student_id, is_coach: false },
        )
        .await
        .unwrap();

        assert_eq!(threads.len(), 2);
        assert_eq!(threads[0].video_ts_seconds, None, "whole-video thread must have None");
        assert_eq!(threads[1].video_ts_seconds, Some(42), "timestamped thread must carry 42");
    }

    /// CX-010: a video whose parent is a thread (a "video reply") must not be
    /// allowed to anchor a NEW thread. No endless reply chains.
    #[rocket::async_test]
    async fn cannot_start_thread_on_a_thread_reply_video() {
        use crate::db::{create_processing_video, VideoParent};
        let db = db_with_coach_and_student().await;
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();

        // A root thread on the student profile.
        let root_thread_id = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::StudentProfile,
                    id: student_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "Here's a fix.".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        // A video reply hanging off that thread.
        let reply_video_id = create_processing_video(
            &db.pool,
            VideoParent::Thread(root_thread_id),
            "reply clip",
            None,
            coach_id,
        )
        .await
        .unwrap();

        // Attempting to anchor a NEW thread on that reply video must be rejected.
        let result = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::Video,
                    id: reply_video_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "should be rejected".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await;
        // Must be rejected by the CX-010 validation guard specifically (a 400),
        // not incidentally by a downstream constraint failure.
        match result {
            Err(crate::error::AppError::Validation(_)) => {}
            other => panic!(
                "CX-010: a thread-reply video must be rejected with a Validation error, got {other:?}"
            ),
        }
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
                anchor: Anchor { kind: AnchorKind::Video, id: 9999, video_ts_seconds: None, pinned_student_id: None, camp_id: None },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "should fail".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
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
                anchor: Anchor { kind: AnchorKind::Sst, id: sst_id, video_ts_seconds: None, pinned_student_id: None, camp_id: None },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "Work on your grip here.".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        let anchor = Anchor { kind: AnchorKind::Sst, id: sst_id, video_ts_seconds: None, pinned_student_id: None, camp_id: None };
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
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "should fail".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
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
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "should fail".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
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
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "Nice pin!".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        let anchor = Anchor {
            kind: AnchorKind::PinnedTechnique,
            id: technique_id,
            video_ts_seconds: None,
            pinned_student_id: Some(student_id),
            camp_id: None,
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
                    camp_id: None,
                },
                visibility: ThreadVisibility::Broadcast,
                scope_student_id: None,
                body: "nope".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await;
        assert!(result.is_err(), "broadcast on a profile anchor must be rejected");
    }

    /// The empty-body exemption is ONLY for camp_technique anchors (where the
    /// technique itself is the content). A plain Camp anchor with an empty body
    /// and no video must still be rejected with a Validation error. This guards
    /// against the exemption being accidentally widened to other anchor kinds.
    #[rocket::async_test]
    async fn empty_body_camp_anchor_is_rejected() {
        use crate::db::camps::{create_camp, NewCamp};
        let db = db_with_coach_and_student().await;
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();

        let camp_id = create_camp(
            &db.pool,
            NewCamp {
                student_id,
                coach_id,
                name: "Guard camp".to_string(),
                description: None,
            },
        )
        .await
        .unwrap();

        let result = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::Camp,
                    id: camp_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await;

        match result {
            Err(crate::error::AppError::Validation(_)) => {}
            other => panic!(
                "a Camp anchor with empty body and no video must return Validation error, got {other:?}"
            ),
        }
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

    /// A student may start a camp-level thread on their OWN camp. The thread is
    /// forced Private and scoped to the camp's student regardless of the request.
    #[rocket::async_test]
    async fn student_creates_camp_level_thread_on_own_camp() {
        let (client, db) = client_with_users().await;
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Own camp') RETURNING id",
        )
        .bind(student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        login_test_user(&client, "student_user", "password123").await;
        let res = client.post("/api/threads").header(ContentType::JSON)
            .body(json!({"anchor_kind":"camp","anchor_id":camp_id,"visibility":"private","scope_student_id":null,"body":"How's my prep?"}).to_string())
            .dispatch().await;
        assert_eq!(res.status(), HttpStatus::Ok);
        let thread_id = res.into_json::<Value>().await.unwrap()["id"].as_i64().unwrap();

        let (vis, scope, got_camp): (String, i64, i64) = sqlx::query_as(
            "SELECT visibility, scope_student_id, camp_id FROM threads WHERE id = ?",
        )
        .bind(thread_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(vis, "private", "camp threads must be forced private");
        assert_eq!(scope, student_id, "camp thread must be scoped to the camp's student");
        assert_eq!(got_camp, camp_id);
    }

    /// A student must NOT be able to start a camp-level thread on another
    /// student's camp.
    #[rocket::async_test]
    async fn student_cannot_create_camp_thread_on_another_students_camp() {
        let (client, db) = client_with_users().await;
        let coach_id = db.user_id("coach_user").unwrap();
        let other_student_id = db.user_id("student2").unwrap();

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Other camp') RETURNING id",
        )
        .bind(other_student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        login_test_user(&client, "student_user", "password123").await;
        let res = client.post("/api/threads").header(ContentType::JSON)
            .body(json!({"anchor_kind":"camp","anchor_id":camp_id,"visibility":"private","scope_student_id":null,"body":"intrusion"}).to_string())
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

    // ---- Activity-feed emission tests ----

    /// Creating a private profile thread must insert exactly one activity row
    /// with verb='thread_comment_posted', thread_id = the new thread id, and
    /// target_student_id = the scope student.
    #[rocket::async_test]
    async fn private_profile_thread_emits_one_activity_row() {
        let db = db_with_coach_and_student().await;
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();

        let thread_id = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::StudentProfile,
                    id: student_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "Let's plan your next cycle.".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        let row = sqlx::query!(
            r#"SELECT verb, thread_id AS "thread_id?: i64",
                      target_student_id AS "target_student_id?: i64"
               FROM activity
               WHERE verb = 'thread_comment_posted'"#
        )
        .fetch_all(&db.pool)
        .await
        .unwrap();

        assert_eq!(row.len(), 1, "expected exactly one activity row");
        assert_eq!(row[0].thread_id, Some(thread_id));
        assert_eq!(row[0].target_student_id, Some(student_id));
    }

    /// Two comments on the same thread by the same author within the same
    /// second must produce TWO separate activity rows (non-coalescing).
    #[rocket::async_test]
    async fn two_comments_produce_two_activity_rows() {
        let db = db_with_coach_and_student().await;
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();

        let thread_id = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::StudentProfile,
                    id: student_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "Thread body".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        create_comment(&db.pool, thread_id, None, coach_id, "first comment", None, None, false)
            .await
            .unwrap();
        create_comment(&db.pool, thread_id, None, coach_id, "second comment", None, None, false)
            .await
            .unwrap();

        // The thread create itself emits one row, plus two comment rows = 3 total.
        // We specifically check there are at least 2 rows for this thread from the
        // same author to prove non-coalescing (same actor, verb, thread within window).
        let count: i64 = sqlx::query_scalar!(
            r#"SELECT COUNT(*) AS "c!: i64" FROM activity
               WHERE verb = 'thread_comment_posted'
                 AND thread_id = ?
                 AND actor_user_id = ?"#,
            thread_id,
            coach_id,
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();

        assert_eq!(count, 3, "thread create + 2 comments must produce 3 non-coalesced rows");
    }

    /// A broadcast technique thread emits an activity row with
    /// target_student_id IS NULL.
    #[rocket::async_test]
    async fn broadcast_technique_thread_emits_null_target() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .technique("Armbar", "an armbar", Some("coach_user"))
            .build()
            .await
            .unwrap();
        let coach_id = db.user_id("coach_user").unwrap();
        let technique_id = db.technique_id("Armbar").unwrap();

        let thread_id = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::Technique,
                    id: technique_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: None,
                },
                visibility: ThreadVisibility::Broadcast,
                scope_student_id: None,
                body: "Coach broadcast on technique.".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        let row = sqlx::query!(
            r#"SELECT target_student_id AS "target_student_id?: i64",
                      technique_id      AS "technique_id?: i64"
               FROM activity
               WHERE verb = 'thread_comment_posted' AND thread_id = ?"#,
            thread_id,
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();

        assert!(
            row.target_student_id.is_none(),
            "broadcast thread must emit NULL target_student_id"
        );
        assert_eq!(
            row.technique_id,
            Some(technique_id),
            "technique_id must be denormalised onto the activity row"
        );
    }

    /// A technique-anchored thread tags the activity row with the library
    /// context so the feed can deep-link to the library surface.
    #[rocket::async_test]
    async fn technique_thread_emits_library_context() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .technique("Armbar", "an armbar", Some("coach_user"))
            .build()
            .await
            .unwrap();
        let coach_id = db.user_id("coach_user").unwrap();
        let technique_id = db.technique_id("Armbar").unwrap();

        let thread_id = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::Technique,
                    id: technique_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: None,
                },
                visibility: ThreadVisibility::Broadcast,
                scope_student_id: None,
                body: "Look at this entry.".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        let row = sqlx::query!(
            r#"SELECT context_kind, technique_id AS "technique_id?: i64"
               FROM activity
               WHERE verb = 'thread_comment_posted' AND thread_id = ?"#,
            thread_id,
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();

        assert_eq!(row.context_kind.as_deref(), Some("library"));
        assert_eq!(row.technique_id, Some(technique_id));
    }

    /// A video-anchored comment denormalises the video's owning technique onto
    /// its activity row, so the feed can name the technique and deep-link to the
    /// library technique row (not just the bare video).
    #[rocket::async_test]
    async fn video_comment_emits_technique_context() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .technique("Armbar", "an armbar", Some("coach_user"))
            .build()
            .await
            .unwrap();
        let coach_id = db.user_id("coach_user").unwrap();
        let technique_id = db.technique_id("Armbar").unwrap();
        let video_id = insert_live_video(&db.pool, technique_id, coach_id).await;

        let thread_id = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::Video,
                    id: video_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: None,
                },
                visibility: ThreadVisibility::Broadcast,
                scope_student_id: None,
                body: "Nice detail here.".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        // Runtime query (not the macro) so this assertion needs no .sqlx entry.
        use sqlx::Row;
        let row = sqlx::query(
            "SELECT context_kind, video_id, technique_id
               FROM activity
               WHERE verb = 'thread_comment_posted' AND thread_id = ?",
        )
        .bind(thread_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let context_kind: Option<String> = row.try_get("context_kind").unwrap();
        let got_video_id: Option<i64> = row.try_get("video_id").unwrap();
        let got_technique_id: Option<i64> = row.try_get("technique_id").unwrap();
        assert_eq!(context_kind.as_deref(), Some("library"));
        assert_eq!(got_video_id, Some(video_id));
        assert_eq!(got_technique_id, Some(technique_id), "video comment carries its technique");
    }

    /// An SST-anchored thread resolves and denormalises the syllabus id and the
    /// syllabus context_kind, so the feed can deep-link to the student's
    /// syllabus surface. A private thread keeps target_student_id = scope.
    #[rocket::async_test]
    async fn sst_thread_emits_syllabus_context() {
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

        // The syllabus the SST belongs to, for comparison.
        let expected_syllabus_id = sqlx::query_scalar!(
            r#"SELECT a.syllabus_id AS "sid!: i64"
               FROM student_syllabus_techniques sst
               JOIN syllabus_assignments a ON a.id = sst.assignment_id
               WHERE sst.id = ?"#,
            sst_id,
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let thread_id = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::Sst,
                    id: sst_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "On your syllabus technique.".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        let row = sqlx::query!(
            r#"SELECT context_kind,
                      sst_id            AS "sst_id?: i64",
                      syllabus_id       AS "syllabus_id?: i64",
                      target_student_id AS "target_student_id?: i64"
               FROM activity
               WHERE verb = 'thread_comment_posted' AND thread_id = ?"#,
            thread_id,
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();

        assert_eq!(row.context_kind.as_deref(), Some("syllabus"));
        assert_eq!(row.sst_id, Some(sst_id));
        assert_eq!(row.syllabus_id, Some(expected_syllabus_id));
        assert_eq!(row.target_student_id, Some(student_id));
    }

    /// A comment (not just the thread-create) on an SST-anchored thread also
    /// carries the syllabus context, since deep-linking applies to every row.
    #[rocket::async_test]
    async fn sst_comment_emits_syllabus_context() {
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
                anchor: Anchor {
                    kind: AnchorKind::Sst,
                    id: sst_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "Thread body.".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        create_comment(&db.pool, thread_id, None, coach_id, "a reply", None, None, false)
            .await
            .unwrap();

        // The most recent row is the comment; assert it carries the context.
        let row = sqlx::query!(
            r#"SELECT context_kind, syllabus_id AS "syllabus_id?: i64"
               FROM activity
               WHERE verb = 'thread_comment_posted' AND thread_id = ?
               ORDER BY id DESC LIMIT 1"#,
            thread_id,
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();

        assert_eq!(row.context_kind.as_deref(), Some("syllabus"));
        assert!(row.syllabus_id.is_some(), "comment row must carry syllabus_id");
    }

    #[rocket::async_test]
    async fn comment_carries_attached_video() {
        let db = db_with_coach_and_student().await;
        let coach_id = db.user_id("coach_user").unwrap();

        sqlx::query("INSERT INTO techniques (id, name) VALUES (1, 'Armbar')")
            .execute(&db.pool).await.unwrap();
        let thread_id = create_thread(&db.pool, NewThread {
            author_id: coach_id,
            anchor: Anchor { kind: AnchorKind::Technique, id: 1, video_ts_seconds: None,
                             pinned_student_id: None, camp_id: None },
            visibility: ThreadVisibility::Broadcast,
            scope_student_id: None,
            body: "thoughts?".to_string(),
            attached_video_id: None,
            attached_video_is_reference: false,
            attached_video_title: None,
        }).await.unwrap();

        // A ready draft video uploaded by the comment's author.
        let video_id: i64 = sqlx::query_scalar(
            "INSERT INTO videos (parent_kind, title, position, kind, \
                processing_status, uploaded_by_id) \
             VALUES ('loose', '', 0, 'native', 'ready', ?) RETURNING id")
            .bind(coach_id)
            .fetch_one(&db.pool).await.unwrap();

        create_comment(&db.pool, thread_id, None, coach_id, "great clip", Some(video_id), None, false)
            .await.unwrap();

        let view = get_thread(&db.pool, thread_id,
            Viewer { user_id: coach_id, is_coach: true }).await.unwrap().unwrap();

        assert_eq!(view.comments.len(), 1);
        let v = view.comments[0].video.as_ref().expect("comment carries its video");
        assert_eq!(v.id, video_id);
        // The draft was re-parented onto the thread.
        let (pk, tid): (String, Option<i64>) = sqlx::query_as(
            "SELECT parent_kind, thread_id FROM videos WHERE id = ?")
            .bind(video_id)
            .fetch_one(&db.pool).await.unwrap();
        assert_eq!(pk, "thread");
        assert_eq!(tid, Some(thread_id));
    }

    /// A comment can carry an optional `video_ts_seconds` pinning it to a moment
    /// in its thread's attached video. The value must round-trip through
    /// `create_comment` / `get_thread` unchanged.
    #[rocket::async_test]
    async fn comment_carries_video_timestamp() {
        use crate::db::camps::{create_camp, NewCamp};
        let db = db_with_coach_and_student().await;
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();

        let camp_id = create_camp(
            &db.pool,
            NewCamp {
                student_id,
                coach_id,
                name: "Timestamp camp".to_string(),
                description: None,
            },
        )
        .await
        .unwrap();

        let thread_id = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::Camp,
                    id: camp_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "Watch this moment.".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        create_comment(&db.pool, thread_id, None, coach_id, "check 12s", None, Some(12), false)
            .await
            .unwrap();

        let view = get_thread(
            &db.pool,
            thread_id,
            Viewer { user_id: coach_id, is_coach: true },
        )
        .await
        .unwrap()
        .unwrap();

        assert_eq!(view.comments.len(), 1);
        assert_eq!(
            view.comments[0].video_ts_seconds,
            Some(12),
            "comment must carry the video_ts_seconds it was created with"
        );
    }

    // ---- CampTechnique anchor tests ----

    #[rocket::async_test]
    async fn camp_technique_thread_stores_camp_and_technique() {
        use crate::db::camps::{create_camp, NewCamp};
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

        let camp_id = create_camp(
            &db.pool,
            NewCamp {
                student_id,
                coach_id,
                name: "X-guard camp".to_string(),
                description: None,
            },
        )
        .await
        .unwrap();
        // No prior camp_techniques membership needed; posting the thread is the attach.

        let anchor = Anchor {
            kind: AnchorKind::CampTechnique,
            id: technique_id,
            video_ts_seconds: None,
            pinned_student_id: None,
            camp_id: Some(camp_id),
        };
        let id = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor,
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "camp technique note".into(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        let row = sqlx::query!(
            r#"SELECT anchor_kind, camp_id AS "camp_id?: i64", technique_id AS "technique_id?: i64"
               FROM threads WHERE id = ?"#,
            id
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(row.anchor_kind, "camp_technique");
        assert_eq!(row.camp_id, Some(camp_id));
        assert_eq!(row.technique_id, Some(technique_id));
    }

    /// Attaching the technique and talking about it are different events. The
    /// camp_technique thread IS the attach, so it emits camp_technique_added and
    /// the feed captions it "Added"; a reply on that same thread is a comment
    /// and must still emit thread_comment_posted, or the camp feed would caption
    /// every conversation on a technique as another attach.
    #[rocket::async_test]
    async fn camp_technique_attach_and_reply_emit_different_verbs() {
        use crate::db::camps::{create_camp, NewCamp};
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

        let camp_id = create_camp(
            &db.pool,
            NewCamp {
                student_id,
                coach_id,
                name: "X-guard camp".to_string(),
                description: None,
            },
        )
        .await
        .unwrap();

        // The attach: an empty body, exactly as the camp page posts it.
        let thread_id = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::CampTechnique,
                    id: technique_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: Some(camp_id),
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: String::new(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        create_comment(&db.pool, thread_id, None, student_id, "drilled it", None, None, false)
            .await
            .unwrap();

        let verbs: Vec<String> = sqlx::query_scalar(
            "SELECT verb FROM activity WHERE thread_id = ? ORDER BY id",
        )
        .bind(thread_id)
        .fetch_all(&db.pool)
        .await
        .unwrap();

        assert_eq!(
            verbs,
            vec![
                "camp_technique_added".to_string(),
                "thread_comment_posted".to_string()
            ],
            "the attach reads as added, the reply as a comment"
        );
    }

    /// Under the new feed model, posting a global library technique to a camp
    /// is the attach step itself. No prior camp_techniques membership is required:
    /// the anchor is valid as long as the camp exists and the technique is global
    /// (scoped_camp_id IS NULL) or scoped to this specific camp.
    #[rocket::async_test]
    async fn camp_technique_thread_valid_without_pre_attach() {
        use crate::db::camps::{create_camp, NewCamp};
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .technique("Armbar", "an armbar", Some("coach_user"))
            .build()
            .await
            .unwrap();
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();
        // Technique created by TestDbBuilder has is_global=1, scoped_camp_id=NULL.
        let technique_id = db.technique_id("Armbar").unwrap();

        let camp_id = create_camp(
            &db.pool,
            NewCamp {
                student_id,
                coach_id,
                name: "X-guard camp".to_string(),
                description: None,
            },
        )
        .await
        .unwrap();
        // Intentionally NOT calling add_camp_technique: posting the thread IS the attach.

        let result = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::CampTechnique,
                    id: technique_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: Some(camp_id),
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "posting without pre-attach must succeed".into(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await;
        assert!(
            result.is_ok(),
            "global library technique must be valid without prior camp_techniques membership"
        );
    }

    /// A technique scoped to a DIFFERENT camp (scoped_camp_id = other_camp) must
    /// be rejected when posted to this camp via a camp_technique anchor.
    #[rocket::async_test]
    async fn camp_technique_thread_rejects_other_camps_scoped_technique() {
        use crate::db::camps::{create_camp, create_camp_technique_new, NewCamp, TechniqueScope};
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();

        // Create two camps: the target camp and another camp that owns a scoped technique.
        let target_camp_id = create_camp(
            &db.pool,
            NewCamp {
                student_id,
                coach_id,
                name: "Target camp".to_string(),
                description: None,
            },
        )
        .await
        .unwrap();
        let other_camp_id = create_camp(
            &db.pool,
            NewCamp {
                student_id,
                coach_id,
                name: "Other camp".to_string(),
                description: None,
            },
        )
        .await
        .unwrap();

        // Create a technique scoped to `other_camp` (scoped_camp_id = other_camp).
        let other_scoped_technique_id = create_camp_technique_new(
            &db.pool,
            other_camp_id,
            "Other Camp Only Move",
            "exclusive to other camp",
            TechniqueScope::Scoped,
            coach_id,
        )
        .await
        .unwrap();

        // Attempt to post the other camp's scoped technique to target_camp.
        let result = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::CampTechnique,
                    id: other_scoped_technique_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: Some(target_camp_id),
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "this must be rejected".into(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await;
        assert!(
            result.is_err(),
            "technique scoped to a different camp must be rejected"
        );
    }

    // ---- CampTechnique HTTP route tests ----

    /// Helper: build a client with a coach, two students, and a technique, then
    /// create a camp for `student_user` with the technique attached. Returns the
    /// (client, db, camp_id, technique_id).
    async fn client_with_camp_technique() -> (
        rocket::local::asynchronous::Client,
        crate::test::test_utils::TestDb,
        i64,
        i64,
    ) {
        use crate::db::camps::{create_camp, NewCamp};
        let db = TB::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .student("student2", Some("Mia"))
            .technique("Armbar", "an armbar", Some("coach_user"))
            .build()
            .await
            .unwrap();
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();
        let technique_id = db.technique_id("Armbar").unwrap();
        let camp_id = create_camp(
            &db.pool,
            NewCamp {
                student_id,
                coach_id,
                name: "Own camp".to_string(),
                description: None,
            },
        )
        .await
        .unwrap();
        // No prior camp_techniques insert needed; posting the camp_technique thread is the attach.
        let (client, db) = setup_test_client(db).await;
        (client, db, camp_id, technique_id)
    }

    /// A camp_technique thread is camp-scoped: it must be creatable and listable
    /// under the camp_technique anchor, but must NEVER appear in the global
    /// library technique thread list (anchor_kind='technique').
    #[rocket::async_test]
    async fn camp_technique_thread_not_visible_on_global_technique() {
        let (client, db, camp_id, technique_id) = client_with_camp_technique().await;
        let student_id = db.user_id("student_user").unwrap();

        // (a) Coach creates a camp_technique thread.
        login_test_user(&client, "coach_user", "password123").await;
        let create = client.post("/api/threads").header(ContentType::JSON)
            .body(json!({"anchor_kind":"camp_technique","anchor_id":technique_id,"camp_id":camp_id,"visibility":"private","scope_student_id":student_id,"body":"camp note"}).to_string())
            .dispatch().await;
        assert_eq!(create.status(), HttpStatus::Ok);
        let thread_id = create.into_json::<Value>().await.unwrap()["id"].as_i64().unwrap();

        // (b) The global-library technique list must NOT include it.
        let lib = client
            .get(format!("/api/threads?anchor_kind=technique&anchor_id={technique_id}"))
            .dispatch()
            .await;
        assert_eq!(lib.status(), HttpStatus::Ok);
        let lib_threads = lib.into_json::<Value>().await.unwrap();
        let lib_ids: Vec<i64> = lib_threads["threads"].as_array().unwrap().iter()
            .map(|t| t["id"].as_i64().unwrap()).collect();
        assert!(!lib_ids.contains(&thread_id), "camp_technique thread leaked into the global library list");

        // (c) The camp_technique list MUST include it.
        let camp_list = client
            .get(format!("/api/threads?anchor_kind=camp_technique&anchor_id={technique_id}&camp_id={camp_id}"))
            .dispatch()
            .await;
        assert_eq!(camp_list.status(), HttpStatus::Ok);
        let camp_threads = camp_list.into_json::<Value>().await.unwrap();
        let camp_ids: Vec<i64> = camp_threads["threads"].as_array().unwrap().iter()
            .map(|t| t["id"].as_i64().unwrap()).collect();
        assert!(camp_ids.contains(&thread_id), "camp_technique thread missing from its own camp list");
    }

    /// GET /api/threads/<id> serves a surface that addresses one thread by URL
    /// (a camp's thread page). It must apply the SAME visibility rule the list
    /// does: a private thread scoped to one student is a 404 for another, not a
    /// readable thread just because its id was guessed.
    #[rocket::async_test]
    async fn get_thread_by_id_applies_visibility() {
        let (client, db, camp_id, technique_id) = client_with_camp_technique().await;
        let student_id = db.user_id("student_user").unwrap();

        login_test_user(&client, "coach_user", "password123").await;
        let create = client.post("/api/threads").header(ContentType::JSON)
            .body(json!({"anchor_kind":"camp_technique","anchor_id":technique_id,"camp_id":camp_id,"visibility":"private","scope_student_id":student_id,"body":"camp note"}).to_string())
            .dispatch().await;
        assert_eq!(create.status(), HttpStatus::Ok);
        let thread_id = create.into_json::<Value>().await.unwrap()["id"].as_i64().unwrap();

        // The coach reads it, with its comments.
        let got = client.get(format!("/api/threads/{thread_id}")).dispatch().await;
        assert_eq!(got.status(), HttpStatus::Ok);
        let body = got.into_json::<Value>().await.unwrap();
        assert_eq!(body["id"].as_i64(), Some(thread_id));
        assert_eq!(body["body"].as_str(), Some("camp note"));
        assert!(body["comments"].is_array(), "the by-id read must carry comments");

        // A second student must not.
        sqlx::query(
            "INSERT INTO users (username, role, password, display_name, approved_at, claimed_at)
             SELECT 'other_student', 'student', password, 'Other Student', approved_at, claimed_at
             FROM users WHERE username = 'student_user'",
        )
        .execute(&db.pool)
        .await
        .unwrap();
        login_test_user(&client, "other_student", "password123").await;
        let denied = client.get(format!("/api/threads/{thread_id}")).dispatch().await;
        assert_eq!(denied.status(), HttpStatus::NotFound);

        // A thread that does not exist is a 404 too.
        let missing = client.get("/api/threads/999999").dispatch().await;
        assert_eq!(missing.status(), HttpStatus::NotFound);
    }

    /// A student may start a camp_technique thread on their OWN camp's technique.
    /// It is forced Private + scoped to the camp's student.
    #[rocket::async_test]
    async fn student_can_start_camp_technique_thread_on_own_camp() {
        let (client, db, camp_id, technique_id) = client_with_camp_technique().await;
        let student_id = db.user_id("student_user").unwrap();

        login_test_user(&client, "student_user", "password123").await;
        // Send broadcast + a bogus scope to prove the route forces private+scope.
        let res = client.post("/api/threads").header(ContentType::JSON)
            .body(json!({"anchor_kind":"camp_technique","anchor_id":technique_id,"camp_id":camp_id,"visibility":"broadcast","scope_student_id":null,"body":"my note"}).to_string())
            .dispatch().await;
        assert_eq!(res.status(), HttpStatus::Ok);
        let thread_id = res.into_json::<Value>().await.unwrap()["id"].as_i64().unwrap();

        let (vis, scope, got_camp): (String, i64, i64) = sqlx::query_as(
            "SELECT visibility, scope_student_id, camp_id FROM threads WHERE id = ?",
        )
        .bind(thread_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(vis, "private", "camp_technique threads must be forced private");
        assert_eq!(scope, student_id, "camp_technique thread must be scoped to the camp's student");
        assert_eq!(got_camp, camp_id);
    }

    /// A student must NOT be able to start a camp_technique thread on another
    /// student's camp.
    #[rocket::async_test]
    async fn student_cannot_start_camp_technique_thread_on_another_camp() {
        use crate::db::camps::{create_camp, NewCamp};
        let db = TB::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .student("student2", Some("Mia"))
            .technique("Armbar", "an armbar", Some("coach_user"))
            .build()
            .await
            .unwrap();
        let coach_id = db.user_id("coach_user").unwrap();
        let other_student_id = db.user_id("student2").unwrap();
        let technique_id = db.technique_id("Armbar").unwrap();
        let camp_id = create_camp(
            &db.pool,
            NewCamp {
                student_id: other_student_id,
                coach_id,
                name: "Other camp".to_string(),
                description: None,
            },
        )
        .await
        .unwrap();
        // No prior camp_techniques insert; the route guards by camp.student_id ownership.
        let (client, _db) = setup_test_client(db).await;

        login_test_user(&client, "student_user", "password123").await;
        let res = client.post("/api/threads").header(ContentType::JSON)
            .body(json!({"anchor_kind":"camp_technique","anchor_id":technique_id,"camp_id":camp_id,"visibility":"private","scope_student_id":other_student_id,"body":"intrusion"}).to_string())
            .dispatch().await;
        assert_eq!(res.status(), HttpStatus::Forbidden);
    }

    // ---- Reference-attach tests (P2T2) ----

    /// A reference-attach links the video without reparenting it.
    #[rocket::async_test]
    async fn reference_attach_links_without_reparenting() {
        use crate::db::camps::{create_camp, NewCamp};
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .technique("Armbar", "an armbar", Some("coach_user"))
            .build()
            .await
            .unwrap();
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();
        let _technique_id = db.technique_id("Armbar").unwrap();

        let camp_id = create_camp(
            &db.pool,
            NewCamp { student_id, coach_id, name: "Ref camp".to_string(), description: None },
        )
        .await
        .unwrap();

        // V: a loose video uploaded by the student (visible to them; no syllabus ladder needed).
        let v: i64 = sqlx::query_scalar(
            "INSERT INTO videos (parent_kind, title, kind, processing_status, uploaded_by_id, \
             deleted_at, hidden_at) \
             VALUES ('loose', 'Carry forward clip', 'native', 'ready', ?, NULL, NULL) RETURNING id",
        )
        .bind(student_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let thread_id = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::Camp,
                    id: camp_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "".to_string(),
                attached_video_id: Some(v),
                attached_video_is_reference: true,
                attached_video_title: Some("Carry forward clip".to_string()),
            },
        )
        .await
        .unwrap();

        // V must NOT have been reparented.
        let (pk, tid): (String, Option<i64>) = sqlx::query_as(
            "SELECT parent_kind, thread_id FROM videos WHERE id = ?",
        )
        .bind(v)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(pk, "loose", "video must NOT be reparented on a reference attach");
        assert!(tid.is_none(), "thread_id must remain NULL (not reparented)");

        // Thread must point at V.
        let got_vid: Option<i64> = sqlx::query_scalar(
            "SELECT attached_video_id FROM threads WHERE id = ?",
        )
        .bind(thread_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(got_vid, Some(v), "thread.attached_video_id must equal V");
    }

    /// Reference attach with an empty video title backfills from the provided title;
    /// a video that already has a title is not modified.
    #[rocket::async_test]
    async fn reference_attach_backfills_empty_title() {
        use crate::db::camps::{create_camp, NewCamp};
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();

        let camp_id = create_camp(
            &db.pool,
            NewCamp { student_id, coach_id, name: "Title camp".to_string(), description: None },
        )
        .await
        .unwrap();

        // Video with empty title — should receive "Backfilled Title".
        let v_empty: i64 = sqlx::query_scalar(
            "INSERT INTO videos (parent_kind, title, kind, processing_status, uploaded_by_id, \
             deleted_at, hidden_at) \
             VALUES ('loose', '', 'native', 'ready', ?, NULL, NULL) RETURNING id",
        )
        .bind(student_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Video with an existing title — should remain "Existing Title".
        let v_titled: i64 = sqlx::query_scalar(
            "INSERT INTO videos (parent_kind, title, kind, processing_status, uploaded_by_id, \
             deleted_at, hidden_at) \
             VALUES ('loose', 'Existing Title', 'native', 'ready', ?, NULL, NULL) RETURNING id",
        )
        .bind(student_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Reference-attach the empty-title video with a provided title.
        create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::Camp,
                    id: camp_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "".to_string(),
                attached_video_id: Some(v_empty),
                attached_video_is_reference: true,
                attached_video_title: Some("Backfilled Title".to_string()),
            },
        )
        .await
        .unwrap();

        let got_title: String = sqlx::query_scalar("SELECT title FROM videos WHERE id = ?")
            .bind(v_empty)
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert_eq!(got_title, "Backfilled Title", "empty title must be backfilled");

        // Now create a second camp to attach the pre-titled video.
        let camp2_id = create_camp(
            &db.pool,
            NewCamp { student_id, coach_id, name: "Title camp 2".to_string(), description: None },
        )
        .await
        .unwrap();

        create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::Camp,
                    id: camp2_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "".to_string(),
                attached_video_id: Some(v_titled),
                attached_video_is_reference: true,
                attached_video_title: Some("Should Be Ignored".to_string()),
            },
        )
        .await
        .unwrap();

        let preserved_title: String = sqlx::query_scalar("SELECT title FROM videos WHERE id = ?")
            .bind(v_titled)
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert_eq!(
            preserved_title, "Existing Title",
            "provided title must be ignored when the video already has a title"
        );
    }

    /// Referencing a video not visible to the scope student must be rejected.
    #[rocket::async_test]
    async fn reference_attach_rejects_video_not_visible_to_student() {
        use crate::db::camps::{create_camp, NewCamp};
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

        let camp_id = create_camp(
            &db.pool,
            NewCamp { student_id, coach_id, name: "Gate camp".to_string(), description: None },
        )
        .await
        .unwrap();

        // A private thread video scoped to `other` — student_user cannot see it.
        let thread_for_other = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::Technique,
                    id: technique_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(other_id),
                body: "other's note".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        // Insert a ready video that belongs to a private thread scoped to `other`.
        let coach_only_vid: i64 = sqlx::query_scalar(
            "INSERT INTO videos (parent_kind, thread_id, title, kind, processing_status, \
             uploaded_by_id, deleted_at, hidden_at) \
             VALUES ('thread', ?, 'Coach Only', 'native', 'ready', ?, NULL, NULL) RETURNING id",
        )
        .bind(thread_for_other)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // student_user tries to reference it — must be rejected.
        let result = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::Camp,
                    id: camp_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "".to_string(),
                attached_video_id: Some(coach_only_vid),
                attached_video_is_reference: true,
                attached_video_title: Some("Stolen".to_string()),
            },
        )
        .await;

        assert!(
            result.is_err(),
            "referencing a video not visible to the scope student must be rejected"
        );
    }

    /// POSTing a create-thread with `attached_video_is_reference=true` for a video
    /// that is NOT visible to the camp's scope student must return HTTP 403, not 400.
    #[rocket::async_test]
    async fn reference_attach_hidden_video_returns_forbidden() {
        use crate::db::camps::{create_camp, NewCamp};
        let db = TB::new()
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

        // Camp scoped to student_user.
        let camp_id = create_camp(
            &db.pool,
            NewCamp { student_id, coach_id, name: "Gate camp".to_string(), description: None },
        )
        .await
        .unwrap();

        // A private thread scoped to other_id so its video is NOT visible to student_user.
        let thread_for_other: i64 = sqlx::query_scalar(
            "INSERT INTO threads (created_by_id, anchor_kind, technique_id, visibility, scope_student_id, body) \
             VALUES (?, 'technique', ?, 'private', ?, 'seed') RETURNING id",
        )
        .bind(coach_id)
        .bind(technique_id)
        .bind(other_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // A ready video parented to that thread — invisible to student_user.
        let hidden_vid: i64 = sqlx::query_scalar(
            "INSERT INTO videos (parent_kind, thread_id, title, kind, processing_status, \
             uploaded_by_id, deleted_at, hidden_at) \
             VALUES ('thread', ?, 'Hidden', 'native', 'ready', ?, NULL, NULL) RETURNING id",
        )
        .bind(thread_for_other)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let (client, _db) = setup_test_client(db).await;
        login_test_user(&client, "coach_user", "password123").await;

        // Attempt to reference the hidden video in a thread for student_user's camp.
        let res = client
            .post("/api/threads")
            .header(ContentType::JSON)
            .body(
                json!({
                    "anchor_kind": "camp",
                    "anchor_id": camp_id,
                    "visibility": "private",
                    "scope_student_id": student_id,
                    "body": "",
                    "attached_video_id": hidden_vid,
                    "attached_video_is_reference": true,
                    "attached_video_title": "Stolen"
                })
                .to_string(),
            )
            .dispatch()
            .await;

        assert_eq!(
            res.status(),
            HttpStatus::Forbidden,
            "referencing a video not visible to the scope student must return 403, not 400"
        );
    }

    /// A comment with `video_is_reference=true` referencing a video NOT visible to
    /// the thread's scope student must return HTTP 403.
    #[rocket::async_test]
    async fn reference_attach_comment_hidden_video_returns_forbidden() {
        use crate::db::camps::{create_camp, NewCamp};
        let db = TB::new()
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

        let camp_id = create_camp(
            &db.pool,
            NewCamp { student_id, coach_id, name: "Comment gate".to_string(), description: None },
        )
        .await
        .unwrap();

        // Camp thread to post the comment onto.
        let thread_id: i64 = sqlx::query_scalar(
            "INSERT INTO threads (created_by_id, anchor_kind, camp_id, visibility, scope_student_id, body) \
             VALUES (?, 'camp', ?, 'private', ?, 'root') RETURNING id",
        )
        .bind(coach_id)
        .bind(camp_id)
        .bind(student_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // A video scoped to other_id — invisible to student_user.
        let thread_for_other: i64 = sqlx::query_scalar(
            "INSERT INTO threads (created_by_id, anchor_kind, technique_id, visibility, scope_student_id, body) \
             VALUES (?, 'technique', ?, 'private', ?, 'seed') RETURNING id",
        )
        .bind(coach_id)
        .bind(technique_id)
        .bind(other_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let hidden_vid: i64 = sqlx::query_scalar(
            "INSERT INTO videos (parent_kind, thread_id, title, kind, processing_status, \
             uploaded_by_id, deleted_at, hidden_at) \
             VALUES ('thread', ?, 'Other hidden', 'native', 'ready', ?, NULL, NULL) RETURNING id",
        )
        .bind(thread_for_other)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let (client, _db) = setup_test_client(db).await;
        login_test_user(&client, "coach_user", "password123").await;

        let res = client
            .post(format!("/api/threads/{thread_id}/comments"))
            .header(ContentType::JSON)
            .body(
                json!({
                    "body": "",
                    "video_id": hidden_vid,
                    "video_is_reference": true
                })
                .to_string(),
            )
            .dispatch()
            .await;

        assert_eq!(
            res.status(),
            HttpStatus::Forbidden,
            "comment referencing a video not visible to the scope student must return 403, not 400"
        );
    }

    /// A comment (reply) can reference an existing video without reparenting.
    /// No title is required for replies.
    #[rocket::async_test]
    async fn reference_attach_on_comment_no_reparent() {
        use crate::db::camps::{create_camp, NewCamp};
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();

        let camp_id = create_camp(
            &db.pool,
            NewCamp { student_id, coach_id, name: "Reply ref camp".to_string(), description: None },
        )
        .await
        .unwrap();

        // A camp thread to post the comment onto.
        let thread_id = create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::Camp,
                    id: camp_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "root post".to_string(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        // Existing loose video uploaded by the student (visible to themselves).
        let ref_vid: i64 = sqlx::query_scalar(
            "INSERT INTO videos (parent_kind, title, kind, processing_status, uploaded_by_id, \
             deleted_at, hidden_at) \
             VALUES ('loose', 'My old clip', 'native', 'ready', ?, NULL, NULL) RETURNING id",
        )
        .bind(student_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Post the comment with a reference video (no title required on comments).
        create_comment(
            &db.pool,
            thread_id,
            None,
            coach_id,
            "check this clip",
            Some(ref_vid),
            None,
            true, // video_is_reference
        )
        .await
        .unwrap();

        // The video must NOT have been reparented.
        let (pk, tid): (String, Option<i64>) = sqlx::query_as(
            "SELECT parent_kind, thread_id FROM videos WHERE id = ?",
        )
        .bind(ref_vid)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(pk, "loose", "comment reference attach must not reparent the video");
        assert!(tid.is_none(), "thread_id on the video must remain NULL");
    }
}
