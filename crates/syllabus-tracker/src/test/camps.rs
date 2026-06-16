#[cfg(test)]
mod tests {
    use crate::db::{emit, NewActivity, Verb};
    use crate::db::camps::{
        add_camp_technique, archive_camp, create_camp, get_camp, list_camp_techniques,
        list_camps_for_student, remove_camp_technique, NewCamp,
    };
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

        // Both tables exist and are empty.
        let camps: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM camps")
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert_eq!(camps, 0);

        let camp_techniques: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM camp_techniques")
                .fetch_one(&db.pool)
                .await
                .unwrap();
        assert_eq!(camp_techniques, 0);

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
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student),
                body: "How's the prep going?".into(),
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
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student),
                body: "Camp prep thread".into(),
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
                },
                visibility: ThreadVisibility::Private,
                scope_student_id: Some(student),
                body: "How's prep?".into(),
            },
        )
        .await
        .unwrap();

        // A reply (create_comment) must carry the same camp deep-link context as
        // the root post, or the feed notification for the reply is un-clickable.
        create_comment(&db.pool, thread_id, None, student, "Going well")
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
    async fn camp_technique_reports_tags_and_video_count() {
        use crate::db::{add_tag_to_technique, create_tag, create_technique};

        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let student = db.user_id("student_user").unwrap();

        // Create technique, tag, video and a camp.
        let tech_id =
            create_technique(&db.pool, "guard recovery", "base first", coach, true)
                .await
                .unwrap();

        let tag_id = create_tag(&db.pool, "Defense").await.unwrap();
        add_tag_to_technique(&db.pool, tech_id, tag_id, coach).await.unwrap();

        // A live (not deleted) technique-owned video.
        create_processing_video(
            &db.pool,
            VideoParent::Technique(tech_id),
            "guard drill",
            None,
            coach,
        )
        .await
        .unwrap();

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Tags test camp') RETURNING id",
        )
        .bind(student)
        .bind(coach)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        add_camp_technique(&db.pool, camp_id, tech_id, coach).await.unwrap();

        let techs = list_camp_techniques(&db.pool, camp_id).await.unwrap();
        assert_eq!(techs.len(), 1);
        assert_eq!(techs[0].tags.len(), 1, "expected one tag");
        assert_eq!(techs[0].tags[0].name, "Defense");
        assert_eq!(techs[0].video_count, 1, "expected one alive video");
    }

    #[rocket::async_test]
    async fn camp_crud_roundtrip() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let student = db.user_id("student_user").unwrap();

        // Insert a technique directly (no builder helper for ad-hoc techniques).
        let tech: i64 = sqlx::query_scalar(
            "INSERT INTO techniques (name, description, coach_id) VALUES (?, ?, ?) RETURNING id",
        )
        .bind("single leg x")
        .bind("foot position drill")
        .bind(coach)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let camp_id = create_camp(
            &db.pool,
            NewCamp {
                student_id: student,
                coach_id: coach,
                name: "Worlds prep".into(),
                description: Some("focus".into()),
                references_camp_id: None,
            },
        )
        .await
        .unwrap();

        let camp = get_camp(&db.pool, camp_id).await.unwrap().unwrap();
        assert_eq!(camp.name, "Worlds prep");
        assert!(camp.archived_at.is_none());
        assert!(camp.references_camp_id.is_none());

        add_camp_technique(&db.pool, camp_id, tech, coach).await.unwrap();
        let techs = list_camp_techniques(&db.pool, camp_id).await.unwrap();
        assert_eq!(techs.len(), 1);

        remove_camp_technique(&db.pool, camp_id, tech).await.unwrap();
        assert_eq!(list_camp_techniques(&db.pool, camp_id).await.unwrap().len(), 0);

        archive_camp(&db.pool, camp_id, coach).await.unwrap();
        assert!(get_camp(&db.pool, camp_id).await.unwrap().unwrap().archived_at.is_some());

        let listed = list_camps_for_student(&db.pool, student, true).await.unwrap();
        assert_eq!(listed.len(), 1);
    }

    // -----------------------------------------------------------------------
    // S3-4: next-camp references (builds-on lineage)
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn create_camp_with_references_camp_id_roundtrip() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let student = db.user_id("student_user").unwrap();

        // Create the prior camp (no references_camp_id).
        let prior_id = create_camp(
            &db.pool,
            NewCamp {
                student_id: student,
                coach_id: coach,
                name: "Guard retention".into(),
                description: None,
                references_camp_id: None,
            },
        )
        .await
        .unwrap();

        // Create a new camp that builds on the prior one.
        let next_id = create_camp(
            &db.pool,
            NewCamp {
                student_id: student,
                coach_id: coach,
                name: "Guard retention v2".into(),
                description: None,
                references_camp_id: Some(prior_id),
            },
        )
        .await
        .unwrap();

        let next = get_camp(&db.pool, next_id).await.unwrap().unwrap();
        assert_eq!(next.references_camp_id, Some(prior_id));

        // list_camps_for_student should carry references_camp_id through.
        let camps = list_camps_for_student(&db.pool, student, true)
            .await
            .unwrap();
        let next_listed = camps.iter().find(|c| c.id == next_id).unwrap();
        assert_eq!(next_listed.references_camp_id, Some(prior_id));
    }

    #[rocket::async_test]
    async fn get_camp_via_route_returns_references_camp_name() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::{ContentType, Status};

        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let student_id = test_db.user_id("student_user").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        // Create the prior camp directly.
        let prior_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Prior camp') RETURNING id",
        )
        .bind(student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Login as coach and create the next camp via the API.
        let _ = crate::test::test_utils::login_test_user(&client, "coach_user", "password123").await;
        let resp = client
            .post("/api/camps")
            .header(ContentType::JSON)
            .body(format!(
                r#"{{"student_id": {}, "name": "Next camp", "description": null, "references_camp_id": {}}}"#,
                student_id, prior_id
            ))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);
        let created: serde_json::Value =
            serde_json::from_str(&resp.into_string().await.unwrap()).unwrap();
        let next_id = created["id"].as_i64().unwrap();

        // Fetch the next camp's detail and check references_camp_name is resolved.
        let resp = client
            .get(format!("/api/camps/{}", next_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);
        let detail: serde_json::Value =
            serde_json::from_str(&resp.into_string().await.unwrap()).unwrap();
        assert_eq!(detail["references_camp_id"].as_i64(), Some(prior_id));
        assert_eq!(
            detail["references_camp_name"].as_str(),
            Some("Prior camp")
        );
    }

    #[rocket::async_test]
    async fn schema_creates_camp_reference_link_tables() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        // Verify the three link tables exist and are empty.
        let rm: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM camp_referenced_matches")
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert_eq!(rm, 0);

        let rt: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM camp_referenced_threads")
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert_eq!(rt, 0);

        let rv: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM camp_technique_referenced_videos")
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert_eq!(rv, 0);

        // Verify references_camp_id column exists on camps.
        let col: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('camps') WHERE name = 'references_camp_id'",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(col, 1);
    }

    // -----------------------------------------------------------------------
    // S3-5: promote pinned technique into a camp
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn coach_promotes_pinned_technique_to_camp_returns_204_and_technique_in_camp() {
        use crate::db::camps::list_camp_techniques;
        use crate::db::pin_technique;
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::{ContentType, Status};

        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let student_id = test_db.user_id("student_user").unwrap();
        let technique_id = test_db.technique_id("Armbar").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        // Pin the technique for the student.
        pin_technique(&db.pool, student_id, technique_id).await.unwrap();

        // Create a camp for the student.
        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Promo test camp') RETURNING id",
        )
        .bind(student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Coach promotes.
        let _ = crate::test::test_utils::login_test_user(&client, "coach_user", "password123").await;
        let resp = client
            .post(format!(
                "/api/students/{}/pinned/{}/promote",
                student_id, technique_id
            ))
            .header(ContentType::JSON)
            .body(format!(r#"{{"camp_id": {}}}"#, camp_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::NoContent);

        // Technique should now be in the camp.
        let techs = list_camp_techniques(&db.pool, camp_id).await.unwrap();
        assert_eq!(techs.len(), 1);
        assert_eq!(techs[0].technique_id, technique_id);
    }

    #[rocket::async_test]
    async fn promoting_non_pinned_technique_returns_404() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::{ContentType, Status};

        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let student_id = test_db.user_id("student_user").unwrap();
        let technique_id = test_db.technique_id("Armbar").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        // Do NOT pin the technique.

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'No pin camp') RETURNING id",
        )
        .bind(student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let _ = crate::test::test_utils::login_test_user(&client, "coach_user", "password123").await;
        let resp = client
            .post(format!(
                "/api/students/{}/pinned/{}/promote",
                student_id, technique_id
            ))
            .header(ContentType::JSON)
            .body(format!(r#"{{"camp_id": {}}}"#, camp_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::NotFound);
    }

    #[rocket::async_test]
    async fn non_coach_cannot_promote_pinned_technique_returns_403() {
        use crate::db::pin_technique;
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::{ContentType, Status};

        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let student_id = test_db.user_id("student_user").unwrap();
        let technique_id = test_db.technique_id("Armbar").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        pin_technique(&db.pool, student_id, technique_id).await.unwrap();

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Auth test camp') RETURNING id",
        )
        .bind(student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // Student cannot promote.
        let _ = crate::test::test_utils::login_test_user(&client, "student_user", "password123").await;
        let resp = client
            .post(format!(
                "/api/students/{}/pinned/{}/promote",
                student_id, technique_id
            ))
            .header(ContentType::JSON)
            .body(format!(r#"{{"camp_id": {}}}"#, camp_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Forbidden);
    }

    #[rocket::async_test]
    async fn promoting_into_other_students_camp_returns_400() {
        use crate::db::pin_technique;
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::{ContentType, Status};

        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let student_id = test_db.user_id("student_user").unwrap();
        let technique_id = test_db.technique_id("Armbar").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        pin_technique(&db.pool, student_id, technique_id).await.unwrap();

        // Create a second student and a camp belonging to that second student.
        let other_student_id: i64 = sqlx::query_scalar(
            "INSERT INTO users (username, role, password, display_name, approved_at, claimed_at)
             SELECT 'other_student', 'student', password, 'Other Student', approved_at, claimed_at
             FROM users WHERE username = 'student_user' RETURNING id",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let other_camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Other camp') RETURNING id",
        )
        .bind(other_student_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let _ = crate::test::test_utils::login_test_user(&client, "coach_user", "password123").await;
        let resp = client
            .post(format!(
                "/api/students/{}/pinned/{}/promote",
                student_id, technique_id
            ))
            .header(ContentType::JSON)
            .body(format!(r#"{{"camp_id": {}}}"#, other_camp_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::BadRequest);
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
}
