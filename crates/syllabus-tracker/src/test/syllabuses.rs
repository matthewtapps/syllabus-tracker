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

        let resp = client.get("/api/syllabuses").dispatch().await;
        assert_eq!(resp.status(), Status::Forbidden);

        let resp = client
            .post("/api/syllabuses")
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
            .get(format!("/api/student/{}/syllabuses", student_id))
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);
        let body: Vec<Value> =
            serde_json::from_str(&resp.into_string().await.unwrap()).unwrap();
        assert_eq!(body.len(), 1);
        assert_eq!(body[0]["syllabus_id"].as_i64(), Some(syllabus_id));
    }

    #[rocket::async_test]
    async fn coach_notes_field_rejected_for_student_on_sst_patch() {
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

        // Student updating their own notes is fine.
        let resp = client
            .patch(format!("/api/student_syllabus_techniques/{}", sst_id))
            .header(ContentType::JSON)
            .body(json!({ "student_notes": "ok", "status": "amber" }).to_string())
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
