#[cfg(test)]
mod tests {
    use crate::db::{emit, NewActivity, Verb};
    use crate::db::camps::{archive_camp, create_camp, get_camp, list_camps_for_student, NewCamp};
    use crate::db::threads::{
        create_comment, create_thread, Anchor, AnchorKind, NewThread, ThreadVisibility,
    };
    use crate::db::{create_processing_video, VideoParent};
    use crate::test::test_utils::TestDbBuilder;

    #[rocket::async_test]
    async fn schema_creates_camp_tables() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        // The camps table exists and is empty.
        let camps: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM camps")
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert_eq!(camps, 0);

        // The new parent/anchor columns exist on videos and activity.
        let video_camp_col: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('videos') WHERE name = 'camp_id'",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(video_camp_col, 1);

        let activity_camp_col: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('activity') WHERE name = 'camp_id'",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(activity_camp_col, 1);

        // The threads table also has camp_id.
        let threads_camp_col: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('threads') WHERE name = 'camp_id'",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(threads_camp_col, 1);

        // The camp parent_kind is accepted by the videos CHECK constraint.
        // Insert a camp first, then a video with parent_kind='camp'.
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Test Camp') RETURNING id",
        )
        .bind(student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Insert a camp-owned video to verify the CHECK constraint allows 'camp'.
        let _video_id: i64 = sqlx::query_scalar(
            "INSERT INTO videos (parent_kind, camp_id, title, kind, processing_status, uploaded_by_id)
             VALUES ('camp', ?, 'Test Video', 'external', 'ready', ?)
             RETURNING id",
        )
        .bind(camp_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Insert a camp-anchored thread to verify that CHECK constraint allows 'camp'.
        let _thread_id: i64 = sqlx::query_scalar(
            "INSERT INTO threads (created_by_id, body, anchor_kind, camp_id, visibility, scope_student_id)
             VALUES (?, 'Test thread', 'camp', ?, 'private', ?)
             RETURNING id",
        )
        .bind(coach_id)
        .bind(camp_id)
        .bind(student_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
    }

    #[rocket::async_test]
    async fn competition_and_match_tables_are_gone() {
        use crate::test::test_utils::TestDbBuilder;
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();
        for table in ["competitions", "competition_registrations", "matches", "match_techniques", "camp_referenced_matches"] {
            let count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?",
            ).bind(table).fetch_one(&db.pool).await.unwrap();
            assert_eq!(count, 0, "table {table} should not exist");
        }
        let camp_competition_col: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('camps') WHERE name = 'competition_id'",
        ).fetch_one(&db.pool).await.unwrap();
        assert_eq!(camp_competition_col, 0, "camps.competition_id should be dropped");
        let video_match_col: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('videos') WHERE name = 'match_id'",
        ).fetch_one(&db.pool).await.unwrap();
        assert_eq!(video_match_col, 0, "videos.match_id should be dropped");
    }

    #[rocket::async_test]
    async fn create_video_with_camp_parent() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let student = db.user_id("student_user").unwrap();

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'X-guard prep') RETURNING id",
        )
        .bind(student)
        .bind(coach)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let video_id = create_processing_video(
            &db.pool,
            VideoParent::Camp(camp_id),
            "match 1",
            None,
            coach,
        )
        .await
        .unwrap();

        let (kind, got_camp): (String, i64) =
            sqlx::query_as("SELECT parent_kind, camp_id FROM videos WHERE id = ?")
                .bind(video_id)
                .fetch_one(&db.pool)
                .await
                .unwrap();

        assert_eq!(kind, "camp");
        assert_eq!(got_camp, camp_id);
    }

    #[rocket::async_test]
    async fn camp_thread_is_private_scoped_to_camp_student() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let student = db.user_id("student_user").unwrap();

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'X-guard') RETURNING id",
        )
        .bind(student)
        .bind(coach)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let thread_id = create_thread(
            &db.pool,
            NewThread {
                author_id: coach,
                anchor: Anchor {
                    kind: AnchorKind::Camp,
                    id: camp_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student),
                body: "How's the prep going?".into(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        let (vis, scope, got_camp): (String, i64, i64) = sqlx::query_as(
            "SELECT visibility, scope_student_id, camp_id FROM threads WHERE id = ?",
        )
        .bind(thread_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        assert_eq!(vis, "private");
        assert_eq!(scope, student);
        assert_eq!(got_camp, camp_id);
    }

    #[rocket::async_test]
    async fn camp_created_activity_targets_camp_student() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let student = db.user_id("student_user").unwrap();

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'X-guard') RETURNING id",
        )
        .bind(student)
        .bind(coach)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let mut tx = db.pool.begin().await.unwrap();
        emit(
            &mut tx,
            NewActivity::new(Verb::CampCreated, coach)
                .target_student(student)
                .camp(camp_id)
                .context_kind("camp"),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let (verb, target, got_camp, ctx): (String, i64, i64, String) = sqlx::query_as(
            "SELECT verb, target_student_id, camp_id, context_kind FROM activity ORDER BY id DESC LIMIT 1",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();

        assert_eq!(verb, "camp_created");
        assert_eq!(target, student);
        assert_eq!(got_camp, camp_id);
        assert_eq!(ctx, "camp");
    }

    #[rocket::async_test]
    async fn camp_thread_activity_has_camp_context() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let student = db.user_id("student_user").unwrap();

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'X-guard') RETURNING id",
        )
        .bind(student)
        .bind(coach)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let _thread_id = create_thread(
            &db.pool,
            NewThread {
                author_id: coach,
                anchor: Anchor {
                    kind: AnchorKind::Camp,
                    id: camp_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student),
                body: "Camp prep thread".into(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        let (verb, target, got_camp, ctx): (String, i64, i64, String) = sqlx::query_as(
            "SELECT verb, target_student_id, camp_id, context_kind FROM activity ORDER BY id DESC LIMIT 1",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();

        assert_eq!(verb, "thread_comment_posted");
        assert_eq!(target, student);
        assert_eq!(got_camp, camp_id);
        assert_eq!(ctx, "camp");
    }

    #[rocket::async_test]
    async fn camp_thread_reply_activity_has_camp_context() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let student = db.user_id("student_user").unwrap();

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'X-guard') RETURNING id",
        )
        .bind(student)
        .bind(coach)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let thread_id = create_thread(
            &db.pool,
            NewThread {
                author_id: coach,
                anchor: Anchor {
                    kind: AnchorKind::Camp,
                    id: camp_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student),
                body: "How's prep?".into(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        // A reply (create_comment) must carry the same camp deep-link context as
        // the root post, or the feed notification for the reply is un-clickable.
        create_comment(&db.pool, thread_id, None, student, "Going well", None, None, false)
            .await
            .unwrap();

        let (verb, target, got_camp, ctx): (String, i64, i64, String) = sqlx::query_as(
            "SELECT verb, target_student_id, camp_id, context_kind FROM activity \
             ORDER BY id DESC LIMIT 1",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();

        assert_eq!(verb, "thread_comment_posted");
        assert_eq!(target, student);
        assert_eq!(got_camp, camp_id);
        assert_eq!(ctx, "camp");
    }

    // -----------------------------------------------------------------------
    // HTTP-level tests (Task 6)
    // -----------------------------------------------------------------------

    async fn login_as(client: &rocket::local::asynchronous::Client, username: &str) {
        let _ = crate::test::test_utils::login_test_user(client, username, "password123").await;
    }

    #[rocket::async_test]
    async fn coach_creates_camp_student_cannot() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::{ContentType, Status};

        let test_db = create_standard_test_db().await;
        // student_user is the third inserted user (admin=1, coach=2, student=3).
        let student_id = test_db.user_id("student_user").unwrap();
        let (client, _db) = setup_test_client(test_db).await;

        // Coach can create.
        login_as(&client, "coach_user").await;
        let resp = client
            .post("/api/camps")
            .header(ContentType::JSON)
            .body(format!(
                r#"{{"student_id": {}, "name": "Worlds prep", "description": null}}"#,
                student_id
            ))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);

        // Student cannot create.
        login_as(&client, "student_user").await;
        let resp = client
            .post("/api/camps")
            .header(ContentType::JSON)
            .body(format!(
                r#"{{"student_id": {}, "name": "sneaky", "description": null}}"#,
                student_id
            ))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Forbidden);
    }

    #[rocket::async_test]
    async fn coach_uploads_video_to_camp() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::Status;

        const BOUNDARY: &str = "----testboundarycamp";

        fn multipart_body(file_bytes: &[u8], filename: &str, title: &str) -> Vec<u8> {
            let mut body = Vec::new();
            body.extend_from_slice(format!("--{}\r\n", BOUNDARY).as_bytes());
            body.extend_from_slice(
                format!(
                    "Content-Disposition: form-data; name=\"file\"; filename=\"{}\"\r\n",
                    filename
                )
                .as_bytes(),
            );
            body.extend_from_slice(b"Content-Type: video/mp4\r\n\r\n");
            body.extend_from_slice(file_bytes);
            body.extend_from_slice(b"\r\n");
            body.extend_from_slice(format!("--{}\r\n", BOUNDARY).as_bytes());
            body.extend_from_slice(b"Content-Disposition: form-data; name=\"title\"\r\n\r\n");
            body.extend_from_slice(title.as_bytes());
            body.extend_from_slice(b"\r\n");
            body.extend_from_slice(format!("--{}--\r\n", BOUNDARY).as_bytes());
            body
        }

        fn multipart_ct() -> rocket::http::ContentType {
            rocket::http::ContentType::parse_flexible(&format!(
                "multipart/form-data; boundary={}",
                BOUNDARY
            ))
            .expect("multipart content type")
        }

        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let student_id = test_db.user_id("student_user").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        // Create a camp via DB.
        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Upload test camp') RETURNING id",
        )
        .bind(student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        login_as(&client, "coach_user").await;

        let body = multipart_body(b"fake-mp4-bytes", "clip.mp4", "Camp Clip");
        let resp = client
            .post(format!("/api/camps/{}/videos/upload", camp_id))
            .header(multipart_ct())
            .body(body)
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);

        let parsed: serde_json::Value =
            serde_json::from_str(&resp.into_string().await.unwrap()).unwrap();
        let video_id = parsed["video_id"].as_i64().unwrap();

        // Verify the video row has parent_kind='camp' and camp_id set.
        let (kind, got_camp): (String, i64) = sqlx::query_as(
            "SELECT parent_kind, camp_id FROM videos WHERE id = ?",
        )
        .bind(video_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(kind, "camp");
        assert_eq!(got_camp, camp_id);
    }

    #[rocket::async_test]
    async fn student_uploads_video_to_own_camp() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::Status;

        const BOUNDARY: &str = "----testboundarycampstudent";

        fn multipart_body(file_bytes: &[u8], filename: &str, title: &str) -> Vec<u8> {
            let mut body = Vec::new();
            body.extend_from_slice(format!("--{}\r\n", BOUNDARY).as_bytes());
            body.extend_from_slice(
                format!(
                    "Content-Disposition: form-data; name=\"file\"; filename=\"{}\"\r\n",
                    filename
                )
                .as_bytes(),
            );
            body.extend_from_slice(b"Content-Type: video/mp4\r\n\r\n");
            body.extend_from_slice(file_bytes);
            body.extend_from_slice(b"\r\n");
            body.extend_from_slice(format!("--{}\r\n", BOUNDARY).as_bytes());
            body.extend_from_slice(b"Content-Disposition: form-data; name=\"title\"\r\n\r\n");
            body.extend_from_slice(title.as_bytes());
            body.extend_from_slice(b"\r\n");
            body.extend_from_slice(format!("--{}--\r\n", BOUNDARY).as_bytes());
            body
        }

        fn multipart_ct() -> rocket::http::ContentType {
            rocket::http::ContentType::parse_flexible(&format!(
                "multipart/form-data; boundary={}",
                BOUNDARY
            ))
            .expect("multipart content type")
        }

        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let student_id = test_db.user_id("student_user").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        // Coach creates a camp owned by student_user.
        let camp_id = create_camp(
            &db.pool,
            NewCamp {
                student_id,
                coach_id,
                name: "My footage camp".to_string(),
                description: None,
            },
        )
        .await
        .unwrap();

        // The camp's own student uploads footage directly.
        login_as(&client, "student_user").await;

        let body = multipart_body(b"fake-mp4-bytes", "clip.mp4", "Student Clip");
        let resp = client
            .post(format!("/api/camps/{}/videos/upload", camp_id))
            .header(multipart_ct())
            .body(body)
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);

        let parsed: serde_json::Value =
            serde_json::from_str(&resp.into_string().await.unwrap()).unwrap();
        let video_id = parsed["video_id"].as_i64().unwrap();

        let (kind, got_camp): (String, i64) =
            sqlx::query_as("SELECT parent_kind, camp_id FROM videos WHERE id = ?")
                .bind(video_id)
                .fetch_one(&db.pool)
                .await
                .unwrap();
        assert_eq!(kind, "camp");
        assert_eq!(got_camp, camp_id);
    }

    #[rocket::async_test]
    async fn student_cannot_upload_to_another_students_camp() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::Status;

        const BOUNDARY: &str = "----testboundarycampotherstudent";

        fn multipart_body(file_bytes: &[u8], filename: &str, title: &str) -> Vec<u8> {
            let mut body = Vec::new();
            body.extend_from_slice(format!("--{}\r\n", BOUNDARY).as_bytes());
            body.extend_from_slice(
                format!(
                    "Content-Disposition: form-data; name=\"file\"; filename=\"{}\"\r\n",
                    filename
                )
                .as_bytes(),
            );
            body.extend_from_slice(b"Content-Type: video/mp4\r\n\r\n");
            body.extend_from_slice(file_bytes);
            body.extend_from_slice(b"\r\n");
            body.extend_from_slice(format!("--{}\r\n", BOUNDARY).as_bytes());
            body.extend_from_slice(b"Content-Disposition: form-data; name=\"title\"\r\n\r\n");
            body.extend_from_slice(title.as_bytes());
            body.extend_from_slice(b"\r\n");
            body.extend_from_slice(format!("--{}--\r\n", BOUNDARY).as_bytes());
            body
        }

        fn multipart_ct() -> rocket::http::ContentType {
            rocket::http::ContentType::parse_flexible(&format!(
                "multipart/form-data; boundary={}",
                BOUNDARY
            ))
            .expect("multipart content type")
        }

        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        // Create a SECOND plain student who will own the camp. Clone the seeded
        // student's auth columns so the shared "password123" login works.
        let other_student_id: i64 = sqlx::query_scalar(
            "INSERT INTO users (username, role, password, display_name, approved_at, claimed_at)
             SELECT 'other_student', 'student', password, 'Other Student', approved_at, claimed_at
             FROM users WHERE username = 'student_user' RETURNING id",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Camp belongs to other_student, NOT student_user.
        let camp_id = create_camp(
            &db.pool,
            NewCamp {
                student_id: other_student_id,
                coach_id,
                name: "Not your camp".to_string(),
                description: None,
            },
        )
        .await
        .unwrap();

        // student_user tries to upload to a camp they don't own.
        login_as(&client, "student_user").await;

        let body = multipart_body(b"fake-mp4-bytes", "clip.mp4", "Sneaky Clip");
        let resp = client
            .post(format!("/api/camps/{}/videos/upload", camp_id))
            .header(multipart_ct())
            .body(body)
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Forbidden);
    }

    #[rocket::async_test]
    async fn list_camp_videos_returns_camp_owned_videos_with_camp_id() {
        use crate::db::list_videos_for_camp;

        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let student = db.user_id("student_user").unwrap();

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Video test camp') RETURNING id",
        )
        .bind(student)
        .bind(coach)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let video_id = create_processing_video(
            &db.pool,
            VideoParent::Camp(camp_id),
            "Camp clip 1",
            None,
            coach,
        )
        .await
        .unwrap();

        let videos = list_videos_for_camp(&db.pool, camp_id).await.unwrap();
        // processing videos are not hidden, so they appear in the list
        assert_eq!(videos.len(), 1);
        assert_eq!(videos[0].id, video_id);
        assert_eq!(videos[0].camp_id, Some(camp_id));
        assert_eq!(videos[0].parent_kind, "camp");
    }

    #[rocket::async_test]
    async fn get_camp_videos_route_coach_and_owner_can_read_other_student_gets_403() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::Status;

        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let student_id = test_db.user_id("student_user").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Route auth test') RETURNING id",
        )
        .bind(student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Coach can read camp videos.
        login_as(&client, "coach_user").await;
        let resp = client
            .get(format!("/api/camps/{}/videos", camp_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);
        let body: serde_json::Value =
            serde_json::from_str(&resp.into_string().await.unwrap()).unwrap();
        assert!(body["videos"].is_array());

        // Camp student (owner) can read.
        login_as(&client, "student_user").await;
        let resp = client
            .get(format!("/api/camps/{}/videos", camp_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);

        // admin_user is role=admin in the standard DB, not a plain student.
        // Use admin_user (coach-level perms) to verify it also gets 200.
        login_as(&client, "admin_user").await;
        let resp = client
            .get(format!("/api/camps/{}/videos", camp_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);

        // A DIFFERENT plain student must NOT be able to read this camp's videos.
        // Clone the seeded student's auth columns so the shared "password123"
        // login works for the new user.
        sqlx::query(
            "INSERT INTO users (username, role, password, display_name, approved_at, claimed_at)
             SELECT 'other_student', 'student', password, 'Other Student', approved_at, claimed_at
             FROM users WHERE username = 'student_user'",
        )
        .execute(&db.pool)
        .await
        .unwrap();
        login_as(&client, "other_student").await;
        let resp = client
            .get(format!("/api/camps/{}/videos", camp_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Forbidden);
    }

    #[rocket::async_test]
    async fn camp_create_and_archive() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let student = db.user_id("student_user").unwrap();

        let camp_id = create_camp(
            &db.pool,
            NewCamp {
                student_id: student,
                coach_id: coach,
                name: "Worlds prep".into(),
                description: Some("focus".into()),
            },
        )
        .await
        .unwrap();

        let camp = get_camp(&db.pool, camp_id).await.unwrap().unwrap();
        assert_eq!(camp.name, "Worlds prep");
        assert!(camp.archived_at.is_none());

        archive_camp(&db.pool, camp_id, coach).await.unwrap();
        assert!(get_camp(&db.pool, camp_id).await.unwrap().unwrap().archived_at.is_some());

        let listed = list_camps_for_student(&db.pool, student, true).await.unwrap();
        assert_eq!(listed.len(), 1);
    }

    // -----------------------------------------------------------------------
    // CC-015: per-camp video visibility override tests
    // -----------------------------------------------------------------------

    /// Camp-scope `visible=0` hides a video from `list_videos_for_camp`
    /// but does NOT affect the same video in the library or technique list.
    #[rocket::async_test]
    async fn camp_visibility_override_hides_video_from_camp_list_only() {
        use crate::db::{
            create_processing_video, VideoParent,
            list_videos_for_camp, list_videos_for_technique,
            set_video_camp_visibility,
        };

        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let student = db.user_id("student_user").unwrap();

        // Create a technique and a camp.
        let technique_id: i64 = sqlx::query_scalar(
            "INSERT INTO techniques (name, description) VALUES ('Armbar', '') RETURNING id",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Worlds prep') RETURNING id",
        )
        .bind(student)
        .bind(coach)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Video owned by the camp.
        let camp_video_id = create_processing_video(
            &db.pool,
            VideoParent::Camp(camp_id),
            "No-gi variation",
            None,
            coach,
        )
        .await
        .unwrap();

        // Video owned by the technique (appears in library, not the camp list).
        let _technique_video_id = create_processing_video(
            &db.pool,
            VideoParent::Technique(technique_id),
            "Gi variation",
            None,
            coach,
        )
        .await
        .unwrap();

        // Before any override both lists are visible.
        let camp_videos = list_videos_for_camp(&db.pool, camp_id).await.unwrap();
        assert_eq!(camp_videos.len(), 1, "camp video visible before override");

        let technique_videos = list_videos_for_technique(&db.pool, technique_id).await.unwrap();
        assert_eq!(technique_videos.len(), 1, "technique video visible");

        // Coach hides the camp video within this camp.
        set_video_camp_visibility(&db.pool, camp_video_id, camp_id, false, coach)
            .await
            .unwrap();

        // The camp list should now be empty for a student view.
        let camp_videos_after = list_videos_for_camp(&db.pool, camp_id).await.unwrap();
        assert_eq!(camp_videos_after.len(), 0, "camp video hidden from camp list after override");

        // The technique video in the library is unaffected.
        let technique_videos_after = list_videos_for_technique(&db.pool, technique_id).await.unwrap();
        assert_eq!(technique_videos_after.len(), 1, "technique video unaffected by camp override");

        // The override row must be scoped to 'camp', not 'student' / global.
        let override_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM video_visibility_overrides WHERE scope_kind = 'camp' AND camp_id = ? AND video_id = ? AND visible = 0",
        )
        .bind(camp_id)
        .bind(camp_video_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(override_count, 1, "exactly one camp-scope override row");

        // Global student-scope overrides must NOT have been created.
        let student_override_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM video_visibility_overrides WHERE scope_kind = 'student' AND video_id = ?",
        )
        .bind(camp_video_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(student_override_count, 0, "no student-scope override leaked");
    }

    /// A camp-scope `visible=1` override force-shows a globally-hidden video
    /// in the camp list.
    #[rocket::async_test]
    async fn camp_visibility_override_force_shows_globally_hidden_video() {
        use crate::db::{
            create_processing_video, VideoParent,
            list_videos_for_camp, set_video_hidden_globally,
            set_video_camp_visibility,
        };

        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let student = db.user_id("student_user").unwrap();

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Force-show test') RETURNING id",
        )
        .bind(student)
        .bind(coach)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let video_id = create_processing_video(
            &db.pool,
            VideoParent::Camp(camp_id),
            "Hidden clip",
            None,
            coach,
        )
        .await
        .unwrap();

        // Globally hide the video.
        set_video_hidden_globally(&db.pool, video_id, true, coach).await.unwrap();

        // Without override the camp list is empty.
        let before = list_videos_for_camp(&db.pool, camp_id).await.unwrap();
        assert_eq!(before.len(), 0, "globally hidden video absent from camp list");

        // Coach adds a camp-scope force-show.
        set_video_camp_visibility(&db.pool, video_id, camp_id, true, coach)
            .await
            .unwrap();

        // Now it appears in the camp list.
        let after = list_videos_for_camp(&db.pool, camp_id).await.unwrap();
        assert_eq!(after.len(), 1, "force-shown video appears in camp list");
    }

    /// Non-coach (student) gets 403 on the visibility route.
    #[rocket::async_test]
    async fn camp_video_visibility_route_rejects_student() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::{ContentType, Status};

        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let student_id = test_db.user_id("student_user").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Auth test') RETURNING id",
        )
        .bind(student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let video_id: i64 = sqlx::query_scalar(
            "INSERT INTO videos (parent_kind, camp_id, title, kind, processing_status, uploaded_by_id) \
             VALUES ('camp', ?, 'test', 'external', 'ready', ?) RETURNING id",
        )
        .bind(camp_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Student cannot set camp video visibility.
        login_as(&client, "student_user").await;
        let resp = client
            .put(format!("/api/camps/{}/videos/{}/visibility", camp_id, video_id))
            .header(ContentType::JSON)
            .body(r#"{"visible": false}"#)
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Forbidden);
    }

    /// Coach gets 204 on the visibility route.
    #[rocket::async_test]
    async fn camp_video_visibility_route_coach_gets_204() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::{ContentType, Status};

        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let student_id = test_db.user_id("student_user").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Coach test') RETURNING id",
        )
        .bind(student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let video_id: i64 = sqlx::query_scalar(
            "INSERT INTO videos (parent_kind, camp_id, title, kind, processing_status, uploaded_by_id) \
             VALUES ('camp', ?, 'clip', 'external', 'ready', ?) RETURNING id",
        )
        .bind(camp_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        login_as(&client, "coach_user").await;
        let resp = client
            .put(format!("/api/camps/{}/videos/{}/visibility", camp_id, video_id))
            .header(ContentType::JSON)
            .body(r#"{"visible": false}"#)
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::NoContent);

        // Verify the override row was created.
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM video_visibility_overrides \
             WHERE scope_kind='camp' AND camp_id=? AND video_id=? AND visible=0",
        )
        .bind(camp_id)
        .bind(video_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(count, 1);
    }

    // -----------------------------------------------------------------------
    // CC-009/010: create-in-camp technique (global vs scoped)
    // -----------------------------------------------------------------------

    /// A scoped technique appears in the camp technique list but NOT in the
    /// global library list (`list_library_techniques`) and NOT in the
    /// assignable-techniques list for a student.
    #[rocket::async_test]
    async fn scoped_technique_not_in_library_or_assignable() {
        use crate::db::camps::{create_camp_technique_new, TechniqueScope};
        use crate::db::{list_library_techniques, get_unassigned_techniques};

        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let student = db.user_id("student_user").unwrap();

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Scoped test') RETURNING id",
        )
        .bind(student)
        .bind(coach)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Create a scoped technique inside this camp.
        let tech_id = create_camp_technique_new(
            &db.pool,
            camp_id,
            "Camp-only guard drill",
            "Only for this camp",
            TechniqueScope::Scoped,
            coach,
        )
        .await
        .unwrap();

        // It must NOT appear in the global library list.
        let library = list_library_techniques(&db.pool).await.unwrap();
        assert!(
            !library.iter().any(|t| t.id == tech_id),
            "scoped technique must not appear in the global library"
        );

        // It must NOT appear in the assignable (unassigned) list for a student.
        let assignable = get_unassigned_techniques(&db.pool, student).await.unwrap();
        assert!(
            !assignable.iter().any(|t| t.id == tech_id),
            "scoped technique must not appear in the assignable list"
        );

        // Verify DB invariant: is_global=0 AND scoped_camp_id=camp_id.
        let (is_global, scoped_camp_id): (i64, i64) = sqlx::query_as(
            "SELECT is_global, scoped_camp_id FROM techniques WHERE id = ?",
        )
        .bind(tech_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(is_global, 0, "scoped technique must have is_global=0");
        assert_eq!(scoped_camp_id, camp_id, "scoped_camp_id must equal the camp");
    }

    /// `POST /api/camps/<id>/techniques/create` returns 403 for a student
    /// and 200 for a coach (global scope).
    #[rocket::async_test]
    async fn create_camp_technique_route_auth() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::{ContentType, Status};

        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let student_id = test_db.user_id("student_user").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Auth test') RETURNING id",
        )
        .bind(student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Student cannot create.
        login_as(&client, "student_user").await;
        let resp = client
            .post(format!("/api/camps/{}/techniques/create", camp_id))
            .header(ContentType::JSON)
            .body(r#"{"name":"Guard","description":"test","scope":"global"}"#)
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Forbidden);

        // Coach can create a global technique.
        login_as(&client, "coach_user").await;
        let resp = client
            .post(format!("/api/camps/{}/techniques/create", camp_id))
            .header(ContentType::JSON)
            .body(r#"{"name":"Guard","description":"test","scope":"global"}"#)
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);
        let body: serde_json::Value =
            serde_json::from_str(&resp.into_string().await.unwrap()).unwrap();
        assert!(body["id"].as_i64().unwrap() > 0, "route must return an id");
    }

    // -----------------------------------------------------------------------
    // Task 1: enriched camp-summary list query
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn camp_summary_carries_video_count_and_last_activity() {
        use crate::db::camps::{create_camp, list_camp_summaries_for_student, NewCamp};
        use crate::db::{create_processing_video, VideoParent};

        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let student = db.user_id("student_user").unwrap();

        let camp_id = create_camp(
            &db.pool,
            NewCamp {
                student_id: student,
                coach_id: coach,
                name: "Worlds prep".into(),
                description: None,
            },
        )
        .await
        .unwrap();

        // Add one camp-owned video.
        create_processing_video(
            &db.pool,
            VideoParent::Camp(camp_id),
            "Worlds prep clip",
            None,
            coach,
        )
        .await
        .unwrap();

        // create_camp already emitted a CampCreated activity row (camp_id is set),
        // so last_activity_at will be Some.

        let summaries = list_camp_summaries_for_student(&db.pool, student, true)
            .await
            .unwrap();
        assert_eq!(summaries.len(), 1);
        let s = &summaries[0];

        assert_eq!(s.video_count, 1);
        assert!(s.last_activity_at.is_some());
    }

    /// `POST /api/camps/<id>/techniques/create` with `scope=scoped` creates a
    /// camp-only technique that is absent from the library route.
    #[rocket::async_test]
    async fn create_camp_technique_route_scoped_not_in_library() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::{ContentType, Status};

        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let student_id = test_db.user_id("student_user").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Scoped route test') RETURNING id",
        )
        .bind(student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        login_as(&client, "coach_user").await;
        let resp = client
            .post(format!("/api/camps/{}/techniques/create", camp_id))
            .header(ContentType::JSON)
            .body(r#"{"name":"Camp-only choke","description":"only here","scope":"scoped"}"#)
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);
        let body: serde_json::Value =
            serde_json::from_str(&resp.into_string().await.unwrap()).unwrap();
        let tech_id = body["id"].as_i64().unwrap();

        // Global library must NOT include the technique.
        let library_resp = client
            .get("/api/techniques")
            .dispatch()
            .await;
        assert_eq!(library_resp.status(), Status::Ok);
        let library_body: serde_json::Value =
            serde_json::from_str(&library_resp.into_string().await.unwrap()).unwrap();
        let library_ids: Vec<i64> = library_body
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|t| t["id"].as_i64())
            .collect();
        assert!(
            !library_ids.contains(&tech_id),
            "scoped technique must not appear in the global library route"
        );

        // Verify DB: is_global=0, scoped_camp_id=camp_id.
        let (is_global, scoped_camp_id): (i64, i64) = sqlx::query_as(
            "SELECT is_global, scoped_camp_id FROM techniques WHERE id = ?",
        )
        .bind(tech_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(is_global, 0);
        assert_eq!(scoped_camp_id, camp_id);
    }

    // -----------------------------------------------------------------------
    // Task 4: camp feed read endpoint
    // -----------------------------------------------------------------------

    /// GET /api/camps/<A>/feed as the owning student returns only activity rows
    /// whose camp_id = A. Rows from camp B are absent.
    #[rocket::async_test]
    async fn camp_feed_returns_only_this_camps_activity() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::Status;

        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let student_id = test_db.user_id("student_user").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        // Create two camps for the same student.
        let camp_a: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Camp A') RETURNING id",
        )
        .bind(student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let camp_b: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Camp B') RETURNING id",
        )
        .bind(student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Create a thread anchored to camp A (emits thread_comment_posted activity
        // with camp_id = camp_a, target_student_id = student_id).
        create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::Camp,
                    id: camp_a,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "Thread in camp A".into(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        // Create a thread anchored to camp B.
        create_thread(
            &db.pool,
            NewThread {
                author_id: coach_id,
                anchor: Anchor {
                    kind: AnchorKind::Camp,
                    id: camp_b,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student_id),
                body: "Thread in camp B".into(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        // GET the camp A feed as the owning student.
        login_as(&client, "student_user").await;
        let resp = client
            .get(format!("/api/camps/{}/feed", camp_a))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok, "camp feed must return 200");

        let body: serde_json::Value =
            serde_json::from_str(&resp.into_string().await.unwrap()).unwrap();
        let items = body.as_array().expect("response must be an array");

        // Every returned item must belong to camp A.
        assert!(!items.is_empty(), "camp A feed must not be empty");
        for item in items {
            let got_camp_id = item["camp_id"].as_i64();
            assert_eq!(
                got_camp_id,
                Some(camp_a),
                "feed item camp_id must equal camp A; got {:?}",
                got_camp_id
            );
        }
    }

    /// GET /api/camps/<id>/feed as a student who does NOT own the camp returns
    /// 403 Forbidden.
    #[rocket::async_test]
    async fn camp_feed_forbidden_for_other_student() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::Status;

        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        // Create a second student who will own the camp.
        let other_student_id: i64 = sqlx::query_scalar(
            "INSERT INTO users (username, role, password, display_name, approved_at, claimed_at)
             SELECT 'other_student', 'student', password, 'Other Student', approved_at, claimed_at
             FROM users WHERE username = 'student_user' RETURNING id",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let other_camp: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Other camp') RETURNING id",
        )
        .bind(other_student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // student_user (not the owner) tries to read the other student's camp feed.
        login_as(&client, "student_user").await;
        let resp = client
            .get(format!("/api/camps/{}/feed", other_camp))
            .dispatch()
            .await;
        assert_eq!(
            resp.status(),
            Status::Forbidden,
            "non-owner student must get 403"
        );
    }

    /// GET /api/camps/<id>/feed as the COACH who created the camp returns 200
    /// and includes the coach's own authored thread row.
    #[rocket::async_test]
    async fn camp_feed_accessible_to_coach_and_includes_coach_authored_rows() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::Status;

        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let student_id = test_db.user_id("student_user").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        // Create a camp for the standard student.
        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Coach View Camp') RETURNING id",
        )
        .bind(student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Coach posts a thread anchored to this camp.
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
                body: "Coach thread in camp".into(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        // GET the camp feed logged in as the COACH.
        login_as(&client, "coach_user").await;
        let resp = client
            .get(format!("/api/camps/{}/feed", camp_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok, "coach must get 200 for camp feed");

        let body: serde_json::Value =
            serde_json::from_str(&resp.into_string().await.unwrap()).unwrap();
        let items = body.as_array().expect("response must be an array");

        assert!(!items.is_empty(), "coach camp feed must not be empty");

        // The coach-authored thread must appear in the feed.
        let has_coach_row = items.iter().any(|item| {
            item["actor_user_id"].as_i64() == Some(coach_id)
                && item["thread_id"].as_i64() == Some(thread_id)
        });
        assert!(
            has_coach_row,
            "coach camp feed must contain the coach-authored thread (coach_id={coach_id}, thread_id={thread_id}); got: {items:?}"
        );
    }

    // -----------------------------------------------------------------------
    // camp_technique thread activity: technique_id is carried so the feed can
    // render the technique card (context_kind="camp" disambiguates it from a
    // plain library technique thread).
    // -----------------------------------------------------------------------

    // (tests for removed camp_technique_referenced_videos routes deleted here)

    // -----------------------------------------------------------------------
    // camp_technique thread activity: technique_id is carried so the feed can
    // render the technique card (context_kind="camp" disambiguates it from a
    // plain library technique thread).
    // -----------------------------------------------------------------------

    /// A camp_technique thread's activity row must carry both technique_id and
    /// camp_id, with context_kind="camp". A plain camp thread must have
    /// technique_id IS NULL (the two kinds must stay distinct).
    #[rocket::async_test]
    async fn camp_technique_thread_activity_carries_technique_and_camp() {
        use crate::db::camps::{create_camp, NewCamp};

        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .technique("Armbar", "an armbar", Some("coach_user"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let student = db.user_id("student_user").unwrap();
        let technique_id = db.technique_id("Armbar").unwrap();

        let camp_id = create_camp(
            &db.pool,
            NewCamp {
                student_id: student,
                coach_id: coach,
                name: "X-guard camp".into(),
                description: None,
            },
        )
        .await
        .unwrap();

        // In the new model, posting the camp_technique thread is the attach step.
        // No prior camp_techniques membership is required.

        // Create a camp_technique thread.
        let camp_tech_thread_id = create_thread(
            &db.pool,
            NewThread {
                author_id: coach,
                anchor: Anchor {
                    kind: AnchorKind::CampTechnique,
                    id: technique_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: Some(camp_id),
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student),
                body: "Work on this grip entry.".into(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        // Assert: activity row for the camp_technique thread carries both ids.
        use sqlx::Row;
        let row = sqlx::query(
            "SELECT technique_id, camp_id, context_kind \
             FROM activity \
             WHERE verb = 'thread_comment_posted' AND thread_id = ?",
        )
        .bind(camp_tech_thread_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let got_technique_id: Option<i64> = row.try_get("technique_id").unwrap();
        let got_camp_id: Option<i64> = row.try_get("camp_id").unwrap();
        let got_context: Option<String> = row.try_get("context_kind").unwrap();

        assert_eq!(
            got_technique_id,
            Some(technique_id),
            "camp_technique thread activity must carry technique_id"
        );
        assert_eq!(
            got_camp_id,
            Some(camp_id),
            "camp_technique thread activity must carry camp_id"
        );
        assert_eq!(
            got_context.as_deref(),
            Some("camp"),
            "camp_technique thread activity must have context_kind='camp'"
        );

        // Guard: a plain camp thread must have technique_id IS NULL so the feed
        // can distinguish the two kinds by (camp_id != null && technique_id != null).
        let camp_thread_id = create_thread(
            &db.pool,
            NewThread {
                author_id: coach,
                anchor: Anchor {
                    kind: AnchorKind::Camp,
                    id: camp_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: None,
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student),
                body: "General camp thread.".into(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        let plain_row = sqlx::query(
            "SELECT technique_id, camp_id \
             FROM activity \
             WHERE verb = 'thread_comment_posted' AND thread_id = ?",
        )
        .bind(camp_thread_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let plain_technique_id: Option<i64> = plain_row.try_get("technique_id").unwrap();
        assert!(
            plain_technique_id.is_none(),
            "plain camp thread activity must have technique_id IS NULL (got {plain_technique_id:?})"
        );
    }

    /// A `camp_technique` thread whose body is empty (and has no attached video)
    /// must succeed — the technique anchor IS the content; no body is required.
    #[rocket::async_test]
    async fn camp_technique_thread_allows_empty_body() {
        use sqlx::Row;
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let student = db.user_id("student_user").unwrap();

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Technique Feed Camp') RETURNING id",
        )
        .bind(student)
        .bind(coach)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Insert a global technique (scoped_camp_id IS NULL) so validate_anchor accepts it.
        let technique_id: i64 = sqlx::query_scalar(
            "INSERT INTO techniques (name, description) VALUES ('Scissor Sweep', '') RETURNING id",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Creating a camp_technique thread with empty body must NOT fail.
        let thread_id = create_thread(
            &db.pool,
            NewThread {
                author_id: coach,
                anchor: Anchor {
                    kind: AnchorKind::CampTechnique,
                    id: technique_id,
                    video_ts_seconds: None,
                    pinned_student_id: None,
                    camp_id: Some(camp_id),
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student),
                body: String::new(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .expect("camp_technique thread with empty body should succeed");

        // The persisted row carries the technique and camp ids.
        let (got_technique_id, got_camp_id): (i64, i64) = sqlx::query_as(
            "SELECT technique_id, camp_id FROM threads WHERE id = ?",
        )
        .bind(thread_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        assert_eq!(got_technique_id, technique_id);
        assert_eq!(got_camp_id, camp_id);

        // The activity row carries technique_id and camp context.
        let act = sqlx::query(
            "SELECT technique_id, camp_id, context_kind \
             FROM activity \
             WHERE verb = 'thread_comment_posted' AND thread_id = ?",
        )
        .bind(thread_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let act_technique_id: i64 = act.try_get("technique_id").unwrap();
        let act_camp_id: i64 = act.try_get("camp_id").unwrap();
        let ctx: String = act.try_get("context_kind").unwrap();
        assert_eq!(act_technique_id, technique_id, "activity must carry technique_id");
        assert_eq!(act_camp_id, camp_id, "activity must carry camp_id");
        assert_eq!(ctx, "camp", "activity context_kind must be 'camp'");
    }
}
