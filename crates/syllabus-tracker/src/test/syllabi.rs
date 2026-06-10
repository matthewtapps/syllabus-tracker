#[cfg(test)]
mod tests {
    use rocket::http::{ContentType, Status};
    use serde_json::{Value, json};

    use crate::db;
    use crate::db::PropagationMode;
    use crate::test::test_utils::{
        TestDbBuilder, create_standard_test_db, login_test_user, setup_test_client,
    };

    async fn assign_syllabus_and_seed_techniques() -> (
        rocket::local::asynchronous::Client,
        crate::test::test_utils::TestDb,
        i64, // syllabus_id
        i64, // student_id
        i64, // coach_id
        i64, // armbar_id
        i64, // triangle_id
    ) {
        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let student_id = test_db.user_id("student_user").unwrap();
        let armbar_id = test_db.technique_id("Armbar").unwrap();
        let triangle_id = test_db.technique_id("Triangle").unwrap();
        let syllabus_id = db::create_syllabus(&test_db.pool, "Fundamentals", None, coach_id)
            .await
            .unwrap();
        db::add_technique_to_syllabus(
            &test_db.pool,
            syllabus_id,
            armbar_id,
            coach_id,
            PropagationMode::SyllabusOnly,
        )
        .await
        .unwrap();
        db::add_technique_to_syllabus(
            &test_db.pool,
            syllabus_id,
            triangle_id,
            coach_id,
            PropagationMode::SyllabusOnly,
        )
        .await
        .unwrap();
        let (client, db) = setup_test_client(test_db).await;
        (
            client,
            db,
            syllabus_id,
            student_id,
            coach_id,
            armbar_id,
            triangle_id,
        )
    }

    #[rocket::async_test]
    async fn re_assigning_same_pair_clears_unassigned_at() {
        let (_client, db, syllabus_id, student_id, coach_id, _, _) =
            assign_syllabus_and_seed_techniques().await;

        let first = db::assign(&db.pool, coach_id, student_id, syllabus_id)
            .await
            .unwrap();
        db::unassign(&db.pool, coach_id, first).await.unwrap();
        let second = db::assign(&db.pool, coach_id, student_id, syllabus_id)
            .await
            .unwrap();
        assert_eq!(first, second, "Re-assign should re-activate the same row");

        let assignment = db::get_assignment(&db.pool, student_id, syllabus_id)
            .await
            .unwrap()
            .unwrap();
        assert!(assignment.unassigned_at.is_none());
    }

    #[rocket::async_test]
    async fn eager_sst_materialization_on_assign() {
        let (_client, db, syllabus_id, student_id, coach_id, armbar_id, triangle_id) =
            assign_syllabus_and_seed_techniques().await;

        let assignment_id = db::assign(&db.pool, coach_id, student_id, syllabus_id)
            .await
            .unwrap();
        let user = crate::db::get_user(&db.pool, coach_id).await.unwrap();
        let rows = db::list_for_assignment(&db.pool, assignment_id, &user)
            .await
            .unwrap();
        assert_eq!(rows.len(), 2);
        let mut ids: Vec<i64> = rows.iter().map(|r| r.technique_id).collect();
        ids.sort();
        assert_eq!(ids, {
            let mut v = vec![armbar_id, triangle_id];
            v.sort();
            v
        });
    }

    #[rocket::async_test]
    async fn cascade_add_inserts_sst_for_active_assignments() {
        // Seed an assignment first, then add a new technique with Cascade
        // and confirm the SST appears in the existing assignment.
        let test_db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("A", "", Some("coach"))
            .technique("B", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let coach_id = test_db.user_id("coach").unwrap();
        let student_id = test_db.user_id("alice").unwrap();
        let a_id = test_db.technique_id("A").unwrap();
        let b_id = test_db.technique_id("B").unwrap();

        let syllabus_id = db::create_syllabus(&test_db.pool, "Core", None, coach_id)
            .await
            .unwrap();
        db::add_technique_to_syllabus(
            &test_db.pool,
            syllabus_id,
            a_id,
            coach_id,
            PropagationMode::SyllabusOnly,
        )
        .await
        .unwrap();
        let assignment_id = db::assign(&test_db.pool, coach_id, student_id, syllabus_id)
            .await
            .unwrap();
        // Sanity: assignment has 1 SST for A.
        let user = crate::db::get_user(&test_db.pool, coach_id).await.unwrap();
        assert_eq!(
            db::list_for_assignment(&test_db.pool, assignment_id, &user)
                .await
                .unwrap()
                .len(),
            1
        );

        // Cascade-add B; it should fan out to alice's assignment.
        db::add_technique_to_syllabus(
            &test_db.pool,
            syllabus_id,
            b_id,
            coach_id,
            PropagationMode::Cascade,
        )
        .await
        .unwrap();
        assert_eq!(
            db::list_for_assignment(&test_db.pool, assignment_id, &user)
                .await
                .unwrap()
                .len(),
            2
        );
    }

    #[rocket::async_test]
    async fn syllabus_only_add_does_not_fan_out() {
        let (_client, db, syllabus_id, student_id, coach_id, _, _) =
            assign_syllabus_and_seed_techniques().await;

        let assignment_id = db::assign(&db.pool, coach_id, student_id, syllabus_id)
            .await
            .unwrap();
        let user = crate::db::get_user(&db.pool, coach_id).await.unwrap();
        let initial_count = db::list_for_assignment(&db.pool, assignment_id, &user)
            .await
            .unwrap()
            .len();

        // Create a new technique not in any SST yet.
        let new_tid = db::create_technique(&db.pool, "Side Control", "", coach_id)
            .await
            .unwrap();
        db::add_technique_to_syllabus(
            &db.pool,
            syllabus_id,
            new_tid,
            coach_id,
            PropagationMode::SyllabusOnly,
        )
        .await
        .unwrap();

        // SST count unchanged because we didn't cascade.
        assert_eq!(
            db::list_for_assignment(&db.pool, assignment_id, &user)
                .await
                .unwrap()
                .len(),
            initial_count
        );
    }

    #[rocket::async_test]
    async fn cascade_remove_soft_hides_sst() {
        let (_client, db, syllabus_id, student_id, coach_id, armbar_id, _) =
            assign_syllabus_and_seed_techniques().await;

        let assignment_id = db::assign(&db.pool, coach_id, student_id, syllabus_id)
            .await
            .unwrap();

        // Cascade-remove armbar.
        db::remove_technique_from_syllabus(
            &db.pool,
            syllabus_id,
            armbar_id,
            coach_id,
            PropagationMode::Cascade,
        )
        .await
        .unwrap();

        let user = crate::db::get_user(&db.pool, coach_id).await.unwrap();
        let rows = db::list_for_assignment(&db.pool, assignment_id, &user)
            .await
            .unwrap();
        let armbar_sst = rows
            .iter()
            .find(|r| r.technique_id == armbar_id)
            .expect("coach sees hidden SST rows");
        assert!(armbar_sst.hidden_at.is_some());
    }

    #[rocket::async_test]
    async fn re_assign_preserves_hidden_at_on_existing_sst() {
        let (_client, db, syllabus_id, student_id, coach_id, armbar_id, _) =
            assign_syllabus_and_seed_techniques().await;

        let assignment_id = db::assign(&db.pool, coach_id, student_id, syllabus_id)
            .await
            .unwrap();
        // Manually mark armbar hidden via the cascade-remove + re-add pattern.
        db::remove_technique_from_syllabus(
            &db.pool,
            syllabus_id,
            armbar_id,
            coach_id,
            PropagationMode::Cascade,
        )
        .await
        .unwrap();
        // Soft-unassign and re-assign.
        db::unassign(&db.pool, coach_id, assignment_id)
            .await
            .unwrap();
        // Re-add armbar to the syllabus before re-assign so it's a member again.
        db::add_technique_to_syllabus(
            &db.pool,
            syllabus_id,
            armbar_id,
            coach_id,
            PropagationMode::SyllabusOnly,
        )
        .await
        .unwrap();
        let re_id = db::assign(&db.pool, coach_id, student_id, syllabus_id)
            .await
            .unwrap();
        assert_eq!(re_id, assignment_id, "Same row, re-activated");

        let user = crate::db::get_user(&db.pool, coach_id).await.unwrap();
        let rows = db::list_for_assignment(&db.pool, assignment_id, &user)
            .await
            .unwrap();
        let armbar_sst = rows.iter().find(|r| r.technique_id == armbar_id).unwrap();
        assert!(
            armbar_sst.hidden_at.is_some(),
            "hidden_at must survive re-assign"
        );
    }

    #[rocket::async_test]
    async fn unique_student_syllabus_pair_enforced() {
        let test_db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("A", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let coach_id = test_db.user_id("coach").unwrap();
        let alice = test_db.user_id("alice").unwrap();
        let syllabus_id = db::create_syllabus(&test_db.pool, "Core", None, coach_id)
            .await
            .unwrap();

        let id1 = db::assign(&test_db.pool, coach_id, alice, syllabus_id)
            .await
            .unwrap();
        let id2 = db::assign(&test_db.pool, coach_id, alice, syllabus_id)
            .await
            .unwrap();
        // Re-assigning the same active pair is a no-op (same row), proving
        // the unique constraint is honored.
        assert_eq!(id1, id2);
    }

    #[rocket::async_test]
    async fn permission_guards_block_students_from_syllabus_routes() {
        let test_db = create_standard_test_db().await;
        let (client, _db) = setup_test_client(test_db).await;

        let _ = login_test_user(&client, "student_user", "password123").await;

        let resp = client.get("/api/syllabi").dispatch().await;
        assert_eq!(resp.status(), Status::Forbidden);

        let resp = client
            .post("/api/syllabi")
            .header(ContentType::JSON)
            .body(json!({ "name": "x" }).to_string())
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Forbidden);
    }

    #[rocket::async_test]
    async fn student_sees_own_assignments_only() {
        let (client, db, syllabus_id, student_id, coach_id, _, _) =
            assign_syllabus_and_seed_techniques().await;
        let _ = db::assign(&db.pool, coach_id, student_id, syllabus_id)
            .await
            .unwrap();

        let _ = login_test_user(&client, "student_user", "password123").await;
        let resp = client
            .get(format!("/api/student/{}/syllabi", student_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);
        let body: Vec<Value> = serde_json::from_str(&resp.into_string().await.unwrap()).unwrap();
        assert_eq!(body.len(), 1);
        assert_eq!(body[0]["syllabus_id"].as_i64(), Some(syllabus_id));
    }

    #[rocket::async_test]
    async fn coach_and_status_fields_rejected_for_student_on_sst_patch() {
        let (client, db, syllabus_id, student_id, coach_id, armbar_id, _) =
            assign_syllabus_and_seed_techniques().await;
        let assignment_id = db::assign(&db.pool, coach_id, student_id, syllabus_id)
            .await
            .unwrap();
        let sst_id = db::get_sst_id(&db.pool, assignment_id, armbar_id)
            .await
            .unwrap()
            .unwrap();

        let _ = login_test_user(&client, "student_user", "password123").await;
        let resp = client
            .patch(format!("/api/student_syllabus_techniques/{}", sst_id))
            .header(ContentType::JSON)
            .body(json!({ "coach_notes": "nope" }).to_string())
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Forbidden);

        // Status is coach-controlled, so a student PATCH carrying it
        // returns 403 even if the other fields are otherwise allowed.
        let resp = client
            .patch(format!("/api/student_syllabus_techniques/{}", sst_id))
            .header(ContentType::JSON)
            .body(json!({ "status": "amber" }).to_string())
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Forbidden);

        // Student updating their own notes is fine.
        let resp = client
            .patch(format!("/api/student_syllabus_techniques/{}", sst_id))
            .header(ContentType::JSON)
            .body(json!({ "student_notes": "ok" }).to_string())
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::NoContent);
    }

    #[rocket::async_test]
    async fn syllabus_attempt_rejects_future_timestamp() {
        let (client, db, syllabus_id, student_id, coach_id, armbar_id, _) =
            assign_syllabus_and_seed_techniques().await;
        let assignment_id = db::assign(&db.pool, coach_id, student_id, syllabus_id)
            .await
            .unwrap();
        let sst_id = db::get_sst_id(&db.pool, assignment_id, armbar_id)
            .await
            .unwrap()
            .unwrap();
        let _ = login_test_user(&client, "student_user", "password123").await;
        let future = chrono::Utc::now() + chrono::Duration::days(7);
        let resp = client
            .post(format!(
                "/api/student_syllabus_techniques/{}/attempts",
                sst_id
            ))
            .header(ContentType::JSON)
            .body(json!({ "attempted_at": future.to_rfc3339() }).to_string())
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::BadRequest);
    }
}

#[cfg(test)]
mod pr4_tests {
    use rocket::http::{ContentType, Status};
    use serde_json::{Value, json};

    use crate::db;
    use crate::db::PropagationMode;
    use crate::test::test_utils::{
        TestDbBuilder, create_standard_test_db, login_test_user, setup_test_client,
    };

    async fn seed_active_assignment() -> (
        rocket::local::asynchronous::Client,
        crate::test::test_utils::TestDb,
        i64, // syllabus_id
        i64, // student_id
        i64, // coach_id
        i64, // assignment_id
        i64, // armbar sst id
    ) {
        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let student_id = test_db.user_id("student_user").unwrap();
        let armbar_id = test_db.technique_id("Armbar").unwrap();
        let syllabus_id = db::create_syllabus(&test_db.pool, "S", None, coach_id)
            .await
            .unwrap();
        db::add_technique_to_syllabus(
            &test_db.pool,
            syllabus_id,
            armbar_id,
            coach_id,
            PropagationMode::SyllabusOnly,
        )
        .await
        .unwrap();
        let assignment_id = db::assign(&test_db.pool, coach_id, student_id, syllabus_id)
            .await
            .unwrap();
        let sst_id = db::get_sst_id(&test_db.pool, assignment_id, armbar_id)
            .await
            .unwrap()
            .unwrap();
        let (client, db) = setup_test_client(test_db).await;
        (
            client,
            db,
            syllabus_id,
            student_id,
            coach_id,
            assignment_id,
            sst_id,
        )
    }

    #[rocket::async_test]
    async fn graduate_blocks_student_sst_writes() {
        let (client, db, syllabus_id, student_id, coach_id, assignment_id, sst_id) =
            seed_active_assignment().await;
        db::graduate(&db.pool, coach_id, assignment_id)
            .await
            .unwrap();
        let _ = (syllabus_id, student_id);
        let _ = login_test_user(&client, "student_user", "password123").await;

        // PATCH student_notes — student tries to write to graduated SST.
        let resp = client
            .patch(format!("/api/student_syllabus_techniques/{}", sst_id))
            .header(ContentType::JSON)
            .body(json!({ "student_notes": "nope" }).to_string())
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Forbidden);

        // POST attempt — same: 403.
        let now = chrono::Utc::now().to_rfc3339();
        let resp = client
            .post(format!(
                "/api/student_syllabus_techniques/{}/attempts",
                sst_id
            ))
            .header(ContentType::JSON)
            .body(json!({ "attempted_at": now }).to_string())
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Forbidden);
    }

    #[rocket::async_test]
    async fn graduate_lets_coach_edit() {
        let (client, db, _, _, coach_id, assignment_id, sst_id) = seed_active_assignment().await;
        db::graduate(&db.pool, coach_id, assignment_id)
            .await
            .unwrap();
        let _ = login_test_user(&client, "coach_user", "password123").await;

        let resp = client
            .patch(format!("/api/student_syllabus_techniques/{}", sst_id))
            .header(ContentType::JSON)
            .body(json!({ "coach_notes": "ok", "status": "amber" }).to_string())
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::NoContent);
    }

    #[rocket::async_test]
    async fn graduated_assignment_skipped_by_cascade_add() {
        let test_db = TestDbBuilder::new()
            .coach("coach", None)
            .student("alice", None)
            .technique("A", "", Some("coach"))
            .technique("B", "", Some("coach"))
            .build()
            .await
            .unwrap();
        let coach_id = test_db.user_id("coach").unwrap();
        let alice = test_db.user_id("alice").unwrap();
        let a_id = test_db.technique_id("A").unwrap();
        let b_id = test_db.technique_id("B").unwrap();

        let syllabus_id = db::create_syllabus(&test_db.pool, "Core", None, coach_id)
            .await
            .unwrap();
        db::add_technique_to_syllabus(
            &test_db.pool,
            syllabus_id,
            a_id,
            coach_id,
            PropagationMode::SyllabusOnly,
        )
        .await
        .unwrap();
        let assignment_id = db::assign(&test_db.pool, coach_id, alice, syllabus_id)
            .await
            .unwrap();
        db::graduate(&test_db.pool, coach_id, assignment_id)
            .await
            .unwrap();

        // Cascade-add B; alice's graduated assignment should NOT get the new SST.
        db::add_technique_to_syllabus(
            &test_db.pool,
            syllabus_id,
            b_id,
            coach_id,
            PropagationMode::Cascade,
        )
        .await
        .unwrap();
        let user = crate::db::get_user(&test_db.pool, coach_id).await.unwrap();
        let rows = db::list_for_assignment(&test_db.pool, assignment_id, &user)
            .await
            .unwrap();
        assert_eq!(
            rows.len(),
            1,
            "graduated assignment retains its frozen SST set"
        );
    }

    #[rocket::async_test]
    async fn set_hidden_toggles_sst_state() {
        let (_client, db, _, _, coach_id, _, sst_id) = seed_active_assignment().await;
        db::set_hidden(&db.pool, coach_id, sst_id, true)
            .await
            .unwrap();
        let user = crate::db::get_user(&db.pool, coach_id).await.unwrap();
        let rows =
            db::list_for_assignment(&db.pool, sst_owner_assignment(&db, sst_id).await, &user)
                .await
                .unwrap();
        let row = rows.iter().find(|r| r.id == sst_id).unwrap();
        assert!(row.hidden_at.is_some());

        db::set_hidden(&db.pool, coach_id, sst_id, false)
            .await
            .unwrap();
        let rows =
            db::list_for_assignment(&db.pool, sst_owner_assignment(&db, sst_id).await, &user)
                .await
                .unwrap();
        let row = rows.iter().find(|r| r.id == sst_id).unwrap();
        assert!(row.hidden_at.is_none());
    }

    async fn sst_owner_assignment(db: &crate::test::test_utils::TestDb, sst_id: i64) -> i64 {
        db::get_owner(&db.pool, sst_id)
            .await
            .unwrap()
            .unwrap()
            .assignment_id
    }

    #[rocket::async_test]
    async fn diff_lists_ghosts_and_missing() {
        let (_client, db, syllabus_id, _, coach_id, assignment_id, _sst_id) =
            seed_active_assignment().await;
        let triangle_id = db.technique_id("Triangle").unwrap();
        // Add Triangle to syllabus (cascade so alice gets it via the assignment).
        db::add_technique_to_syllabus(
            &db.pool,
            syllabus_id,
            triangle_id,
            coach_id,
            PropagationMode::Cascade,
        )
        .await
        .unwrap();
        // Remove Armbar from the syllabus only (so it becomes a ghost on alice's SST).
        let armbar_id = db.technique_id("Armbar").unwrap();
        db::remove_technique_from_syllabus(
            &db.pool,
            syllabus_id,
            armbar_id,
            coach_id,
            PropagationMode::SyllabusOnly,
        )
        .await
        .unwrap();
        // Hide Triangle's SST so it appears under missing too.
        let triangle_sst = db::get_sst_id(&db.pool, assignment_id, triangle_id)
            .await
            .unwrap()
            .unwrap();
        db::set_hidden(&db.pool, coach_id, triangle_sst, true)
            .await
            .unwrap();

        let diff = db::diff_for_assignment(&db.pool, assignment_id)
            .await
            .unwrap();
        assert!(
            diff.ghosts.iter().any(|g| g.technique_id == armbar_id),
            "Armbar should be a ghost: removed from syllabus, still in SST"
        );
        assert!(
            diff.missing.iter().any(|m| m.technique_id == triangle_id),
            "Triangle is in syllabus but hidden, so it appears under missing"
        );
    }

    #[rocket::async_test]
    async fn add_technique_to_assignment_unhides_existing() {
        let (_client, db, _, _, coach_id, assignment_id, sst_id) = seed_active_assignment().await;
        let armbar_id = db.technique_id("Armbar").unwrap();
        db::set_hidden(&db.pool, coach_id, sst_id, true)
            .await
            .unwrap();

        let returned =
            db::add_technique_to_assignment(&db.pool, assignment_id, armbar_id, coach_id)
                .await
                .unwrap();
        assert_eq!(returned, sst_id, "should reuse the existing SST row");

        let user = crate::db::get_user(&db.pool, coach_id).await.unwrap();
        let rows = db::list_for_assignment(&db.pool, assignment_id, &user)
            .await
            .unwrap();
        let row = rows.iter().find(|r| r.id == sst_id).unwrap();
        assert!(row.hidden_at.is_none());
    }

    #[rocket::async_test]
    async fn ungraduate_clears_columns_without_touching_sst() {
        let (_client, db, _, _, coach_id, assignment_id, sst_id) = seed_active_assignment().await;
        db::graduate(&db.pool, coach_id, assignment_id)
            .await
            .unwrap();
        db::ungraduate(&db.pool, assignment_id).await.unwrap();
        let flags = db::get_assignment_lifecycle(&db.pool, assignment_id)
            .await
            .unwrap()
            .unwrap();
        assert!(flags.graduated_at.is_none());

        // SST row is untouched (just check the row is still there).
        let owner = db::get_owner(&db.pool, sst_id).await.unwrap().unwrap();
        assert_eq!(owner.assignment_id, assignment_id);
    }

    #[rocket::async_test]
    async fn video_syllabus_visibility_upsert_and_clear() {
        let test_db = create_standard_test_db().await;
        let coach_id = test_db.user_id("coach_user").unwrap();
        let student_id = test_db.user_id("student_user").unwrap();
        let armbar_id = test_db.technique_id("Armbar").unwrap();
        let syllabus_id = db::create_syllabus(&test_db.pool, "S", None, coach_id)
            .await
            .unwrap();
        db::add_technique_to_syllabus(
            &test_db.pool,
            syllabus_id,
            armbar_id,
            coach_id,
            PropagationMode::SyllabusOnly,
        )
        .await
        .unwrap();
        let _ = db::assign(&test_db.pool, coach_id, student_id, syllabus_id)
            .await
            .unwrap();

        sqlx::query!(
            "INSERT INTO videos (technique_id, title, description, position, kind,
                                 processing_status, uploaded_by_id)
             VALUES (?, 'V', '', 0, 'external', 'ready', ?)",
            armbar_id,
            coach_id,
        )
        .execute(&test_db.pool)
        .await
        .unwrap();
        let video_id: i64 = sqlx::query_scalar("SELECT id FROM videos WHERE technique_id = ?")
            .bind(armbar_id)
            .fetch_one(&test_db.pool)
            .await
            .unwrap();

        db::set_video_syllabus_visibility(
            &test_db.pool,
            video_id,
            syllabus_id,
            student_id,
            Some(false),
            coach_id,
        )
        .await
        .unwrap();

        // After upsert: video is hidden for the student in this syllabus.
        let visible = db::list_videos_for_technique_in_syllabus_visible_to(
            &test_db.pool,
            armbar_id,
            syllabus_id,
            student_id,
        )
        .await
        .unwrap();
        assert!(visible.iter().all(|v| v.id != video_id));

        // Clearing the override falls back to the global default (visible).
        db::set_video_syllabus_visibility(
            &test_db.pool,
            video_id,
            syllabus_id,
            student_id,
            None,
            coach_id,
        )
        .await
        .unwrap();
        let visible = db::list_videos_for_technique_in_syllabus_visible_to(
            &test_db.pool,
            armbar_id,
            syllabus_id,
            student_id,
        )
        .await
        .unwrap();
        assert!(visible.iter().any(|v| v.id == video_id));
    }

    #[rocket::async_test]
    async fn apply_diff_endpoint_executes_actions() {
        let (client, db, syllabus_id, student_id, coach_id, assignment_id, _) =
            seed_active_assignment().await;
        let triangle_id = db.technique_id("Triangle").unwrap();
        db::add_technique_to_syllabus(
            &db.pool,
            syllabus_id,
            triangle_id,
            coach_id,
            PropagationMode::SyllabusOnly,
        )
        .await
        .unwrap();
        // Triangle is now missing for alice's assignment (no SST).
        let armbar_id = db.technique_id("Armbar").unwrap();
        // Remove armbar from syllabus only -> alice has it as ghost.
        db::remove_technique_from_syllabus(
            &db.pool,
            syllabus_id,
            armbar_id,
            coach_id,
            PropagationMode::SyllabusOnly,
        )
        .await
        .unwrap();
        let _ = login_test_user(&client, "coach_user", "password123").await;
        let diff = db::diff_for_assignment(&db.pool, assignment_id)
            .await
            .unwrap();
        let ghost = diff.ghosts.first().unwrap();

        let resp = client
            .post(format!(
                "/api/student/{}/syllabi/{}/assignment/diff/apply",
                student_id, syllabus_id
            ))
            .header(ContentType::JSON)
            .body(
                json!({
                    "ghost_actions": [{
                        "sst_id": ghost.sst_id,
                        "technique_id": ghost.technique_id,
                        "action": "hide_locally"
                    }],
                    "missing_actions": [{
                        "technique_id": triangle_id,
                        "action": "add_to_student"
                    }],
                })
                .to_string(),
            )
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);
        let body: Value = serde_json::from_str(&resp.into_string().await.unwrap()).unwrap();
        assert_eq!(body["applied"].as_i64(), Some(2));
    }
}
