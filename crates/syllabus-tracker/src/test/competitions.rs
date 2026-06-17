#[cfg(test)]
mod tests {
    use crate::db::competitions::{
        create_competition, get_competition, list_competitions, update_competition,
        register_student, unregister_student, get_registration, registration_for,
        list_registrations_for_competition, promote_camp_to_competition,
    };
    use crate::db::{VideoParent, create_processing_video, list_videos_for_match};
    use crate::test::test_utils::TestDbBuilder;

    #[rocket::async_test]
    async fn competitions_schema() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        // All 4 new tables exist and are empty.
        let competitions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM competitions")
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert_eq!(competitions, 0);

        let competition_registrations: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM competition_registrations")
                .fetch_one(&db.pool)
                .await
                .unwrap();
        assert_eq!(competition_registrations, 0);

        let matches: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM matches")
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert_eq!(matches, 0);

        let match_techniques: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM match_techniques")
                .fetch_one(&db.pool)
                .await
                .unwrap();
        assert_eq!(match_techniques, 0);

        // camps.competition_id column exists.
        let camps_comp_col: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('camps') WHERE name = 'competition_id'",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(camps_comp_col, 1);

        // videos.match_id column exists.
        let videos_match_col: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('videos') WHERE name = 'match_id'",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(videos_match_col, 1);

        // activity.match_id column exists.
        let activity_match_col: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('activity') WHERE name = 'match_id'",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(activity_match_col, 1);

        // activity.competition_id column exists.
        let activity_competition_col: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('activity') WHERE name = 'competition_id'",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();
        assert_eq!(activity_competition_col, 1);

        // Insert a competition -> registration -> match chain, then assert a
        // parent_kind='match' video insert satisfies the videos CHECK constraint.
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();

        let competition_id: i64 = sqlx::query_scalar(
            "INSERT INTO competitions (name, created_by_id) VALUES ('IBJJF Worlds 2026', ?) RETURNING id",
        )
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let registration_id: i64 = sqlx::query_scalar(
            "INSERT INTO competition_registrations (student_id, competition_id, registered_by_id)
             VALUES (?, ?, ?) RETURNING id",
        )
        .bind(student_id)
        .bind(competition_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let match_id: i64 = sqlx::query_scalar(
            "INSERT INTO matches (registration_id, result, created_by_id)
             VALUES (?, 'win', ?) RETURNING id",
        )
        .bind(registration_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        // A match-owned video must satisfy the CHECK constraint.
        let _video_id: i64 = sqlx::query_scalar(
            "INSERT INTO videos (parent_kind, match_id, title, kind, processing_status, uploaded_by_id)
             VALUES ('match', ?, 'Match footage', 'external', 'ready', ?)
             RETURNING id",
        )
        .bind(match_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
    }

    #[rocket::async_test]
    async fn create_video_with_match_parent() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();

        let competition_id: i64 = sqlx::query_scalar(
            "INSERT INTO competitions (name, created_by_id) VALUES ('Test Open 2026', ?) RETURNING id",
        )
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let registration_id: i64 = sqlx::query_scalar(
            "INSERT INTO competition_registrations (student_id, competition_id, registered_by_id)
             VALUES (?, ?, ?) RETURNING id",
        )
        .bind(student_id)
        .bind(competition_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let match_id: i64 = sqlx::query_scalar(
            "INSERT INTO matches (registration_id, result, created_by_id)
             VALUES (?, 'win', ?) RETURNING id",
        )
        .bind(registration_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let video_id = create_processing_video(
            &db.pool,
            VideoParent::Match(match_id),
            "Match clip",
            None,
            coach_id,
        )
        .await
        .unwrap();

        let (kind, got_match): (String, i64) =
            sqlx::query_as("SELECT parent_kind, match_id FROM videos WHERE id = ?")
                .bind(video_id)
                .fetch_one(&db.pool)
                .await
                .unwrap();

        assert_eq!(kind, "match");
        assert_eq!(got_match, match_id);
    }

    #[rocket::async_test]
    async fn list_videos_for_match_returns_match_owned_videos() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();

        let competition_id: i64 = sqlx::query_scalar(
            "INSERT INTO competitions (name, created_by_id) VALUES ('List Test Open', ?) RETURNING id",
        )
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let registration_id: i64 = sqlx::query_scalar(
            "INSERT INTO competition_registrations (student_id, competition_id, registered_by_id)
             VALUES (?, ?, ?) RETURNING id",
        )
        .bind(student_id)
        .bind(competition_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let match_id: i64 = sqlx::query_scalar(
            "INSERT INTO matches (registration_id, result, created_by_id)
             VALUES (?, 'loss', ?) RETURNING id",
        )
        .bind(registration_id)
        .bind(coach_id)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        let video_id = create_processing_video(
            &db.pool,
            VideoParent::Match(match_id),
            "Match footage clip",
            None,
            coach_id,
        )
        .await
        .unwrap();

        // Processing videos are not hidden so they appear in the list.
        let videos = list_videos_for_match(&db.pool, match_id).await.unwrap();
        assert_eq!(videos.len(), 1);
        assert_eq!(videos[0].id, video_id);
        assert_eq!(videos[0].match_id, Some(match_id));
        assert_eq!(videos[0].parent_kind, "match");
    }

    // -----------------------------------------------------------------------
    // S2-3: db/competitions.rs tests
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn competition_create_get_list() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();

        // Create with a date.
        let id1 = create_competition(&db.pool, "IBJJF Worlds 2026", Some("2026-08-15"), coach)
            .await
            .unwrap();
        // Create without a date.
        let id2 = create_competition(&db.pool, "Local Open TBD", None, coach)
            .await
            .unwrap();

        let c1 = get_competition(&db.pool, id1).await.unwrap().unwrap();
        assert_eq!(c1.name, "IBJJF Worlds 2026");
        assert_eq!(c1.date.as_deref(), Some("2026-08-15"));
        assert_eq!(c1.created_by_id, coach);

        let c2 = get_competition(&db.pool, id2).await.unwrap().unwrap();
        assert_eq!(c2.name, "Local Open TBD");
        assert!(c2.date.is_none());

        let list = list_competitions(&db.pool).await.unwrap();
        // Dated competitions appear before undated ones; id1 (date) is first.
        assert_eq!(list.len(), 2);
        let names: Vec<&str> = list.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names[0], "IBJJF Worlds 2026");
        assert_eq!(names[1], "Local Open TBD");

        // get_competition returns None for a non-existent id.
        let missing = get_competition(&db.pool, 9999).await.unwrap();
        assert!(missing.is_none());
    }

    #[rocket::async_test]
    async fn competition_update_not_found() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let id = create_competition(&db.pool, "Pan Ams 2026", None, coach)
            .await
            .unwrap();

        update_competition(&db.pool, id, "Pan Ams 2027", Some("2027-03-10"))
            .await
            .unwrap();

        let updated = get_competition(&db.pool, id).await.unwrap().unwrap();
        assert_eq!(updated.name, "Pan Ams 2027");
        assert_eq!(updated.date.as_deref(), Some("2027-03-10"));

        // Update a non-existent id returns NotFound.
        let err = update_competition(&db.pool, 9999, "Ghost", None).await;
        assert!(
            matches!(err, Err(crate::error::AppError::NotFound(_))),
            "expected NotFound, got {:?}",
            err
        );
    }

    #[rocket::async_test]
    async fn register_self_then_re_register_clears_unregister() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let student = db.user_id("student_user").unwrap();

        let comp_id = create_competition(&db.pool, "Euro Open 2026", None, coach)
            .await
            .unwrap();

        // Register the student.
        let reg_id = register_student(&db.pool, comp_id, student, student)
            .await
            .unwrap();
        let reg = get_registration(&db.pool, reg_id).await.unwrap().unwrap();
        assert_eq!(reg.student_id, student);
        assert!(reg.unregistered_at.is_none());

        // Soft-unregister.
        unregister_student(&db.pool, comp_id, student).await.unwrap();
        let reg = get_registration(&db.pool, reg_id).await.unwrap().unwrap();
        assert!(reg.unregistered_at.is_some(), "should be unregistered");

        // Re-register clears unregistered_at.
        let reg_id2 = register_student(&db.pool, comp_id, student, coach)
            .await
            .unwrap();
        // Upsert: same row id.
        assert_eq!(reg_id2, reg_id);
        let reg = get_registration(&db.pool, reg_id).await.unwrap().unwrap();
        assert!(
            reg.unregistered_at.is_none(),
            "re-register should clear unregistered_at"
        );
        assert_eq!(reg.registered_by_id, Some(coach));
    }

    #[rocket::async_test]
    async fn unregister_is_noop_when_already_unregistered() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let student = db.user_id("student_user").unwrap();

        let comp_id = create_competition(&db.pool, "Nogi Worlds", None, coach)
            .await
            .unwrap();

        register_student(&db.pool, comp_id, student, coach)
            .await
            .unwrap();
        unregister_student(&db.pool, comp_id, student).await.unwrap();

        // A second unregister call must not error and must not change the timestamp.
        let reg_before = registration_for(&db.pool, student, comp_id)
            .await
            .unwrap()
            .unwrap();
        unregister_student(&db.pool, comp_id, student).await.unwrap();
        let reg_after = registration_for(&db.pool, student, comp_id)
            .await
            .unwrap()
            .unwrap();

        assert_eq!(
            reg_before.unregistered_at,
            reg_after.unregistered_at,
            "double unregister must not change the timestamp"
        );
    }

    #[rocket::async_test]
    async fn roster_shows_active_registrations_with_camp_link() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let student = db.user_id("student_user").unwrap();

        let comp_id = create_competition(&db.pool, "Gi Nats 2026", None, coach)
            .await
            .unwrap();

        register_student(&db.pool, comp_id, student, coach)
            .await
            .unwrap();

        // Roster has one entry with the student's name and no camp yet.
        let roster = list_registrations_for_competition(&db.pool, comp_id)
            .await
            .unwrap();
        assert_eq!(roster.len(), 1);
        assert_eq!(roster[0].student_id, student);
        assert_eq!(roster[0].student_name.as_deref(), Some("Sam"));
        assert!(roster[0].camp_id.is_none());

        // Create a camp and link it to the competition.
        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Gi Nats prep') RETURNING id",
        )
        .bind(student)
        .bind(coach)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        promote_camp_to_competition(&db.pool, camp_id, comp_id, coach)
            .await
            .unwrap();

        let roster = list_registrations_for_competition(&db.pool, comp_id)
            .await
            .unwrap();
        assert_eq!(roster.len(), 1);
        assert_eq!(roster[0].camp_id, Some(camp_id));

        // Unregistered students are excluded from the roster.
        unregister_student(&db.pool, comp_id, student).await.unwrap();
        let roster = list_registrations_for_competition(&db.pool, comp_id)
            .await
            .unwrap();
        assert_eq!(roster.len(), 0, "unregistered student must not appear");
    }

    #[rocket::async_test]
    async fn promote_camp_sets_competition_id_and_emits() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .student("student_user", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let student = db.user_id("student_user").unwrap();

        let comp_id = create_competition(&db.pool, "Masters 2026", None, coach)
            .await
            .unwrap();

        let camp_id: i64 = sqlx::query_scalar(
            "INSERT INTO camps (student_id, coach_id, name) VALUES (?, ?, 'Masters prep') RETURNING id",
        )
        .bind(student)
        .bind(coach)
        .fetch_one(&db.pool)
        .await
        .unwrap();

        promote_camp_to_competition(&db.pool, camp_id, comp_id, coach)
            .await
            .unwrap();

        // camps.competition_id must be set.
        let stored_comp_id: i64 =
            sqlx::query_scalar("SELECT competition_id FROM camps WHERE id = ?")
                .bind(camp_id)
                .fetch_one(&db.pool)
                .await
                .unwrap();
        assert_eq!(stored_comp_id, comp_id);

        // An activity row for camp_promoted_to_competition must exist.
        let (verb, target, got_camp, got_comp): (String, i64, i64, i64) = sqlx::query_as(
            "SELECT verb, target_student_id, camp_id, competition_id
             FROM activity
             WHERE verb = 'camp_promoted_to_competition'
             ORDER BY id DESC LIMIT 1",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();

        assert_eq!(verb, "camp_promoted_to_competition");
        assert_eq!(target, student);
        assert_eq!(got_camp, camp_id);
        assert_eq!(got_comp, comp_id);
    }

    #[rocket::async_test]
    async fn promote_camp_not_found_returns_error() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        let comp_id = create_competition(&db.pool, "Test Comp", None, coach)
            .await
            .unwrap();

        let err = promote_camp_to_competition(&db.pool, 9999, comp_id, coach).await;
        assert!(
            matches!(err, Err(crate::error::AppError::NotFound(_))),
            "expected NotFound for unknown camp, got {:?}",
            err
        );
    }

    #[rocket::async_test]
    async fn competition_created_activity_is_gym_wide_no_target_student() {
        let db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach"))
            .build()
            .await
            .unwrap();

        let coach = db.user_id("coach_user").unwrap();
        create_competition(&db.pool, "Activity Test Comp", None, coach)
            .await
            .unwrap();

        let (verb, target): (String, Option<i64>) = sqlx::query_as(
            "SELECT verb, target_student_id FROM activity
             WHERE verb = 'competition_created'
             ORDER BY id DESC LIMIT 1",
        )
        .fetch_one(&db.pool)
        .await
        .unwrap();

        assert_eq!(verb, "competition_created");
        assert!(
            target.is_none(),
            "competition_created must have NULL target_student_id (gym-wide)"
        );
    }

    // -----------------------------------------------------------------------
    // S2-5: HTTP route tests
    // -----------------------------------------------------------------------

    async fn login_as(client: &rocket::local::asynchronous::Client, username: &str) {
        let _ = crate::test::test_utils::login_test_user(client, username, "password123").await;
    }

    #[rocket::async_test]
    async fn coach_creates_competition_student_gets_403() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::{ContentType, Status};

        let test_db = create_standard_test_db().await;
        let (client, _db) = setup_test_client(test_db).await;

        // Coach can create.
        login_as(&client, "coach_user").await;
        let resp = client
            .post("/api/competitions")
            .header(ContentType::JSON)
            .body(r#"{"name": "IBJJF Worlds 2026", "date": "2026-08-15"}"#)
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);
        let body: serde_json::Value =
            serde_json::from_str(&resp.into_string().await.unwrap()).unwrap();
        assert!(body["id"].as_i64().is_some());

        // Student cannot create.
        login_as(&client, "student_user").await;
        let resp = client
            .post("/api/competitions")
            .header(ContentType::JSON)
            .body(r#"{"name": "sneaky", "date": null}"#)
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Forbidden);
    }

    #[rocket::async_test]
    async fn student_self_registers_and_coach_registers_other() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::Status;

        let test_db = create_standard_test_db().await;
        let student_id = test_db.user_id("student_user").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        // Create competition via DB.
        let coach_id = db.user_id("coach_user").unwrap();
        let comp_id = create_competition(&db.pool, "Pan Ams 2026", None, coach_id)
            .await
            .unwrap();

        // Student self-registers.
        login_as(&client, "student_user").await;
        let resp = client
            .post(format!("/api/competitions/{}/register", comp_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);
        let body: serde_json::Value =
            serde_json::from_str(&resp.into_string().await.unwrap()).unwrap();
        assert!(body["id"].as_i64().is_some());

        // Coach registers admin_user as another student via the path route.
        login_as(&client, "coach_user").await;
        // admin_user is admin-role, but coach can register anyone
        let admin_id = db.user_id("admin_user").unwrap();
        let resp = client
            .post(format!(
                "/api/competitions/{}/register/{}",
                comp_id, admin_id
            ))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);

        // Student cannot use the coach-register-other route.
        login_as(&client, "student_user").await;
        let resp = client
            .post(format!(
                "/api/competitions/{}/register/{}",
                comp_id, student_id
            ))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Forbidden);
    }

    #[rocket::async_test]
    async fn coach_and_own_student_log_match_other_student_gets_403() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::{ContentType, Status};

        let test_db = create_standard_test_db().await;
        let student_id = test_db.user_id("student_user").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        let coach_id = db.user_id("coach_user").unwrap();
        let comp_id = create_competition(&db.pool, "Euro Open 2026", None, coach_id)
            .await
            .unwrap();
        let reg_id = register_student(&db.pool, comp_id, student_id, coach_id)
            .await
            .unwrap();

        // Insert a second (unrelated) student cloning student_user's auth columns.
        sqlx::query(
            "INSERT INTO users (username, role, password, display_name, approved_at, claimed_at)
             SELECT 'other_student', 'student', password, 'Other Student', approved_at, claimed_at
             FROM users WHERE username = 'student_user'",
        )
        .execute(&db.pool)
        .await
        .unwrap();

        // Coach can log a match.
        login_as(&client, "coach_user").await;
        let resp = client
            .post(format!("/api/registrations/{}/matches", reg_id))
            .header(ContentType::JSON)
            .body(r#"{"result": "win", "method": "submission", "method_detail": "kimura", "occurred_at": null}"#)
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);
        let match_body: serde_json::Value =
            serde_json::from_str(&resp.into_string().await.unwrap()).unwrap();
        let match_id = match_body["id"].as_i64().unwrap();

        // The registration's own student can log a match.
        login_as(&client, "student_user").await;
        let resp = client
            .post(format!("/api/registrations/{}/matches", reg_id))
            .header(ContentType::JSON)
            .body(r#"{"result": "loss", "method": null, "method_detail": null, "occurred_at": null}"#)
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);

        // A different student gets 403.
        login_as(&client, "other_student").await;
        let resp = client
            .post(format!("/api/registrations/{}/matches", reg_id))
            .header(ContentType::JSON)
            .body(r#"{"result": "draw", "method": null, "method_detail": null, "occurred_at": null}"#)
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Forbidden);

        // A different student cannot update another student's match.
        let resp = client
            .put(format!("/api/matches/{}", match_id))
            .header(ContentType::JSON)
            .body(r#"{"result": "loss", "method": null, "method_detail": null, "occurred_at": null}"#)
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Forbidden);

        // A different student cannot delete another student's match.
        let resp = client
            .delete(format!("/api/matches/{}", match_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Forbidden);
    }

    #[rocket::async_test]
    async fn match_video_upload_authz() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::Status;

        const BOUNDARY: &str = "----testboundarymatch";

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
        let student_id = test_db.user_id("student_user").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        let coach_id = db.user_id("coach_user").unwrap();
        let comp_id = create_competition(&db.pool, "Video Upload Test Comp", None, coach_id)
            .await
            .unwrap();
        let reg_id = register_student(&db.pool, comp_id, student_id, coach_id)
            .await
            .unwrap();

        use crate::db::matches::{create_match as db_create_match, MatchResult};
        let match_id = db_create_match(
            &db.pool,
            reg_id,
            MatchResult::Win,
            None,
            None,
            None,
            coach_id,
        )
        .await
        .unwrap();

        // Insert another student.
        sqlx::query(
            "INSERT INTO users (username, role, password, display_name, approved_at, claimed_at)
             SELECT 'other_student', 'student', password, 'Other', approved_at, claimed_at
             FROM users WHERE username = 'student_user'",
        )
        .execute(&db.pool)
        .await
        .unwrap();

        // Coach can upload.
        login_as(&client, "coach_user").await;
        let body = multipart_body(b"fake-mp4-bytes", "match.mp4", "Match Clip");
        let resp = client
            .post(format!("/api/matches/{}/videos/upload", match_id))
            .header(multipart_ct())
            .body(body)
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);

        // Registration's own student can upload.
        login_as(&client, "student_user").await;
        let body = multipart_body(b"fake-mp4-bytes", "match2.mp4", "My Match Clip");
        let resp = client
            .post(format!("/api/matches/{}/videos/upload", match_id))
            .header(multipart_ct())
            .body(body)
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);

        // Other student gets 403.
        login_as(&client, "other_student").await;
        let body = multipart_body(b"fake-mp4-bytes", "match3.mp4", "Sneaky Clip");
        let resp = client
            .post(format!("/api/matches/{}/videos/upload", match_id))
            .header(multipart_ct())
            .body(body)
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Forbidden);
    }

    #[rocket::async_test]
    async fn occurred_at_future_is_rejected() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::{ContentType, Status};

        let test_db = create_standard_test_db().await;
        let student_id = test_db.user_id("student_user").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        let coach_id = db.user_id("coach_user").unwrap();
        let comp_id = create_competition(&db.pool, "Future Date Test", None, coach_id)
            .await
            .unwrap();
        let reg_id = register_student(&db.pool, comp_id, student_id, coach_id)
            .await
            .unwrap();

        login_as(&client, "coach_user").await;
        let resp = client
            .post(format!("/api/registrations/{}/matches", reg_id))
            .header(ContentType::JSON)
            .body(r#"{"result": "win", "method": null, "method_detail": null, "occurred_at": "2099-01-01T00:00:00"}"#)
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::BadRequest);
    }

    #[rocket::async_test]
    async fn invalid_result_is_rejected() {
        use crate::test::test_utils::{create_standard_test_db, setup_test_client};
        use rocket::http::{ContentType, Status};

        let test_db = create_standard_test_db().await;
        let student_id = test_db.user_id("student_user").unwrap();
        let (client, db) = setup_test_client(test_db).await;

        let coach_id = db.user_id("coach_user").unwrap();
        let comp_id = create_competition(&db.pool, "Bad Result Test", None, coach_id)
            .await
            .unwrap();
        let reg_id = register_student(&db.pool, comp_id, student_id, coach_id)
            .await
            .unwrap();

        login_as(&client, "coach_user").await;
        let resp = client
            .post(format!("/api/registrations/{}/matches", reg_id))
            .header(ContentType::JSON)
            .body(r#"{"result": "notaresult", "method": null, "method_detail": null, "occurred_at": null}"#)
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::BadRequest);
    }
}
