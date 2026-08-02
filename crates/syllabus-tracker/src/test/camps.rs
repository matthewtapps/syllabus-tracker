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

    /// The camp's technique list is what the camp feed tile and the camp
    /// technique page hydrate from, so it MUST include a camp-scoped technique
    /// the global library route deliberately omits. Without this the scoped
    /// technique renders nowhere.
    #[rocket::async_test]
    async fn camp_techniques_route_includes_scoped_technique() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::{ContentType, Status};

        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let student_id = test_db.user_id("student_user").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Camp list test') RETURNING id",
        )
        .bind(student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        login_as(&client, "coach_user").await;

        // A camp-scoped technique (is_global = 0), then the attach that makes it
        // a member of the camp.
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

        let attach = client
            .post("/api/threads")
            .header(ContentType::JSON)
            .body(format!(
                r#"{{"anchor_kind":"camp_technique","anchor_id":{tech_id},"camp_id":{camp_id},"visibility":"private","scope_student_id":{student_id},"body":""}}"#
            ))
            .dispatch()
            .await;
        assert_eq!(attach.status(), Status::Ok);

        let list = client
            .get(format!("/api/camps/{}/techniques", camp_id))
            .dispatch()
            .await;
        assert_eq!(list.status(), Status::Ok);
        let list_body: serde_json::Value =
            serde_json::from_str(&list.into_string().await.unwrap()).unwrap();
        let ids: Vec<i64> = list_body["techniques"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|t| t["id"].as_i64())
            .collect();
        assert!(
            ids.contains(&tech_id),
            "camp technique list must include the camp-scoped technique"
        );

        // A technique that was never attached must NOT appear, or the list is
        // just the library under another name.
        let unattached = db.technique_id("Armbar");
        if let Some(other) = unattached {
            assert!(
                !ids.contains(&other),
                "camp technique list must only hold techniques attached to the camp"
            );
        }
    }

    /// A student may not read another student's camp technique list.
    #[rocket::async_test]
    async fn camp_techniques_route_forbids_other_students() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::Status;

        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let student_id = test_db.user_id("student_user").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        // A SECOND plain student, cloning the seeded student's auth columns so
        // the shared "password123" login works.
        let _other_student_id: i64 = sqlx::query_scalar(
            "INSERT INTO users (username, role, password, display_name, approved_at, claimed_at)
             SELECT 'other_student', 'student', password, 'Other Student', approved_at, claimed_at
             FROM users WHERE username = 'student_user' RETURNING id",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Private camp') RETURNING id",
        )
        .bind(student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        login_as(&client, "other_student").await;
        let resp = client
            .get(format!("/api/camps/{}/techniques", camp_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Forbidden);
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

        // Create a camp_technique thread. Membership is not required to talk
        // about a technique inside a camp.
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

    // -----------------------------------------------------------------------
    // Phase 4: camp search endpoint
    // -----------------------------------------------------------------------

    /// Helper: create a second plain student with the same password as student_user.
    async fn insert_other_student(pool: &sqlx::Pool<sqlx::Sqlite>) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO users (username, role, password, display_name, approved_at, claimed_at)
             SELECT 'other_student', 'student', password, 'Other Student', approved_at, claimed_at
             FROM users WHERE username = 'student_user' RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// Technique search: a camp_technique thread for "Heel Hook" returns in `techniques`.
    #[rocket::async_test]
    async fn camp_search_finds_technique_by_name() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::Status;

        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let student_id = test_db.user_id("student_user").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Search camp') RETURNING id",
        )
        .bind(student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Create a technique and a camp_technique thread for it.
        let technique_id: i64 = sqlx::query_scalar(
            "INSERT INTO techniques (name, description) VALUES ('Heel Hook', 'a heel hook') RETURNING id",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let thread_id: i64 = sqlx::query_scalar(
            "INSERT INTO threads (created_by_id, body, anchor_kind, technique_id, camp_id, visibility, scope_student_id)
             VALUES (?, '', 'camp_technique', ?, ?, 'private', ?) RETURNING id",
        )
        .bind(coach_id)
        .bind(technique_id)
        .bind(camp_id)
        .bind(student_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        login_as(&client, "student_user").await;
        let resp = client
            .get(format!("/api/camps/{}/search?q=heel", camp_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);

        let body: serde_json::Value =
            serde_json::from_str(&resp.into_string().await.unwrap()).unwrap();
        let techniques = body["techniques"].as_array().unwrap();
        assert_eq!(techniques.len(), 1, "expected one technique hit");
        assert_eq!(techniques[0]["thread_id"].as_i64(), Some(thread_id));
        assert_eq!(techniques[0]["technique_id"].as_i64(), Some(technique_id));
        assert_eq!(techniques[0]["technique_name"].as_str(), Some("Heel Hook"));

        // videos and threads must be empty (or missing) when not matched
        let videos = body["videos"].as_array().unwrap();
        assert!(videos.is_empty(), "no video hits expected");
        let threads = body["threads"].as_array().unwrap();
        assert!(threads.is_empty(), "no thread hits expected");
    }

    /// Video search: a camp thread with attached video titled "GI Round 2" returns in `videos`.
    #[rocket::async_test]
    async fn camp_search_finds_video_by_title() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::Status;

        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let student_id = test_db.user_id("student_user").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Vid search camp') RETURNING id",
        )
        .bind(student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Insert a camp thread with an attached video.
        let video_id: i64 = sqlx::query_scalar(
            "INSERT INTO videos (parent_kind, camp_id, title, kind, processing_status, uploaded_by_id)
             VALUES ('camp', ?, 'GI Round 2', 'external', 'ready', ?) RETURNING id",
        )
        .bind(camp_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let thread_id: i64 = sqlx::query_scalar(
            "INSERT INTO threads (created_by_id, body, anchor_kind, camp_id, visibility, scope_student_id, attached_video_id)
             VALUES (?, 'some discussion', 'camp', ?, 'private', ?, ?) RETURNING id",
        )
        .bind(coach_id)
        .bind(camp_id)
        .bind(student_id)
        .bind(video_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        login_as(&client, "student_user").await;
        let resp = client
            .get(format!("/api/camps/{}/search?q=round", camp_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);

        let body: serde_json::Value =
            serde_json::from_str(&resp.into_string().await.unwrap()).unwrap();
        let videos = body["videos"].as_array().unwrap();
        assert_eq!(videos.len(), 1, "expected one video hit");
        assert_eq!(videos[0]["video_id"].as_i64(), Some(video_id));
        assert_eq!(videos[0]["title"].as_str(), Some("GI Round 2"));
        // thread_id should match the owning thread
        assert_eq!(videos[0]["thread_id"].as_i64(), Some(thread_id));
    }

    /// Thread body + comment body search.
    #[rocket::async_test]
    async fn camp_search_finds_thread_and_comment_body() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::Status;

        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let student_id = test_db.user_id("student_user").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Thread search camp') RETURNING id",
        )
        .bind(student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Thread with body "knee slips".
        let thread_id: i64 = sqlx::query_scalar(
            "INSERT INTO threads (created_by_id, body, anchor_kind, camp_id, visibility, scope_student_id)
             VALUES (?, 'knee slips entry', 'camp', ?, 'private', ?) RETURNING id",
        )
        .bind(coach_id)
        .bind(camp_id)
        .bind(student_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Comment with body "my heel".
        let _comment_id: i64 = sqlx::query_scalar(
            "INSERT INTO thread_comments (thread_id, author_id, body) VALUES (?, ?, 'my heel entry') RETURNING id",
        )
        .bind(thread_id)
        .bind(student_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // q=knee should return the thread body match (is_comment=false).
        login_as(&client, "student_user").await;
        let resp = client
            .get(format!("/api/camps/{}/search?q=knee", camp_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);
        let body: serde_json::Value =
            serde_json::from_str(&resp.into_string().await.unwrap()).unwrap();
        let threads = body["threads"].as_array().unwrap();
        assert_eq!(threads.len(), 1, "expected one thread hit for 'knee'");
        assert_eq!(threads[0]["thread_id"].as_i64(), Some(thread_id));
        assert_eq!(threads[0]["is_comment"].as_bool(), Some(false));

        // q=heel should return the comment body match (is_comment=true).
        let resp2 = client
            .get(format!("/api/camps/{}/search?q=heel", camp_id))
            .dispatch()
            .await;
        assert_eq!(resp2.status(), Status::Ok);
        let body2: serde_json::Value =
            serde_json::from_str(&resp2.into_string().await.unwrap()).unwrap();
        let threads2 = body2["threads"].as_array().unwrap();
        assert_eq!(threads2.len(), 1, "expected one thread hit for 'heel' (comment)");
        assert_eq!(threads2[0]["thread_id"].as_i64(), Some(thread_id));
        assert_eq!(threads2[0]["is_comment"].as_bool(), Some(true));
    }

    /// Content in a different camp (same student) does NOT appear in search results.
    #[rocket::async_test]
    async fn camp_search_scoped_to_camp() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::Status;

        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let student_id = test_db.user_id("student_user").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        // Camp A - what we search.
        let camp_a: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Camp A') RETURNING id",
        )
        .bind(student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Camp B - should NOT appear in camp A search.
        let camp_b: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Camp B') RETURNING id",
        )
        .bind(student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Thread in camp B with "unique_text" that we will search in camp A.
        let _thread_b: i64 = sqlx::query_scalar(
            "INSERT INTO threads (created_by_id, body, anchor_kind, camp_id, visibility, scope_student_id)
             VALUES (?, 'unique_text_xyz', 'camp', ?, 'private', ?) RETURNING id",
        )
        .bind(coach_id)
        .bind(camp_b)
        .bind(student_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Search camp A — should find nothing.
        login_as(&client, "student_user").await;
        let resp = client
            .get(format!("/api/camps/{}/search?q=unique_text_xyz", camp_a))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);
        let body: serde_json::Value =
            serde_json::from_str(&resp.into_string().await.unwrap()).unwrap();
        let threads = body["threads"].as_array().unwrap();
        assert!(threads.is_empty(), "thread from camp B must not appear in camp A search");
        let techniques = body["techniques"].as_array().unwrap();
        assert!(techniques.is_empty(), "technique from camp B must not appear in camp A search");
        let videos = body["videos"].as_array().unwrap();
        assert!(videos.is_empty(), "video from camp B must not appear in camp A search");
    }

    /// A student who does not own the camp gets 403.
    #[rocket::async_test]
    async fn camp_search_forbidden_for_other_student() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::Status;

        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        let other_student_id = insert_other_student(&db.pool).await;

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Forbidden camp') RETURNING id",
        )
        .bind(other_student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // student_user (not the camp owner) tries to search.
        login_as(&client, "student_user").await;
        let resp = client
            .get(format!("/api/camps/{}/search?q=anything", camp_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Forbidden, "non-owner student must get 403");
    }

    /// `kind=technique` returns only the techniques group (videos and threads are empty).
    #[rocket::async_test]
    async fn camp_search_kind_filter() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::Status;

        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let student_id = test_db.user_id("student_user").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Kind filter camp') RETURNING id",
        )
        .bind(student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // A technique that matches "guard".
        let technique_id: i64 = sqlx::query_scalar(
            "INSERT INTO techniques (name, description) VALUES ('Guard Pass', '') RETURNING id",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let _thread_id: i64 = sqlx::query_scalar(
            "INSERT INTO threads (created_by_id, body, anchor_kind, technique_id, camp_id, visibility, scope_student_id)
             VALUES (?, '', 'camp_technique', ?, ?, 'private', ?) RETURNING id",
        )
        .bind(coach_id)
        .bind(technique_id)
        .bind(camp_id)
        .bind(student_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // A thread whose body also matches "guard" but must not appear when kind=technique.
        let _thread2_id: i64 = sqlx::query_scalar(
            "INSERT INTO threads (created_by_id, body, anchor_kind, camp_id, visibility, scope_student_id)
             VALUES (?, 'guard drill notes', 'camp', ?, 'private', ?) RETURNING id",
        )
        .bind(coach_id)
        .bind(camp_id)
        .bind(student_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        login_as(&client, "student_user").await;
        let resp = client
            .get(format!("/api/camps/{}/search?q=guard&kind=technique", camp_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);
        let body: serde_json::Value =
            serde_json::from_str(&resp.into_string().await.unwrap()).unwrap();

        let techniques = body["techniques"].as_array().unwrap();
        assert_eq!(techniques.len(), 1, "expected one technique hit");
        assert_eq!(techniques[0]["technique_id"].as_i64(), Some(technique_id));

        // When kind=technique, videos and threads must be empty.
        let videos = body["videos"].as_array().unwrap();
        assert!(videos.is_empty(), "videos must be empty when kind=technique");
        let threads = body["threads"].as_array().unwrap();
        assert!(threads.is_empty(), "threads must be empty when kind=technique");
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

    // -----------------------------------------------------------------------
    // Camp components: the camp's content, one row per component
    // -----------------------------------------------------------------------

    /// Helper: a camp with its owning student and coach.
    async fn camp_fixture() -> (crate::test::test_utils::TestDb, i64, i64, i64) {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .technique("Armbar", "an armbar", Some("coach_user"))
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
                name: "X-guard camp".into(),
                description: None,
            },
        )
        .await
        .unwrap();
        (db, coach, student, camp_id)
    }

    fn coach_viewer(coach: i64) -> crate::db::Viewer {
        crate::db::Viewer { user_id: coach, is_coach: true }
    }

    /// Attaching a technique and then discussing it produces ONE technique
    /// component, hydrated with the technique and its camp discussion.
    #[rocket::async_test]
    async fn camp_components_collapse_a_technique_to_one_row() {
        use crate::db::list_camp_components;

        let (db, coach, student, camp_id) = camp_fixture().await;
        let technique_id = db.technique_id("Armbar").unwrap();

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
        .unwrap();
        create_comment(&db.pool, thread_id, None, student, "Got it.", None, None, false)
            .await
            .unwrap();

        let (components, next) =
            list_camp_components(&db.pool, camp_id, coach_viewer(coach), None, 20)
                .await
                .unwrap();

        assert_eq!(components.len(), 1, "attach + comment is one component");
        assert!(next.is_none(), "a short page has no cursor");
        let c = &components[0];
        assert_eq!(c.kind, "technique");
        assert_eq!(c.id, technique_id);
        assert_eq!(
            c.technique.as_ref().map(|t| t.name.as_str()),
            Some("Armbar"),
            "the technique is hydrated"
        );
        assert_eq!(c.threads.len(), 1, "its camp discussion rides along");
        assert_eq!(c.threads[0].comments.len(), 1);
    }

    /// A camp-owned video is a component even though its upload emits no
    /// activity row.
    #[rocket::async_test]
    async fn camp_components_include_camp_owned_video() {
        use crate::db::list_camp_components;

        let (db, coach, _student, camp_id) = camp_fixture().await;
        let video_id =
            create_processing_video(&db.pool, VideoParent::Camp(camp_id), "Camp clip", None, coach)
                .await
                .unwrap();

        let (components, _) =
            list_camp_components(&db.pool, camp_id, coach_viewer(coach), None, 20)
                .await
                .unwrap();

        assert_eq!(components.len(), 1);
        assert_eq!(components[0].kind, "video");
        assert_eq!(components[0].id, video_id);
        assert_eq!(
            components[0].video.as_ref().map(|v| v.title.as_str()),
            Some("Camp clip")
        );
    }

    /// Attaching is membership, not a post: it starts no thread, and attaching
    /// the same technique again adds neither a second component nor a second
    /// activity row.
    #[rocket::async_test]
    async fn attaching_a_technique_twice_starts_no_thread_and_no_duplicate() {
        use crate::db::camps::attach_camp_techniques;
        use crate::db::list_camp_components;

        let (db, coach, _student, camp_id) = camp_fixture().await;
        let technique_id = db.technique_id("Armbar").unwrap();

        let added = attach_camp_techniques(&db.pool, camp_id, &[technique_id], coach)
            .await
            .unwrap();
        assert_eq!(added, vec![technique_id]);

        let again = attach_camp_techniques(&db.pool, camp_id, &[technique_id], coach)
            .await
            .unwrap();
        assert!(again.is_empty(), "re-attaching adds nothing");

        let threads: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM threads WHERE anchor_kind = 'camp_technique' AND camp_id = ?",
        )
        .bind(camp_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(threads, 0, "attaching starts no discussion");

        let attaches: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM activity WHERE verb = 'camp_technique_added' AND camp_id = ?",
        )
        .bind(camp_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(attaches, 1, "only the attach that landed is announced");

        let (components, _) =
            list_camp_components(&db.pool, camp_id, coach_viewer(coach), None, 20)
                .await
                .unwrap();
        assert_eq!(
            components
                .iter()
                .filter(|c| c.kind == "technique")
                .map(|c| c.id)
                .collect::<Vec<_>>(),
            vec![technique_id],
            "the technique is one component, with no discussion behind it"
        );
    }

    /// A camp's own student may attach; an unrelated student may not.
    #[rocket::async_test]
    async fn attach_technique_route_auth() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::{ContentType, Status};

        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let technique_id = test_db.technique_id("Armbar").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        let other_student_id: i64 = sqlx::query_scalar(
            "INSERT INTO users (username, role, password, display_name, approved_at, claimed_at)
             SELECT 'other_student', 'student', password, 'Other Student', approved_at, claimed_at
             FROM users WHERE username = 'student_user' RETURNING id",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Other camp') RETURNING id",
        )
        .bind(other_student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        login_as(&client, "student_user").await;
        let resp = client
            .post(format!("/api/camps/{}/techniques", camp_id))
            .header(ContentType::JSON)
            .body(format!(r#"{{"technique_ids": [{}]}}"#, technique_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Forbidden, "non-owner student must get 403");

        login_as(&client, "coach_user").await;
        let resp = client
            .post(format!("/api/camps/{}/techniques", camp_id))
            .header(ContentType::JSON)
            .body(format!(r#"{{"technique_ids": [{}]}}"#, technique_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);
    }

    /// Components sort by last touch, so a reply on an older note bumps it back
    /// above a technique attached after it.
    #[rocket::async_test]
    async fn camp_components_order_by_last_touch() {
        use crate::db::list_camp_components;

        let (db, coach, student, camp_id) = camp_fixture().await;
        let technique_id = db.technique_id("Armbar").unwrap();

        let note_id = create_thread(
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
                body: "Camp plan for the week.".into(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();
        let tech_thread_id = create_thread(
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
        .unwrap();

        set_last_activity(&db.pool, note_id, "2026-01-01 10:00:00").await;
        set_last_activity(&db.pool, tech_thread_id, "2026-01-01 11:00:00").await;

        let (components, _) =
            list_camp_components(&db.pool, camp_id, coach_viewer(coach), None, 20)
                .await
                .unwrap();
        assert_eq!(
            components.iter().map(|c| c.kind.as_str()).collect::<Vec<_>>(),
            vec!["technique", "note"],
            "newest touch first"
        );

        set_last_activity(&db.pool, note_id, "2026-01-01 12:00:00").await;
        let (components, _) =
            list_camp_components(&db.pool, camp_id, coach_viewer(coach), None, 20)
                .await
                .unwrap();
        assert_eq!(
            components.iter().map(|c| c.kind.as_str()).collect::<Vec<_>>(),
            vec!["note", "technique"],
            "a reply bumps its component back to the top"
        );
    }

    /// Move a thread's whole footprint (the thread and the activity it emitted)
    /// to `at`, so a test can order touches apart: CURRENT_TIMESTAMP has second
    /// resolution and same-second writes tie.
    async fn set_last_activity(pool: &sqlx::Pool<sqlx::Sqlite>, thread_id: i64, at: &str) {
        sqlx::query("UPDATE threads SET last_activity_at = ? WHERE id = ?")
            .bind(at)
            .bind(thread_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("UPDATE activity SET occurred_at = ? WHERE thread_id = ?")
            .bind(at)
            .bind(thread_id)
            .execute(pool)
            .await
            .unwrap();
    }

    /// The keyset cursor walks the camp without repeating or dropping a
    /// component.
    #[rocket::async_test]
    async fn camp_components_paginate_with_a_cursor() {
        use crate::db::list_camp_components;

        let (db, coach, student, camp_id) = camp_fixture().await;

        let mut note_ids = Vec::new();
        for i in 0..3 {
            let id = create_thread(
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
                    body: format!("Note {i}"),
                    attached_video_id: None,
                    attached_video_is_reference: false,
                    attached_video_title: None,
                },
            )
            .await
            .unwrap();
            set_last_activity(&db.pool, id, &format!("2026-01-0{} 10:00:00", i + 1)).await;
            note_ids.push(id);
        }

        let (first, cursor) =
            list_camp_components(&db.pool, camp_id, coach_viewer(coach), None, 2)
                .await
                .unwrap();
        assert_eq!(first.len(), 2);
        let cursor = cursor.expect("a full page carries a cursor");

        let (second, next) =
            list_camp_components(&db.pool, camp_id, coach_viewer(coach), Some(cursor), 2)
                .await
                .unwrap();
        assert_eq!(second.len(), 1, "the tail is one component");
        assert!(next.is_none(), "the last page has no cursor");

        let seen: Vec<i64> = first.iter().chain(second.iter()).map(|c| c.id).collect();
        assert_eq!(
            seen,
            vec![note_ids[2], note_ids[1], note_ids[0]],
            "every note once, newest first"
        );
    }

    /// GET /api/camps/<id>/components: 200 for the owning student, 403 for
    /// another student.
    #[rocket::async_test]
    async fn camp_components_route_auth_and_shape() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::Status;

        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let student_id = test_db.user_id("student_user").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Camp A') RETURNING id",
        )
        .bind(student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

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
                body: "A note in camp A".into(),
                attached_video_id: None,
                attached_video_is_reference: false,
                attached_video_title: None,
            },
        )
        .await
        .unwrap();

        login_as(&client, "student_user").await;
        let resp = client
            .get(format!("/api/camps/{}/components", camp_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);
        let body: serde_json::Value =
            serde_json::from_str(&resp.into_string().await.unwrap()).unwrap();
        let components = body["components"].as_array().expect("components array");
        assert_eq!(components.len(), 1);
        assert_eq!(components[0]["kind"], "note");
        assert_eq!(components[0]["thread"]["body"], "A note in camp A");
        assert!(body["next_cursor"].is_null());

        // A partial cursor is a client error, not a silently unpaginated page.
        let resp = client
            .get(format!("/api/camps/{}/components?before_ts=2026-01-01", camp_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::BadRequest);

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
            .get(format!("/api/camps/{}/components", camp_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Forbidden);
    }
}
