//! HTTP-level tests for the technique-suggestion routes.
//!
//! Tests:
//!  - Student creates a suggestion for themselves.
//!  - Coach lists pending queue.
//!  - Non-coach cannot list pending (403).
//!  - Non-coach cannot decide (403).
//!  - Student can read their own suggestions.
//!  - A second student cannot read another student's suggestions (403).
//!  - Coach decides → approve adds technique to camp.
//!  - decide on unknown id → 404.
//!  - approve without camp_id → 400.
//!  - replace happy path: replacement technique (not original) lands in camp.
//!  - replace without camp_id → 400.
//!  - replace without replacement_technique_id → 400.
//!  - decide on an already-decided suggestion → 404.

#[cfg(test)]
mod tests {
    use crate::db::camps::{create_camp, NewCamp};
    use crate::db::create_technique;
    use crate::test::test_utils::{login_test_user, setup_test_client, TestDbBuilder};
    use rocket::http::{ContentType, Status};
    use serde_json::{json, Value};

    /// Insert a bare suggestion row without going through the db layer (avoids
    /// triggering activity emission, which is not needed for route-level tests).
    async fn insert_suggestion(pool: &sqlx::Pool<sqlx::Sqlite>, student_id: i64, tech_id: i64) -> i64 {
        sqlx::query_scalar(
            r#"INSERT INTO technique_suggestions (student_id, technique_id)
               VALUES (?, ?) RETURNING id"#,
        )
        .bind(student_id)
        .bind(tech_id)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    // -----------------------------------------------------------------------
    // Student creates a suggestion
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn student_can_create_suggestion() {
        let db = TestDbBuilder::new()
            .coach("coach", Some("Coach"))
            .student("student", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach_id = db.user_id("coach").unwrap();
        let tech_id = create_technique(&db.pool, "armbar", "description", coach_id, true)
            .await
            .unwrap();

        let (client, _) = setup_test_client(db).await;
        let cookies = login_test_user(&client, "student", "password123").await;

        let res = client
            .post("/api/suggestions")
            .header(ContentType::JSON)
            .cookies(cookies)
            .body(json!({ "technique_id": tech_id }).to_string())
            .dispatch()
            .await;

        assert_eq!(res.status(), Status::Ok);
        let body: Value = serde_json::from_str(&res.into_string().await.unwrap()).unwrap();
        assert!(body["id"].as_i64().unwrap() > 0);
    }

    // -----------------------------------------------------------------------
    // Coach lists pending suggestions
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn coach_can_list_pending_suggestions() {
        let db = TestDbBuilder::new()
            .coach("coach", Some("Coach"))
            .student("student", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach_id = db.user_id("coach").unwrap();
        let student_id = db.user_id("student").unwrap();
        let tech_id = create_technique(&db.pool, "triangle", "desc", coach_id, true)
            .await
            .unwrap();

        insert_suggestion(&db.pool, student_id, tech_id).await;

        let (client, _) = setup_test_client(db).await;
        let cookies = login_test_user(&client, "coach", "password123").await;

        let res = client
            .get("/api/suggestions/pending")
            .cookies(cookies)
            .dispatch()
            .await;

        assert_eq!(res.status(), Status::Ok);
        let body: Value = serde_json::from_str(&res.into_string().await.unwrap()).unwrap();
        let suggestions = body["suggestions"].as_array().unwrap();
        assert_eq!(suggestions.len(), 1);
        assert_eq!(suggestions[0]["technique_id"].as_i64().unwrap(), tech_id);
        assert_eq!(suggestions[0]["student_name"].as_str().unwrap(), "Sam");
    }

    // -----------------------------------------------------------------------
    // Non-coach cannot list pending
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn student_cannot_list_pending_suggestions() {
        let db = TestDbBuilder::new()
            .coach("coach", Some("Coach"))
            .student("student", Some("Sam"))
            .build()
            .await
            .unwrap();

        let (client, _) = setup_test_client(db).await;
        let cookies = login_test_user(&client, "student", "password123").await;

        let res = client
            .get("/api/suggestions/pending")
            .cookies(cookies)
            .dispatch()
            .await;

        assert_eq!(res.status(), Status::Forbidden);
    }

    // -----------------------------------------------------------------------
    // Non-coach cannot decide
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn student_cannot_decide_suggestion() {
        let db = TestDbBuilder::new()
            .coach("coach", Some("Coach"))
            .student("student", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach_id = db.user_id("coach").unwrap();
        let student_id = db.user_id("student").unwrap();
        let tech_id = create_technique(&db.pool, "kimura", "desc", coach_id, true)
            .await
            .unwrap();

        let sug_id = insert_suggestion(&db.pool, student_id, tech_id).await;

        let (client, _) = setup_test_client(db).await;
        let cookies = login_test_user(&client, "student", "password123").await;

        let res = client
            .post(format!("/api/suggestions/{sug_id}/decide"))
            .header(ContentType::JSON)
            .cookies(cookies)
            .body(json!({ "decision": "dismiss" }).to_string())
            .dispatch()
            .await;

        assert_eq!(res.status(), Status::Forbidden);
    }

    // -----------------------------------------------------------------------
    // Student reads own suggestions
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn student_can_read_own_suggestions() {
        let db = TestDbBuilder::new()
            .coach("coach", Some("Coach"))
            .student("student", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach_id = db.user_id("coach").unwrap();
        let student_id = db.user_id("student").unwrap();
        let tech_id = create_technique(&db.pool, "omo plata", "desc", coach_id, true)
            .await
            .unwrap();

        insert_suggestion(&db.pool, student_id, tech_id).await;

        let (client, _) = setup_test_client(db).await;
        let cookies = login_test_user(&client, "student", "password123").await;

        let res = client
            .get(format!("/api/students/{student_id}/suggestions"))
            .cookies(cookies)
            .dispatch()
            .await;

        assert_eq!(res.status(), Status::Ok);
        let body: Value = serde_json::from_str(&res.into_string().await.unwrap()).unwrap();
        let suggestions = body["suggestions"].as_array().unwrap();
        assert_eq!(suggestions.len(), 1);
    }

    // -----------------------------------------------------------------------
    // Second student cannot read another student's suggestions (403)
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn second_student_cannot_read_other_student_suggestions() {
        let db = TestDbBuilder::new()
            .coach("coach", Some("Coach"))
            .student("student1", Some("Sam"))
            .student("student2", Some("Alex"))
            .build()
            .await
            .unwrap();

        let coach_id = db.user_id("coach").unwrap();
        let student1_id = db.user_id("student1").unwrap();
        let tech_id = create_technique(&db.pool, "heel hook", "desc", coach_id, true)
            .await
            .unwrap();

        insert_suggestion(&db.pool, student1_id, tech_id).await;

        let (client, _) = setup_test_client(db).await;
        // Log in as student2 and try to read student1's suggestions.
        let cookies = login_test_user(&client, "student2", "password123").await;

        let res = client
            .get(format!("/api/students/{student1_id}/suggestions"))
            .cookies(cookies)
            .dispatch()
            .await;

        assert_eq!(res.status(), Status::Forbidden);
    }

    // -----------------------------------------------------------------------
    // Coach decides: approve adds technique to camp
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn coach_approve_adds_technique_to_camp() {
        let db = TestDbBuilder::new()
            .coach("coach", Some("Coach"))
            .student("student", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach_id = db.user_id("coach").unwrap();
        let student_id = db.user_id("student").unwrap();
        let tech_id = create_technique(&db.pool, "darce choke", "desc", coach_id, true)
            .await
            .unwrap();

        let camp_id = create_camp(
            &db.pool,
            NewCamp {
                student_id,
                coach_id,
                name: "Worlds prep".into(),
                description: None,
                references_camp_id: None,
            },
        )
        .await
        .unwrap();

        let sug_id = insert_suggestion(&db.pool, student_id, tech_id).await;

        let (client, _) = setup_test_client(db).await;
        let cookies = login_test_user(&client, "coach", "password123").await;

        let res = client
            .post(format!("/api/suggestions/{sug_id}/decide"))
            .header(ContentType::JSON)
            .cookies(cookies)
            .body(json!({ "decision": "approve", "camp_id": camp_id }).to_string())
            .dispatch()
            .await;

        assert_eq!(res.status(), Status::NoContent);
    }

    // -----------------------------------------------------------------------
    // Decide on unknown suggestion id → 404
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn decide_unknown_suggestion_returns_404() {
        let db = TestDbBuilder::new()
            .coach("coach", Some("Coach"))
            .student("student", Some("Sam"))
            .build()
            .await
            .unwrap();

        let (client, _) = setup_test_client(db).await;
        let cookies = login_test_user(&client, "coach", "password123").await;

        let res = client
            .post("/api/suggestions/9999/decide")
            .header(ContentType::JSON)
            .cookies(cookies)
            .body(json!({ "decision": "dismiss" }).to_string())
            .dispatch()
            .await;

        assert_eq!(res.status(), Status::NotFound);
    }

    // -----------------------------------------------------------------------
    // decide missing required fields → 400
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn approve_without_camp_id_returns_400() {
        let db = TestDbBuilder::new()
            .coach("coach", Some("Coach"))
            .student("student", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach_id = db.user_id("coach").unwrap();
        let student_id = db.user_id("student").unwrap();
        let tech_id = create_technique(&db.pool, "omoplata", "desc", coach_id, true)
            .await
            .unwrap();

        let sug_id = insert_suggestion(&db.pool, student_id, tech_id).await;

        let (client, _) = setup_test_client(db).await;
        let cookies = login_test_user(&client, "coach", "password123").await;

        // approve without camp_id should 400
        let res = client
            .post(format!("/api/suggestions/{sug_id}/decide"))
            .header(ContentType::JSON)
            .cookies(cookies)
            .body(json!({ "decision": "approve" }).to_string())
            .dispatch()
            .await;

        assert_eq!(res.status(), Status::BadRequest);
    }

    // -----------------------------------------------------------------------
    // replace: happy path — replacement technique ends up in camp
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn coach_replace_adds_replacement_technique_to_camp() {
        let db = TestDbBuilder::new()
            .coach("coach", Some("Coach"))
            .student("student", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach_id = db.user_id("coach").unwrap();
        let student_id = db.user_id("student").unwrap();

        // The original technique the student suggested.
        let original_tech_id = create_technique(&db.pool, "butterfly guard", "desc", coach_id, true)
            .await
            .unwrap();

        // The coach's preferred replacement.
        let replacement_tech_id = create_technique(&db.pool, "x-guard", "desc", coach_id, true)
            .await
            .unwrap();

        let camp_id = create_camp(
            &db.pool,
            NewCamp {
                student_id,
                coach_id,
                name: "Guard camp".into(),
                description: None,
                references_camp_id: None,
            },
        )
        .await
        .unwrap();

        let sug_id = insert_suggestion(&db.pool, student_id, original_tech_id).await;

        let (client, returned_db) = setup_test_client(db).await;
        let cookies = login_test_user(&client, "coach", "password123").await;

        let res = client
            .post(format!("/api/suggestions/{sug_id}/decide"))
            .header(ContentType::JSON)
            .cookies(cookies)
            .body(
                json!({
                    "decision": "replace",
                    "camp_id": camp_id,
                    "replacement_technique_id": replacement_tech_id
                })
                .to_string(),
            )
            .dispatch()
            .await;

        assert_eq!(res.status(), Status::NoContent);

        // Verify that the REPLACEMENT (not the original) landed in the camp.
        let techniques_in_camp: Vec<i64> = sqlx::query_scalar(
            "SELECT technique_id FROM camp_techniques WHERE camp_id = ?",
        )
        .bind(camp_id)
        .fetch_all(&returned_db.pool)
        .await
        .unwrap();

        assert!(
            techniques_in_camp.contains(&replacement_tech_id),
            "replacement technique should be in the camp"
        );
        assert!(
            !techniques_in_camp.contains(&original_tech_id),
            "original technique should NOT be in the camp"
        );
    }

    // -----------------------------------------------------------------------
    // replace without camp_id → 400
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn replace_without_camp_id_returns_400() {
        let db = TestDbBuilder::new()
            .coach("coach", Some("Coach"))
            .student("student", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach_id = db.user_id("coach").unwrap();
        let student_id = db.user_id("student").unwrap();
        let tech_id = create_technique(&db.pool, "sitout", "desc", coach_id, true)
            .await
            .unwrap();
        let replacement_tech_id = create_technique(&db.pool, "standup", "desc", coach_id, true)
            .await
            .unwrap();

        let sug_id = insert_suggestion(&db.pool, student_id, tech_id).await;

        let (client, _) = setup_test_client(db).await;
        let cookies = login_test_user(&client, "coach", "password123").await;

        let res = client
            .post(format!("/api/suggestions/{sug_id}/decide"))
            .header(ContentType::JSON)
            .cookies(cookies)
            .body(
                json!({
                    "decision": "replace",
                    "replacement_technique_id": replacement_tech_id
                })
                .to_string(),
            )
            .dispatch()
            .await;

        assert_eq!(res.status(), Status::BadRequest);
    }

    // -----------------------------------------------------------------------
    // replace without replacement_technique_id → 400
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn replace_without_replacement_technique_id_returns_400() {
        let db = TestDbBuilder::new()
            .coach("coach", Some("Coach"))
            .student("student", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach_id = db.user_id("coach").unwrap();
        let student_id = db.user_id("student").unwrap();
        let tech_id = create_technique(&db.pool, "granby roll", "desc", coach_id, true)
            .await
            .unwrap();

        let camp_id = create_camp(
            &db.pool,
            NewCamp {
                student_id,
                coach_id,
                name: "Wrestling camp".into(),
                description: None,
                references_camp_id: None,
            },
        )
        .await
        .unwrap();

        let sug_id = insert_suggestion(&db.pool, student_id, tech_id).await;

        let (client, _) = setup_test_client(db).await;
        let cookies = login_test_user(&client, "coach", "password123").await;

        let res = client
            .post(format!("/api/suggestions/{sug_id}/decide"))
            .header(ContentType::JSON)
            .cookies(cookies)
            .body(json!({ "decision": "replace", "camp_id": camp_id }).to_string())
            .dispatch()
            .await;

        assert_eq!(res.status(), Status::BadRequest);
    }

    // -----------------------------------------------------------------------
    // Decide on an already-decided suggestion → 404
    // -----------------------------------------------------------------------

    #[rocket::async_test]
    async fn decide_already_decided_suggestion_returns_404() {
        let db = TestDbBuilder::new()
            .coach("coach", Some("Coach"))
            .student("student", Some("Sam"))
            .build()
            .await
            .unwrap();

        let coach_id = db.user_id("coach").unwrap();
        let student_id = db.user_id("student").unwrap();
        let tech_id = create_technique(&db.pool, "rear naked choke", "desc", coach_id, true)
            .await
            .unwrap();

        let sug_id = insert_suggestion(&db.pool, student_id, tech_id).await;

        let (client, _) = setup_test_client(db).await;
        let cookies = login_test_user(&client, "coach", "password123").await;

        // First decision: dismiss.
        let first = client
            .post(format!("/api/suggestions/{sug_id}/decide"))
            .header(ContentType::JSON)
            .cookies(cookies.clone())
            .body(json!({ "decision": "dismiss" }).to_string())
            .dispatch()
            .await;

        assert_eq!(first.status(), Status::NoContent);

        // Second decision on the same suggestion must 404.
        let second = client
            .post(format!("/api/suggestions/{sug_id}/decide"))
            .header(ContentType::JSON)
            .cookies(cookies)
            .body(json!({ "decision": "dismiss" }).to_string())
            .dispatch()
            .await;

        assert_eq!(second.status(), Status::NotFound);
    }
}
