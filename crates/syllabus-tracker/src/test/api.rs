use rocket::http::{ContentType, Status};
use serde_json::json;

use crate::{
    api::TagsResponse,
    test::test_utils::{create_standard_test_db, login_test_user, setup_test_client},
};

#[cfg(test)]
mod tests {
    use crate::api::{LoginResponse, StudentTechniquesResponse, UserData};
    use crate::db::get_student_technique;
    use crate::test::test_utils::{
        TestDbBuilder, create_standard_test_db, login_test_user, setup_test_client,
    };
    use rocket::http::{ContentType, Cookie, Status};
    use serde_json::json;

    #[rocket::async_test]
    async fn test_login_api() {
        let test_db = create_standard_test_db().await;
        let (client, _) = setup_test_client(test_db).await;

        let response = client
            .post("/api/login")
            .header(ContentType::JSON)
            .body(
                json!({
                    "username": "coach_user",
                    "password": "password123"
                })
                .to_string(),
            )
            .dispatch()
            .await;

        assert_eq!(response.status(), Status::Ok);

        let body = response.into_string().await.unwrap();
        let login_response: LoginResponse = serde_json::from_str(&body).unwrap();

        assert!(login_response.success);
        assert!(login_response.user.is_some());
        assert_eq!(login_response.user.unwrap().username, "coach_user");

        let response = client
            .post("/api/login")
            .header(ContentType::JSON)
            .body(
                json!({
                    "username": "coach_user",
                    "password": "wrong_password"
                })
                .to_string(),
            )
            .dispatch()
            .await;

        assert_eq!(response.status(), Status::Ok);

        let body = response.into_string().await.unwrap();
        let login_response: LoginResponse = serde_json::from_str(&body).unwrap();

        assert!(!login_response.success);
        assert!(login_response.error.is_some());
    }

    #[rocket::async_test]
    async fn test_auth_required_apis() {
        let test_db = create_standard_test_db().await;
        let (client, _) = setup_test_client(test_db).await;

        let endpoints = vec!["/api/me", "/api/students", "/api/student/1/techniques"];

        for endpoint in endpoints {
            let response = client.get(endpoint).dispatch().await;
            assert!(
                response.status() == Status::Unauthorized || response.status() == Status::SeeOther,
                "Endpoint {} did not require authentication",
                endpoint
            );
        }
    }

    #[rocket::async_test]
    async fn test_api_session_security() {
        let test_db = create_standard_test_db().await;
        let (client, _) = setup_test_client(test_db).await;

        let forged_cookie = Cookie::build(("session_token", "fake_token")).build();

        let response = client
            .get("/api/me")
            .private_cookie(forged_cookie)
            .dispatch()
            .await;

        println!("response status: {:?}", response.status());

        assert!(
            response.status() == Status::Unauthorized
                || response.status() == Status::SeeOther
                || response.status() == Status::Forbidden,
            "Forged session token was accepted"
        );

        let cookies = login_test_user(&client, "coach_user", "password123").await;

        let response = client.get("/api/me").cookies(cookies).dispatch().await;

        assert_eq!(response.status(), Status::Ok);
    }

    #[rocket::async_test]
    async fn test_me_api() {
        let test_db = create_standard_test_db().await;
        let (client, _) = setup_test_client(test_db).await;

        let cookies = login_test_user(&client, "coach_user", "password123").await;

        let response = client.get("/api/me").cookies(cookies).dispatch().await;

        assert_eq!(response.status(), Status::Ok);

        let body = response.into_string().await.unwrap();
        let user_data: UserData = serde_json::from_str(&body).unwrap();

        assert_eq!(user_data.username, "coach_user");
        assert_eq!(user_data.display_name, "Coach User");
        assert_eq!(user_data.role.to_lowercase(), "coach");
    }

    #[rocket::async_test]
    async fn test_students_api() {
        let test_db = create_standard_test_db().await;
        let (client, _) = setup_test_client(test_db).await;

        let cookies = login_test_user(&client, "coach_user", "password123").await;

        let response = client
            .get("/api/students")
            .cookies(cookies)
            .dispatch()
            .await;

        assert_eq!(response.status(), Status::Ok);

        let body = response.into_string().await.unwrap();
        let students: Vec<UserData> = serde_json::from_str(&body).unwrap();

        let student_exists = students.iter().any(|s| s.username == "student_user");
        assert!(student_exists, "student_user not found in students list");

        let student = students
            .iter()
            .find(|s| s.username == "student_user")
            .unwrap();

        println!("students: {:?}, student: {:?}", students, student);
        assert_eq!(student.display_name, "Student User");
        assert_eq!(student.role.to_lowercase(), "student");
    }

    #[rocket::async_test]
    async fn test_student_techniques_api() {
        let test_db = create_standard_test_db().await;
        let (client, test_db) = setup_test_client(test_db).await;

        let student_id = test_db.user_id("student_user").expect("Student not found");

        let cookies = login_test_user(&client, "coach_user", "password123").await;

        let response = client
            .get(format!("/api/student/{}/techniques", student_id))
            .cookies(cookies)
            .dispatch()
            .await;

        assert_eq!(response.status(), Status::Ok);

        let body = response.into_string().await.unwrap();
        let data: StudentTechniquesResponse = serde_json::from_str(&body).unwrap();

        assert_eq!(data.student.username, "student_user");
        assert!(!data.techniques.is_empty(), "No techniques found");

        let technique = &data.techniques[0];
        assert_eq!(technique.technique_name, "Armbar");
        assert_eq!(technique.status, "red");
        assert_eq!(technique.student_notes, "Student notes");
    }

    #[rocket::async_test]
    async fn test_update_technique_api() {
        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .student("student_user", Some("Student User"))
            .technique("Armbar", "Description of armbar", Some("coach_user"))
            .assign_technique(
                Some("Armbar"),
                Some("student_user"),
                "red",
                "Initial notes",
                "Initial coach notes",
            )
            .build()
            .await
            .expect("Failed to build test DB");

        let (client, test_db) = setup_test_client(test_db).await;

        let student_technique_id = test_db
            .student_technique_id("student_user", "Armbar")
            .await
            .expect("Failed to get student technique id");

        let cookies = login_test_user(&client, "coach_user", "password123").await;

        let response = client
            .put(format!("/api/student_technique/{}", student_technique_id))
            .cookies(cookies)
            .header(ContentType::JSON)
            .body(
                json!({
                    "status": "green",
                    "coach_notes": "Updated coach notes",
                    "student_notes": "Updated student notes"
                })
                .to_string(),
            )
            .dispatch()
            .await;

        assert_eq!(response.status(), Status::Ok);

        let updated_technique = get_student_technique(&test_db.pool, student_technique_id, 0)
            .await
            .expect("Failed to get student technique");

        assert_eq!(updated_technique.status, "green");
        assert_eq!(updated_technique.coach_notes, "Updated coach notes");
        assert_eq!(updated_technique.student_notes, "Updated student notes");
    }

    #[rocket::async_test]
    async fn test_assign_techniques_api() {
        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .student("student_user", Some("Student User"))
            .technique("Armbar", "Description of armbar", Some("coach_user"))
            .technique("Triangle", "Description of triangle", Some("coach_user"))
            .build()
            .await
            .expect("Failed to build test DB");

        let (client, test_db) = setup_test_client(test_db).await;

        let student_id = test_db.user_id("student_user").expect("Student not found");
        let technique_id = test_db
            .technique_id("Triangle")
            .expect("Technique not found");

        let cookies = login_test_user(&client, "coach_user", "password123").await;

        let response = client
            .post(format!("/api/student/{}/add_techniques", student_id))
            .cookies(cookies.clone())
            .header(ContentType::JSON)
            .body(
                json!({
                    "technique_ids": [technique_id]
                })
                .to_string(),
            )
            .dispatch()
            .await;

        assert_eq!(response.status(), Status::Ok);

        let techniques_response = client
            .get(format!("/api/student/{}/techniques", student_id))
            .cookies(cookies)
            .dispatch()
            .await;

        let body = techniques_response.into_string().await.unwrap();
        let data: StudentTechniquesResponse = serde_json::from_str(&body).unwrap();

        let has_triangle = data
            .techniques
            .iter()
            .any(|t| t.technique_name == "Triangle");

        assert!(has_triangle, "Triangle technique was not assigned");
    }

    #[rocket::async_test]
    async fn test_coach_update_bumps_coach_columns() {
        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .student("student_user", Some("Student User"))
            .technique("Armbar", "Description of armbar", Some("coach_user"))
            .assign_technique(Some("Armbar"), Some("student_user"), "red", "", "")
            .build()
            .await
            .expect("Failed to build test DB");

        let pool = test_db.pool.clone();
        let (client, test_db) = setup_test_client(test_db).await;
        let student_technique_id = test_db
            .student_technique_id("student_user", "Armbar")
            .await
            .expect("Failed to get student technique id");
        let coach_id = test_db.user_id("coach_user").expect("Coach not found");

        let cookies = login_test_user(&client, "coach_user", "password123").await;
        let response = client
            .put(format!("/api/student_technique/{}", student_technique_id))
            .cookies(cookies)
            .header(ContentType::JSON)
            .body(json!({ "status": "amber" }).to_string())
            .dispatch()
            .await;
        assert_eq!(response.status(), Status::Ok);

        let updated = get_student_technique(&pool, student_technique_id, 0)
            .await
            .expect("Failed to fetch updated technique");

        assert!(
            updated.last_coach_update_at.is_some(),
            "last_coach_update_at should be set after coach update"
        );
        assert_eq!(updated.last_coach_update_by_id, Some(coach_id));
        assert!(
            updated.last_student_update_at.is_none(),
            "last_student_update_at should remain unset after coach update"
        );
    }

    #[rocket::async_test]
    async fn test_student_update_bumps_student_columns() {
        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .student("student_user", Some("Student User"))
            .technique("Armbar", "Description of armbar", Some("coach_user"))
            .assign_technique(Some("Armbar"), Some("student_user"), "red", "", "")
            .build()
            .await
            .expect("Failed to build test DB");

        let pool = test_db.pool.clone();
        let (client, test_db) = setup_test_client(test_db).await;
        let student_technique_id = test_db
            .student_technique_id("student_user", "Armbar")
            .await
            .expect("Failed to get student technique id");
        let student_id = test_db.user_id("student_user").expect("Student not found");

        // Snapshot the coach timestamp set by the initial assignment so we can
        // assert the student edit does not overwrite it.
        let before = get_student_technique(&pool, student_technique_id, 0)
            .await
            .expect("Failed to fetch baseline");
        let coach_stamp_before = before.last_coach_update_at;

        let cookies = login_test_user(&client, "student_user", "password123").await;
        let response = client
            .put(format!("/api/student_technique/{}", student_technique_id))
            .cookies(cookies)
            .header(ContentType::JSON)
            .body(json!({ "student_notes": "I worked on this today" }).to_string())
            .dispatch()
            .await;
        assert_eq!(response.status(), Status::Ok);

        let updated = get_student_technique(&pool, student_technique_id, 0)
            .await
            .expect("Failed to fetch updated technique");

        assert!(
            updated.last_student_update_at.is_some(),
            "last_student_update_at should be set after student update"
        );
        assert_eq!(updated.last_student_update_by_id, Some(student_id));
        assert_eq!(
            updated.last_coach_update_at, coach_stamp_before,
            "student-only update should not touch last_coach_update_at"
        );
    }

    #[rocket::async_test]
    async fn test_has_unseen_activity_coach_view_after_student_edit() {
        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .student("student_user", Some("Student User"))
            .technique("Armbar", "Description of armbar", Some("coach_user"))
            .assign_technique(Some("Armbar"), Some("student_user"), "red", "", "")
            .build()
            .await
            .expect("Failed to build test DB");

        let (client, test_db) = setup_test_client(test_db).await;
        let student_id = test_db.user_id("student_user").expect("Student not found");
        let student_technique_id = test_db
            .student_technique_id("student_user", "Armbar")
            .await
            .expect("Failed to get student technique id");

        // Coach edits first, then student edits after.
        let coach_cookies = login_test_user(&client, "coach_user", "password123").await;
        client
            .put(format!("/api/student_technique/{}", student_technique_id))
            .cookies(coach_cookies.clone())
            .header(ContentType::JSON)
            .body(json!({ "status": "amber" }).to_string())
            .dispatch()
            .await;

        let student_cookies = login_test_user(&client, "student_user", "password123").await;
        client
            .put(format!("/api/student_technique/{}", student_technique_id))
            .cookies(student_cookies)
            .header(ContentType::JSON)
            .body(json!({ "student_notes": "post-coach edit" }).to_string())
            .dispatch()
            .await;

        // Fetch as coach and check the flag.
        let response = client
            .get(format!("/api/student/{}/techniques", student_id))
            .cookies(coach_cookies)
            .dispatch()
            .await;
        assert_eq!(response.status(), Status::Ok);
        let body = response.into_string().await.unwrap();
        let data: StudentTechniquesResponse = serde_json::from_str(&body).unwrap();
        let t = data
            .techniques
            .iter()
            .find(|t| t.id == student_technique_id)
            .expect("technique missing from response");

        assert!(
            t.has_unseen_activity,
            "expected has_unseen_activity=true when student edited and coach hasn't looked since"
        );
        assert!(t.last_coach_update_at.is_some());
        assert!(t.last_student_update_at.is_some());
        assert_eq!(t.last_coach_update_by_name.as_deref(), Some("Coach User"));
        assert_eq!(t.last_student_update_by_name.as_deref(), Some("Student User"));
    }

    /// Helper: fetch the techniques list as the given user and pull out the
    /// flag for a specific student_technique id.
    async fn fetch_unseen_flag(
        client: &rocket::local::asynchronous::Client,
        cookies: Vec<Cookie<'static>>,
        student_id: i64,
        student_technique_id: i64,
    ) -> bool {
        let response = client
            .get(format!("/api/student/{}/techniques", student_id))
            .cookies(cookies)
            .dispatch()
            .await;
        assert_eq!(response.status(), Status::Ok);
        let body = response.into_string().await.unwrap();
        let data: StudentTechniquesResponse = serde_json::from_str(&body).unwrap();
        data.techniques
            .iter()
            .find(|t| t.id == student_technique_id)
            .expect("technique missing from response")
            .has_unseen_activity
    }

    #[rocket::async_test]
    async fn test_student_does_not_see_dot_for_own_edits() {
        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .student("student_user", Some("Student User"))
            .technique("Armbar", "desc", Some("coach_user"))
            .assign_technique(Some("Armbar"), Some("student_user"), "red", "", "")
            .build()
            .await
            .expect("Failed to build test DB");

        let (client, test_db) = setup_test_client(test_db).await;
        let student_id = test_db.user_id("student_user").expect("Student not found");
        let st_id = test_db
            .student_technique_id("student_user", "Armbar")
            .await
            .expect("Failed to get id");

        // Clear the assignment-time coach activity by marking it seen as the
        // student, then verify a student-only edit does not re-light the dot.
        let student_cookies = login_test_user(&client, "student_user", "password123").await;
        client
            .post(format!("/api/student_technique/{}/mark_seen", st_id))
            .cookies(student_cookies.clone())
            .dispatch()
            .await;

        client
            .put(format!("/api/student_technique/{}", st_id))
            .cookies(student_cookies.clone())
            .header(ContentType::JSON)
            .body(json!({ "student_notes": "my own note" }).to_string())
            .dispatch()
            .await;

        let flag =
            fetch_unseen_flag(&client, student_cookies, student_id, st_id).await;
        assert!(!flag, "student should not see a dot for their own edit");
    }

    #[rocket::async_test]
    async fn test_student_sees_dot_for_coach_edit_cleared_by_mark_seen() {
        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .student("student_user", Some("Student User"))
            .technique("Armbar", "desc", Some("coach_user"))
            .assign_technique(Some("Armbar"), Some("student_user"), "red", "", "")
            .build()
            .await
            .expect("Failed to build test DB");

        let (client, test_db) = setup_test_client(test_db).await;
        let student_id = test_db.user_id("student_user").expect("Student not found");
        let st_id = test_db
            .student_technique_id("student_user", "Armbar")
            .await
            .expect("Failed to get id");

        // Student starts fresh, marks the assignment as seen.
        let student_cookies = login_test_user(&client, "student_user", "password123").await;
        client
            .post(format!("/api/student_technique/{}/mark_seen", st_id))
            .cookies(student_cookies.clone())
            .dispatch()
            .await;
        assert!(
            !fetch_unseen_flag(&client, student_cookies.clone(), student_id, st_id).await,
            "no dot after student marked seen"
        );

        // Coach edits → student should now see a dot.
        let coach_cookies = login_test_user(&client, "coach_user", "password123").await;
        // Sleep so the new coach timestamp is strictly later than seen_at.
        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
        client
            .put(format!("/api/student_technique/{}", st_id))
            .cookies(coach_cookies.clone())
            .header(ContentType::JSON)
            .body(json!({ "coach_notes": "try this grip" }).to_string())
            .dispatch()
            .await;

        assert!(
            fetch_unseen_flag(&client, student_cookies.clone(), student_id, st_id).await,
            "student should see a dot after coach edit"
        );

        // Student opens the row (mark_seen) → dot clears.
        client
            .post(format!("/api/student_technique/{}/mark_seen", st_id))
            .cookies(student_cookies.clone())
            .dispatch()
            .await;
        assert!(
            !fetch_unseen_flag(&client, student_cookies, student_id, st_id).await,
            "student's dot should clear after mark_seen"
        );
    }

    #[rocket::async_test]
    async fn test_coach_sees_dot_for_student_edit_cleared_by_mark_seen() {
        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .student("student_user", Some("Student User"))
            .technique("Armbar", "desc", Some("coach_user"))
            .assign_technique(Some("Armbar"), Some("student_user"), "red", "", "")
            .build()
            .await
            .expect("Failed to build test DB");

        let (client, test_db) = setup_test_client(test_db).await;
        let student_id = test_db.user_id("student_user").expect("Student not found");
        let st_id = test_db
            .student_technique_id("student_user", "Armbar")
            .await
            .expect("Failed to get id");

        // No coach has ever looked, no student edit yet → no dot for the coach.
        let coach_cookies = login_test_user(&client, "coach_user", "password123").await;
        assert!(
            !fetch_unseen_flag(&client, coach_cookies.clone(), student_id, st_id).await,
            "no dot for coach before any student activity"
        );

        // Student edits.
        let student_cookies = login_test_user(&client, "student_user", "password123").await;
        client
            .put(format!("/api/student_technique/{}", st_id))
            .cookies(student_cookies)
            .header(ContentType::JSON)
            .body(json!({ "student_notes": "progress!" }).to_string())
            .dispatch()
            .await;

        assert!(
            fetch_unseen_flag(&client, coach_cookies.clone(), student_id, st_id).await,
            "coach should see a dot after student edit"
        );

        // Coach marks seen → dot clears.
        client
            .post(format!("/api/student_technique/{}/mark_seen", st_id))
            .cookies(coach_cookies.clone())
            .dispatch()
            .await;
        assert!(
            !fetch_unseen_flag(&client, coach_cookies, student_id, st_id).await,
            "coach's dot should clear after mark_seen"
        );
    }

    #[rocket::async_test]
    async fn test_mark_seen_is_per_coach() {
        let test_db = TestDbBuilder::new()
            .coach("coach_a", Some("Coach A"))
            .coach("coach_b", Some("Coach B"))
            .student("student_user", Some("Student User"))
            .technique("Armbar", "desc", Some("coach_a"))
            .assign_technique(Some("Armbar"), Some("student_user"), "red", "", "")
            .build()
            .await
            .expect("Failed to build test DB");

        let (client, test_db) = setup_test_client(test_db).await;
        let student_id = test_db.user_id("student_user").expect("Student not found");
        let st_id = test_db
            .student_technique_id("student_user", "Armbar")
            .await
            .expect("Failed to get id");

        // Student creates new activity.
        let student_cookies = login_test_user(&client, "student_user", "password123").await;
        client
            .put(format!("/api/student_technique/{}", st_id))
            .cookies(student_cookies)
            .header(ContentType::JSON)
            .body(json!({ "student_notes": "progress!" }).to_string())
            .dispatch()
            .await;

        let coach_a_cookies = login_test_user(&client, "coach_a", "password123").await;
        let coach_b_cookies = login_test_user(&client, "coach_b", "password123").await;

        // Both coaches see the dot.
        assert!(fetch_unseen_flag(&client, coach_a_cookies.clone(), student_id, st_id).await);
        assert!(fetch_unseen_flag(&client, coach_b_cookies.clone(), student_id, st_id).await);

        // Coach A marks seen.
        client
            .post(format!("/api/student_technique/{}/mark_seen", st_id))
            .cookies(coach_a_cookies.clone())
            .dispatch()
            .await;

        // Coach A's dot is cleared; coach B still sees one.
        assert!(
            !fetch_unseen_flag(&client, coach_a_cookies, student_id, st_id).await,
            "coach A should no longer see the dot"
        );
        assert!(
            fetch_unseen_flag(&client, coach_b_cookies, student_id, st_id).await,
            "coach B should still see the dot"
        );
    }

    #[rocket::async_test]
    async fn test_brand_new_assignment_dots_for_student() {
        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .student("student_user", Some("Student User"))
            .technique("Armbar", "desc", Some("coach_user"))
            .assign_technique(Some("Armbar"), Some("student_user"), "red", "", "")
            .build()
            .await
            .expect("Failed to build test DB");

        let (client, test_db) = setup_test_client(test_db).await;
        let student_id = test_db.user_id("student_user").expect("Student not found");
        let st_id = test_db
            .student_technique_id("student_user", "Armbar")
            .await
            .expect("Failed to get id");

        // Fresh student has never opened the row → assignment-time coach
        // activity surfaces as a dot.
        let student_cookies = login_test_user(&client, "student_user", "password123").await;
        assert!(
            fetch_unseen_flag(&client, student_cookies, student_id, st_id).await,
            "student should see a dot on a brand-new assignment"
        );
    }

    /// Helper: fetch `/api/students` as the given coach, return the parsed
    /// `last_student_initiative_at` (chrono) for one student. None if absent.
    async fn fetch_initiative(
        client: &rocket::local::asynchronous::Client,
        cookies: Vec<Cookie<'static>>,
        student_username: &str,
    ) -> Option<chrono::DateTime<chrono::Utc>> {
        let response = client
            .get("/api/students")
            .cookies(cookies)
            .dispatch()
            .await;
        assert_eq!(response.status(), Status::Ok);
        let body = response.into_string().await.unwrap();
        let students: Vec<UserData> = serde_json::from_str(&body).unwrap();
        let s = students
            .iter()
            .find(|s| s.username == student_username)
            .expect("student missing from response");
        s.last_student_initiative_at
            .as_deref()
            .map(|raw| chrono::DateTime::parse_from_rfc3339(raw).unwrap().to_utc())
    }

    #[rocket::async_test]
    async fn test_taking_initiative_recent_student_note_update() {
        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .student("student_user", Some("Student User"))
            .technique("Armbar", "desc", Some("coach_user"))
            .assign_technique(Some("Armbar"), Some("student_user"), "red", "", "")
            .build()
            .await
            .expect("Failed to build test DB");

        let (client, test_db) = setup_test_client(test_db).await;
        let st_id = test_db
            .student_technique_id("student_user", "Armbar")
            .await
            .expect("Failed to get id");

        let before = chrono::Utc::now();
        let student_cookies = login_test_user(&client, "student_user", "password123").await;
        let resp = client
            .put(format!("/api/student_technique/{}", st_id))
            .cookies(student_cookies)
            .header(ContentType::JSON)
            .body(json!({ "student_notes": "drilled this morning" }).to_string())
            .dispatch()
            .await;
        assert_eq!(resp.status(), Status::Ok);

        let coach_cookies = login_test_user(&client, "coach_user", "password123").await;
        let initiative = fetch_initiative(&client, coach_cookies, "student_user")
            .await
            .expect("expected last_student_initiative_at to be set after student note edit");
        assert!(
            initiative >= before - chrono::Duration::seconds(5),
            "initiative timestamp {} should be at or after test start {}",
            initiative,
            before
        );
    }

    #[rocket::async_test]
    async fn test_taking_initiative_recent_watch() {
        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .student("student_user", Some("Student User"))
            .technique("Armbar", "desc", Some("coach_user"))
            .assign_technique(Some("Armbar"), Some("student_user"), "red", "", "")
            .build()
            .await
            .expect("Failed to build test DB");

        let pool = test_db.pool.clone();
        let (client, test_db) = setup_test_client(test_db).await;
        let student_id = test_db.user_id("student_user").expect("Student not found");
        let technique_id = test_db.technique_id("Armbar").expect("Technique not found");

        // Direct inserts: a video row plus a watch aggregate timestamped now.
        let watched_at = chrono::Utc::now().naive_utc();
        let video_id: i64 = sqlx::query_scalar!(
            r#"INSERT INTO videos (technique_id, parent_kind, parent_id, title, kind, processing_status, uploaded_by_id)
               VALUES (?, 'technique', ?, 'demo', 'upload', 'ready', ?)
               RETURNING id as "id!: i64""#,
            technique_id,
            technique_id,
            student_id
        )
        .fetch_one(&pool)
        .await
        .expect("insert video");
        sqlx::query!(
            "INSERT INTO video_watch_aggregates
               (video_id, user_id, play_count, completed_count, total_seconds_watched, last_watched_at)
             VALUES (?, ?, 1, 0, 30, ?)",
            video_id,
            student_id,
            watched_at,
        )
        .execute(&pool)
        .await
        .expect("insert watch aggregate");

        let coach_cookies = login_test_user(&client, "coach_user", "password123").await;
        let initiative = fetch_initiative(&client, coach_cookies, "student_user")
            .await
            .expect("expected last_student_initiative_at to be set from watch aggregate");
        let watched_utc = chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(
            watched_at,
            chrono::Utc,
        );
        assert!(
            (initiative - watched_utc).num_seconds().abs() <= 1,
            "initiative {} should match watch time {}",
            initiative,
            watched_utc
        );
    }

    #[rocket::async_test]
    async fn test_taking_initiative_max_across_signals() {
        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .student("student_user", Some("Student User"))
            .technique("Armbar", "desc", Some("coach_user"))
            .assign_technique(Some("Armbar"), Some("student_user"), "red", "", "")
            .build()
            .await
            .expect("Failed to build test DB");

        let pool = test_db.pool.clone();
        let (client, test_db) = setup_test_client(test_db).await;
        let st_id = test_db
            .student_technique_id("student_user", "Armbar")
            .await
            .expect("Failed to get id");
        let student_id = test_db.user_id("student_user").expect("Student not found");
        let technique_id = test_db.technique_id("Armbar").expect("Technique not found");

        // Note edit 3 days ago, watch 1 day ago. Watch should win.
        let note_at = (chrono::Utc::now() - chrono::Duration::days(3)).naive_utc();
        let watched_at = (chrono::Utc::now() - chrono::Duration::days(1)).naive_utc();

        sqlx::query!(
            "UPDATE student_techniques SET last_student_update_at = ? WHERE id = ?",
            note_at,
            st_id
        )
        .execute(&pool)
        .await
        .expect("backdate student note");

        let video_id: i64 = sqlx::query_scalar!(
            r#"INSERT INTO videos (technique_id, parent_kind, parent_id, title, kind, processing_status, uploaded_by_id)
               VALUES (?, 'technique', ?, 'demo', 'upload', 'ready', ?)
               RETURNING id as "id!: i64""#,
            technique_id,
            technique_id,
            student_id
        )
        .fetch_one(&pool)
        .await
        .expect("insert video");
        sqlx::query!(
            "INSERT INTO video_watch_aggregates
               (video_id, user_id, play_count, completed_count, total_seconds_watched, last_watched_at)
             VALUES (?, ?, 1, 0, 30, ?)",
            video_id,
            student_id,
            watched_at,
        )
        .execute(&pool)
        .await
        .expect("insert watch aggregate");

        let coach_cookies = login_test_user(&client, "coach_user", "password123").await;
        let initiative = fetch_initiative(&client, coach_cookies, "student_user")
            .await
            .expect("expected initiative timestamp");
        let watched_utc = chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(
            watched_at,
            chrono::Utc,
        );
        assert!(
            (initiative - watched_utc).num_seconds().abs() <= 1,
            "initiative {} should equal the more recent watch {}",
            initiative,
            watched_utc
        );
    }

    #[rocket::async_test]
    async fn test_taking_initiative_null_when_no_activity() {
        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .student("student_user", Some("Student User"))
            .technique("Armbar", "desc", Some("coach_user"))
            .assign_technique(Some("Armbar"), Some("student_user"), "red", "", "")
            .build()
            .await
            .expect("Failed to build test DB");

        let (client, _test_db) = setup_test_client(test_db).await;

        let coach_cookies = login_test_user(&client, "coach_user", "password123").await;
        let initiative = fetch_initiative(&client, coach_cookies, "student_user").await;
        assert!(
            initiative.is_none(),
            "fresh student with no notes/watches should have no initiative timestamp, got {:?}",
            initiative
        );
    }

    #[rocket::async_test]
    async fn test_mark_seen_permission_denied_for_other_student() {
        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .student("student_user", Some("Student User"))
            .student("other_student", Some("Other Student"))
            .technique("Armbar", "desc", Some("coach_user"))
            .assign_technique(Some("Armbar"), Some("student_user"), "red", "", "")
            .build()
            .await
            .expect("Failed to build test DB");

        let (client, test_db) = setup_test_client(test_db).await;
        let st_id = test_db
            .student_technique_id("student_user", "Armbar")
            .await
            .expect("Failed to get id");

        let other_cookies = login_test_user(&client, "other_student", "password123").await;
        let response = client
            .post(format!("/api/student_technique/{}/mark_seen", st_id))
            .cookies(other_cookies)
            .dispatch()
            .await;
        assert_eq!(response.status(), Status::Forbidden);
    }

    #[rocket::async_test]
    async fn test_graduate_student_keeps_edit_access() {
        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .student("student_user", Some("Student User"))
            .technique("Armbar", "Description of armbar", Some("coach_user"))
            .assign_technique(Some("Armbar"), Some("student_user"), "red", "", "")
            .build()
            .await
            .expect("Failed to build test DB");

        let (client, test_db) = setup_test_client(test_db).await;
        let student_id = test_db.user_id("student_user").expect("Student not found");
        let student_technique_id = test_db
            .student_technique_id("student_user", "Armbar")
            .await
            .expect("Failed to get student technique id");

        // Coach graduates the student via the dedicated endpoint.
        let coach_cookies = login_test_user(&client, "coach_user", "password123").await;
        let grad_response = client
            .post(format!("/api/student/{}/graduate", student_id))
            .cookies(coach_cookies.clone())
            .header(ContentType::JSON)
            .body(json!({ "graduated": true }).to_string())
            .dispatch()
            .await;
        assert_eq!(grad_response.status(), Status::Ok);

        // Graduated student can still edit their own notes; graduation is an
        // organizational marker only.
        let student_cookies = login_test_user(&client, "student_user", "password123").await;
        let after_grad = client
            .put(format!("/api/student_technique/{}", student_technique_id))
            .cookies(student_cookies.clone())
            .header(ContentType::JSON)
            .body(json!({ "student_notes": "post-graduation update" }).to_string())
            .dispatch()
            .await;
        assert_eq!(after_grad.status(), Status::Ok);

        // graduated_at appears on the API response.
        let students_response = client
            .get("/api/students?include_archived=false")
            .cookies(coach_cookies.clone())
            .dispatch()
            .await;
        assert_eq!(students_response.status(), Status::Ok);
        let body = students_response.into_string().await.unwrap();
        let students: Vec<UserData> = serde_json::from_str(&body).unwrap();
        let s = students
            .iter()
            .find(|s| s.id == student_id)
            .expect("graduated student missing from list");
        assert!(s.graduated_at.is_some(), "graduated_at should be set");

        // Un-graduating clears the timestamp.
        let ungrad_response = client
            .post(format!("/api/student/{}/graduate", student_id))
            .cookies(coach_cookies.clone())
            .header(ContentType::JSON)
            .body(json!({ "graduated": false }).to_string())
            .dispatch()
            .await;
        assert_eq!(ungrad_response.status(), Status::Ok);

        let students_after = client
            .get("/api/students?include_archived=false")
            .cookies(coach_cookies)
            .dispatch()
            .await;
        let body = students_after.into_string().await.unwrap();
        let students: Vec<UserData> = serde_json::from_str(&body).unwrap();
        let s = students
            .iter()
            .find(|s| s.id == student_id)
            .expect("student missing from list");
        assert!(s.graduated_at.is_none(), "graduated_at should be cleared");
    }

    // ---- Invite / claim flow ----

    #[rocket::async_test]
    async fn test_invite_user_and_claim() {
        use crate::api::{InviteInfoResponse, InviteResponse, UserData};

        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .build()
            .await
            .expect("Failed to build test DB");
        let (client, _test_db) = setup_test_client(test_db).await;

        let coach_cookies = login_test_user(&client, "coach_user", "password123").await;

        // Coach creates a stub student.
        let invite_response = client
            .post("/api/admin/invite_user")
            .cookies(coach_cookies)
            .header(ContentType::JSON)
            .body(
                json!({
                    "display_name": "New Student",
                    "email": "new@example.com",
                    "role": "student"
                })
                .to_string(),
            )
            .dispatch()
            .await;
        assert_eq!(invite_response.status(), Status::Ok);
        let invite: InviteResponse =
            serde_json::from_str(&invite_response.into_string().await.unwrap()).unwrap();
        assert!(invite.claim_path.starts_with("/invite/"));

        // Public GET shows info.
        let info_response = client
            .get(format!("/api/invite/{}", invite.token))
            .dispatch()
            .await;
        assert_eq!(info_response.status(), Status::Ok);
        let info: InviteInfoResponse =
            serde_json::from_str(&info_response.into_string().await.unwrap()).unwrap();
        assert_eq!(info.display_name, "New Student");
        assert_eq!(info.role, "student");

        // Claim with username + password.
        let claim_response = client
            .post(format!("/api/invite/{}/claim", invite.token))
            .header(ContentType::JSON)
            .body(
                json!({
                    "username": "new_student",
                    "password": "secret123"
                })
                .to_string(),
            )
            .dispatch()
            .await;
        assert_eq!(claim_response.status(), Status::Ok);
        let user: UserData =
            serde_json::from_str(&claim_response.into_string().await.unwrap()).unwrap();
        assert_eq!(user.username, "new_student");
        assert!(user.claimed_at.is_some());

        // Token can't be used again (gone).
        let reclaim = client
            .post(format!("/api/invite/{}/claim", invite.token))
            .header(ContentType::JSON)
            .body(json!({ "username": "other", "password": "secret123" }).to_string())
            .dispatch()
            .await;
        assert!(reclaim.status() == Status::Gone || reclaim.status() == Status::NotFound);

        // The new user can log in with their credentials.
        let login_response = client
            .post("/api/login")
            .header(ContentType::JSON)
            .body(
                json!({ "username": "new_student", "password": "secret123" })
                    .to_string(),
            )
            .dispatch()
            .await;
        assert_eq!(login_response.status(), Status::Ok);
    }

    #[rocket::async_test]
    async fn test_stub_user_cannot_log_in() {
        use crate::api::InviteResponse;

        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .build()
            .await
            .expect("Failed to build test DB");
        let (client, _test_db) = setup_test_client(test_db).await;

        let coach_cookies = login_test_user(&client, "coach_user", "password123").await;
        let invite_response = client
            .post("/api/admin/invite_user")
            .cookies(coach_cookies)
            .header(ContentType::JSON)
            .body(
                json!({
                    "display_name": "Unclaimed",
                    "role": "student"
                })
                .to_string(),
            )
            .dispatch()
            .await;
        let _invite: InviteResponse =
            serde_json::from_str(&invite_response.into_string().await.unwrap()).unwrap();

        // Attempt to log in as the unclaimed user: no credentials exist.
        let response = client
            .post("/api/login")
            .header(ContentType::JSON)
            .body(json!({ "username": "anything", "password": "anything" }).to_string())
            .dispatch()
            .await;
        // Stub user has username=NULL, so this login attempt finds no user and
        // returns success=false.
        assert_eq!(response.status(), Status::Ok);
        let body = response.into_string().await.unwrap();
        let login: LoginResponse = serde_json::from_str(&body).unwrap();
        assert!(!login.success);
    }

    #[rocket::async_test]
    async fn test_reset_claim_invalidates_credentials() {
        use crate::api::InviteResponse;

        let test_db = TestDbBuilder::new()
            .admin("admin_user", Some("Admin"))
            .student("student_user", Some("Student"))
            .build()
            .await
            .expect("Failed to build test DB");
        let (client, test_db) = setup_test_client(test_db).await;
        let student_id = test_db
            .user_id("student_user")
            .expect("student not found");

        // Student can currently log in.
        let before = client
            .post("/api/login")
            .header(ContentType::JSON)
            .body(
                json!({ "username": "student_user", "password": "password123" })
                    .to_string(),
            )
            .dispatch()
            .await;
        let body = before.into_string().await.unwrap();
        let login: LoginResponse = serde_json::from_str(&body).unwrap();
        assert!(login.success);

        // Admin resets the claim.
        let admin_cookies = login_test_user(&client, "admin_user", "password123").await;
        let reset_response = client
            .post(format!("/api/admin/users/{}/reset_claim", student_id))
            .cookies(admin_cookies)
            .dispatch()
            .await;
        assert_eq!(reset_response.status(), Status::Ok);
        let invite: InviteResponse =
            serde_json::from_str(&reset_response.into_string().await.unwrap()).unwrap();
        assert!(!invite.token.is_empty());

        // Old credentials no longer work.
        let after = client
            .post("/api/login")
            .header(ContentType::JSON)
            .body(
                json!({ "username": "student_user", "password": "password123" })
                    .to_string(),
            )
            .dispatch()
            .await;
        let body = after.into_string().await.unwrap();
        let login: LoginResponse = serde_json::from_str(&body).unwrap();
        assert!(!login.success);
    }
}

#[rocket::async_test]
async fn test_tag_apis() {
    let test_db = create_standard_test_db().await;
    let (client, test_db) = setup_test_client(test_db).await;

    let cookies = login_test_user(&client, "coach_user", "password123").await;

    // Test create tag
    let create_response = client
        .post("/api/tags")
        .cookies(cookies.clone())
        .header(ContentType::JSON)
        .body(
            json!({
                "name": "Test Tag"
            })
            .to_string(),
        )
        .dispatch()
        .await;

    assert_eq!(create_response.status(), Status::Ok);

    // Test get all tags
    let get_tags_response = client
        .get("/api/tags")
        .cookies(cookies.clone())
        .dispatch()
        .await;

    assert_eq!(get_tags_response.status(), Status::Ok);

    let tags_json = get_tags_response.into_string().await.unwrap();
    let tags_response: TagsResponse = serde_json::from_str(&tags_json).unwrap();
    assert!(tags_response.tags.iter().any(|t| t.name == "Test Tag"));

    // Get the tag id
    let tag_id = tags_response
        .tags
        .iter()
        .find(|t| t.name == "Test Tag")
        .unwrap()
        .id;

    // Get a technique to tag
    let technique_id = test_db.technique_id("Armbar").expect("Technique not found");

    // Test add tag to technique
    let tag_technique_response = client
        .post("/api/technique/tag")
        .cookies(cookies.clone())
        .header(ContentType::JSON)
        .body(
            json!({
                "technique_id": technique_id,
                "tag_id": tag_id
            })
            .to_string(),
        )
        .dispatch()
        .await;

    assert_eq!(tag_technique_response.status(), Status::Ok);

    // Test get technique tags
    let technique_tags_response = client
        .get(format!("/api/technique/{}/tags", technique_id))
        .cookies(cookies.clone())
        .dispatch()
        .await;

    assert_eq!(technique_tags_response.status(), Status::Ok);

    let tags_json = technique_tags_response.into_string().await.unwrap();
    let tags_response: TagsResponse = serde_json::from_str(&tags_json).unwrap();
    assert_eq!(tags_response.tags.len(), 1);
    assert_eq!(tags_response.tags[0].name, "Test Tag");

    // Test remove tag from technique
    let remove_tag_response = client
        .delete(format!("/api/technique/{}/tag/{}", technique_id, tag_id))
        .cookies(cookies.clone())
        .dispatch()
        .await;

    assert_eq!(remove_tag_response.status(), Status::Ok);

    // Verify tag was removed
    let technique_tags_response = client
        .get(format!("/api/technique/{}/tags", technique_id))
        .cookies(cookies.clone())
        .dispatch()
        .await;

    let tags_json = technique_tags_response.into_string().await.unwrap();
    let tags_response: TagsResponse = serde_json::from_str(&tags_json).unwrap();
    assert_eq!(tags_response.tags.len(), 0);

    // Test delete tag
    let delete_tag_response = client
        .delete(format!("/api/tags/{}", tag_id))
        .cookies(cookies.clone())
        .dispatch()
        .await;

    assert_eq!(delete_tag_response.status(), Status::Ok);

    // Verify tag was deleted
    let get_tags_response = client
        .get("/api/tags")
        .cookies(cookies.clone())
        .dispatch()
        .await;

    let tags_json = get_tags_response.into_string().await.unwrap();
    let tags_response: TagsResponse = serde_json::from_str(&tags_json).unwrap();
    assert!(!tags_response.tags.iter().any(|t| t.name == "Test Tag"));
}
