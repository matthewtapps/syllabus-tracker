#[cfg(test)]
mod tests {
    use rocket::http::{ContentType, Status};
    use serde_json::{Value, json};

    use crate::db::{
        list_pinned_for_student, pin_technique, pinned_technique_ids_for_student, unpin_technique,
    };
    use crate::test::test_utils::{
        TestDbBuilder, create_standard_test_db, login_test_user, setup_test_client,
    };

    async fn standard_db_with_client() -> (
        rocket::local::asynchronous::Client,
        crate::test::test_utils::TestDb,
    ) {
        let test_db = create_standard_test_db().await;
        setup_test_client(test_db).await
    }

    #[rocket::async_test]
    async fn pin_technique_is_idempotent() {
        let (_client, db) = standard_db_with_client().await;
        let student_id = db.user_id("student_user").unwrap();
        let technique_id = db.technique_id("Armbar").unwrap();

        pin_technique(&db.pool, student_id, technique_id)
            .await
            .unwrap();
        // Second call must not error or duplicate.
        pin_technique(&db.pool, student_id, technique_id)
            .await
            .unwrap();

        let pinned_ids = pinned_technique_ids_for_student(&db.pool, student_id)
            .await
            .unwrap();
        assert_eq!(pinned_ids.len(), 1);
        assert!(pinned_ids.contains(&technique_id));
    }

    #[rocket::async_test]
    async fn unpin_never_pinned_is_no_op() {
        let (_client, db) = standard_db_with_client().await;
        let student_id = db.user_id("student_user").unwrap();
        let technique_id = db.technique_id("Triangle").unwrap();

        // Triangle was never pinned for this student; unpin should succeed silently.
        unpin_technique(&db.pool, student_id, technique_id)
            .await
            .unwrap();
    }

    #[rocket::async_test]
    async fn list_pinned_for_student_returns_only_owned_pins() {
        let test_db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .student("bob", None)
            .technique("Armbar", "", Some("coach"))
            .technique("Triangle", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let (_client, db) = setup_test_client(test_db).await;
        let alice = db.user_id("alice").unwrap();
        let bob = db.user_id("bob").unwrap();
        let armbar = db.technique_id("Armbar").unwrap();
        let triangle = db.technique_id("Triangle").unwrap();

        pin_technique(&db.pool, alice, armbar).await.unwrap();
        pin_technique(&db.pool, bob, triangle).await.unwrap();

        let alice_pins = list_pinned_for_student(&db.pool, alice).await.unwrap();
        assert_eq!(alice_pins.len(), 1);
        assert_eq!(alice_pins[0].id, armbar);
        assert!(alice_pins[0].is_pinned);

        let bob_pins = list_pinned_for_student(&db.pool, bob).await.unwrap();
        assert_eq!(bob_pins.len(), 1);
        assert_eq!(bob_pins[0].id, triangle);
    }

    #[rocket::async_test]
    async fn api_techniques_open_to_students_and_coaches() {
        let (client, _db) = standard_db_with_client().await;

        // Unauth -> 401.
        let unauth = client.get("/api/techniques").dispatch().await;
        assert_eq!(unauth.status(), Status::Unauthorized);

        // Student -> 200.
        let _ = login_test_user(&client, "student_user", "password123").await;
        let student_resp = client.get("/api/techniques").dispatch().await;
        assert_eq!(student_resp.status(), Status::Ok);

        // Coach -> 200.
        let _ = login_test_user(&client, "coach_user", "password123").await;
        let coach_resp = client.get("/api/techniques").dispatch().await;
        assert_eq!(coach_resp.status(), Status::Ok);
    }

    #[rocket::async_test]
    async fn api_technique_stats_stays_coach_only() {
        let (client, db) = standard_db_with_client().await;
        let technique_id = db.technique_id("Armbar").unwrap();

        let _ = login_test_user(&client, "student_user", "password123").await;
        let student_resp = client
            .get(format!("/api/techniques/{}/stats", technique_id))
            .dispatch()
            .await;
        assert_eq!(student_resp.status(), Status::Forbidden);

        let _ = login_test_user(&client, "coach_user", "password123").await;
        let coach_resp = client
            .get(format!("/api/techniques/{}/stats", technique_id))
            .dispatch()
            .await;
        assert_eq!(coach_resp.status(), Status::Ok);
    }

    #[rocket::async_test]
    async fn api_student_library_returns_is_pinned_overlay() {
        let (client, db) = standard_db_with_client().await;
        let student_id = db.user_id("student_user").unwrap();
        let armbar_id = db.technique_id("Armbar").unwrap();

        pin_technique(&db.pool, student_id, armbar_id).await.unwrap();

        let _ = login_test_user(&client, "student_user", "password123").await;
        let resp = client
            .get(format!("/api/student/{}/library", student_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);

        let body: Vec<Value> = serde_json::from_str(&resp.into_string().await.unwrap()).unwrap();
        let armbar = body
            .iter()
            .find(|t| t["id"].as_i64() == Some(armbar_id))
            .expect("armbar in library response");
        assert_eq!(armbar["is_pinned"].as_bool(), Some(true));

        let triangle = body
            .iter()
            .find(|t| t["name"] == "Triangle")
            .expect("triangle in library response");
        assert_eq!(triangle["is_pinned"].as_bool(), Some(false));
    }

    #[rocket::async_test]
    async fn api_pin_rejects_coach_pinning_on_student_behalf() {
        let (client, db) = standard_db_with_client().await;
        let student_id = db.user_id("student_user").unwrap();
        let technique_id = db.technique_id("Armbar").unwrap();

        let _ = login_test_user(&client, "coach_user", "password123").await;
        let resp = client
            .post(format!("/api/student/{}/pinned_techniques", student_id))
            .header(ContentType::JSON)
            .body(json!({ "technique_id": technique_id }).to_string())
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Forbidden);

        // Confirm no pin row was created.
        let pinned = pinned_technique_ids_for_student(&db.pool, student_id)
            .await
            .unwrap();
        assert!(pinned.is_empty());
    }

    #[rocket::async_test]
    async fn api_pin_unpin_roundtrip_for_owning_student() {
        let (client, db) = standard_db_with_client().await;
        let student_id = db.user_id("student_user").unwrap();
        let technique_id = db.technique_id("Armbar").unwrap();

        let _ = login_test_user(&client, "student_user", "password123").await;

        let pin = client
            .post(format!("/api/student/{}/pinned_techniques", student_id))
            .header(ContentType::JSON)
            .body(json!({ "technique_id": technique_id }).to_string())
            .dispatch()
            .await;
        assert_eq!(pin.status(), Status::NoContent);

        let list = client
            .get(format!("/api/student/{}/pinned_techniques", student_id))
            .dispatch()
            .await;
        assert_eq!(list.status(), Status::Ok);
        let rows: Vec<Value> =
            serde_json::from_str(&list.into_string().await.unwrap()).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"].as_i64(), Some(technique_id));
        assert_eq!(rows[0]["is_pinned"].as_bool(), Some(true));

        let unpin = client
            .delete(format!(
                "/api/student/{}/pinned_techniques/{}",
                student_id, technique_id
            ))
            .dispatch()
            .await;
        assert_eq!(unpin.status(), Status::NoContent);

        let after = pinned_technique_ids_for_student(&db.pool, student_id)
            .await
            .unwrap();
        assert!(after.is_empty());
    }

    #[rocket::async_test]
    async fn api_student_library_blocked_for_other_students() {
        let test_db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .student("bob", None)
            .technique("Armbar", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let (client, db) = setup_test_client(test_db).await;
        let alice = db.user_id("alice").unwrap();

        let _ = login_test_user(&client, "bob", "password123").await;
        let resp = client
            .get(format!("/api/student/{}/library", alice))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Forbidden);
    }

    #[rocket::async_test]
    async fn student_library_videos_ignore_per_student_overrides() {
        use crate::db::{set_video_hidden_globally, set_video_student_visibility};

        let (client, db) = standard_db_with_client().await;
        let coach_id = db.user_id("coach_user").unwrap();
        let student_id = db.user_id("student_user").unwrap();
        let technique_id = db.technique_id("Armbar").unwrap();

        // Seed two videos directly via SQL so the test does not require the
        // video upload stack.
        sqlx::query!(
            "INSERT INTO videos (technique_id, title, description, position, kind,
                                 processing_status, uploaded_by_id)
             VALUES (?, 'Visible Clip', '', 0, 'external', 'ready', ?),
                    (?, 'Globally Hidden Clip', '', 1, 'external', 'ready', ?)",
            technique_id,
            coach_id,
            technique_id,
            coach_id,
        )
        .execute(&db.pool)
        .await
        .unwrap();

        let video_ids: Vec<i64> = sqlx::query_scalar(
            "SELECT id FROM videos WHERE technique_id = ? ORDER BY position ASC",
        )
        .bind(technique_id)
        .fetch_all(&db.pool)
        .await
        .unwrap();
        let visible_id = video_ids[0];
        let hidden_id = video_ids[1];

        // Globally hide the second video.
        set_video_hidden_globally(&db.pool, hidden_id, true)
            .await
            .unwrap();

        // Add a per-student override that *would*, under legacy semantics,
        // force-show the hidden video for this student. Library context must
        // ignore it.
        set_video_student_visibility(&db.pool, hidden_id, student_id, Some(true), coach_id)
            .await
            .unwrap();
        // And one that would force-hide the visible video. Also ignored.
        set_video_student_visibility(&db.pool, visible_id, student_id, Some(false), coach_id)
            .await
            .unwrap();

        let _ = login_test_user(&client, "student_user", "password123").await;
        let resp = client
            .get(format!("/api/techniques/{}/videos", technique_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);

        let body: Value = serde_json::from_str(&resp.into_string().await.unwrap()).unwrap();
        let videos = body["videos"].as_array().expect("videos array");
        let returned_ids: Vec<i64> = videos
            .iter()
            .map(|v| v["id"].as_i64().expect("video id"))
            .collect();
        assert_eq!(returned_ids, vec![visible_id]);
    }
}
