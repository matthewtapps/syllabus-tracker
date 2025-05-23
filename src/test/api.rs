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

        let updated_technique = get_student_technique(&test_db.pool, student_technique_id)
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
