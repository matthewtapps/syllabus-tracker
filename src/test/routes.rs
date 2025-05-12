#[cfg(test)]
mod tests {
    use crate::db::get_student_technique;
    use crate::init_rocket;
    use crate::models::StudentTechnique;
    use crate::test::test_db::{TestDb, TestDbBuilder};
    use rocket::http::{ContentType, Cookie, Status};
    use rocket::local::asynchronous::{Client, LocalResponse};

    // fn auth_cookie(username: &str) -> Cookie<'static> {
    //     Cookie::build(("logged_in", username.to_string()))
    //         .same_site(SameSite::Lax)
    //         .build()
    // }

    async fn setup_test_client(test_db: TestDb) -> (Client, TestDb) {
        let rocket = init_rocket(test_db.pool.clone()).await;

        let client = Client::tracked(rocket)
            .await
            .expect("Failed to create Rocket test client");

        (client, test_db)
    }

    async fn create_standard_test_db() -> TestDb {
        let test_db = TestDbBuilder::new()
            .admin("admin_user", Some("Admin User"))
            .coach("coach_user", Some("Coach User"))
            .student("student_user", Some("Student User"))
            .technique("Armbar", "Description of armbar", Some("coach_user"))
            .technique("Triangle", "Description of triangle", Some("coach_user"))
            .assign_technique(
                Some("Armbar"),
                Some("student_user"),
                "red",
                "Student notes",
                "Coach notes",
            )
            .build()
            .await
            .expect("Failed to build test database");

        test_db
    }

    #[rocket::async_test]
    async fn test_index_requires_auth() {
        let test_db = create_standard_test_db().await;
        let (client, _) = setup_test_client(test_db).await;

        let response = client.get("/").dispatch().await;

        assert_eq!(response.status(), Status::SeeOther);

        let location = response.headers().get_one("Location");
        assert_eq!(location, Some("/login"));
    }

    #[rocket::async_test]
    async fn test_index_with_coach_auth() {
        let test_db = create_standard_test_db().await;

        let (client, _) = setup_test_client(test_db).await;

        let login_response: LocalResponse = client
            .post("/login")
            .header(ContentType::Form)
            .body("username=coach_user&password=password123")
            .dispatch()
            .await;

        let session_cookies: Vec<_> = login_response.cookies().iter().cloned().collect::<Vec<_>>();

        let response = client.get("/").cookies(session_cookies).dispatch().await;

        assert_eq!(response.status(), Status::Ok);

        let body = response
            .into_string()
            .await
            .expect("Failed to get response body");

        assert!(body.contains("Students"));
        assert!(body.contains("student_user"));
    }

    #[rocket::async_test]
    async fn test_student_techniques_page() {
        let test_db = create_standard_test_db().await;
        let (client, test_db) = setup_test_client(test_db).await;

        let student_id = test_db.user_id("student_user").expect("Student not found");

        let login_response: LocalResponse = client
            .post("/login")
            .header(ContentType::Form)
            .body("username=student_user&password=password123")
            .dispatch()
            .await;

        let session_cookies: Vec<_> = login_response.cookies().iter().cloned().collect::<Vec<_>>();

        let response = client
            .get(format!("/student/{}", student_id))
            .cookies(session_cookies)
            .dispatch()
            .await;

        assert_eq!(response.status(), Status::Ok);

        let body = response
            .into_string()
            .await
            .expect("Failed to get response body");
        assert!(body.contains("Techniques"));
    }

    #[rocket::async_test]
    async fn test_profile_page() {
        let test_db = create_standard_test_db().await;
        let (client, _) = setup_test_client(test_db).await;

        let login_response: LocalResponse = client
            .post("/login")
            .header(ContentType::Form)
            .body("username=student_user&password=password123")
            .dispatch()
            .await;

        let session_cookies: Vec<_> = login_response.cookies().iter().cloned().collect::<Vec<_>>();

        let response = client
            .get("/profile")
            .cookies(session_cookies)
            .dispatch()
            .await;

        assert_eq!(response.status(), Status::Ok);

        let body = response
            .into_string()
            .await
            .expect("Failed to get response body");
        assert!(body.contains("Your Profile"));
        assert!(body.contains("student_user"));
    }

    #[rocket::async_test]
    async fn test_update_student_technique() {
        let test_db = TestDbBuilder::new()
            .coach("coach_user", Some("Coach User"))
            .student("student_user", Some("Student User"))
            .technique("Armbar", "Description", None)
            .assign_technique(Some("Armbar"), Some("student_user"), "red", "", "")
            .build()
            .await
            .expect("Failed to build test DB");

        let (client, test_db) = setup_test_client(test_db).await;

        let student_technique_id = test_db
            .student_technique_id("student_user", "Armbar")
            .await
            .expect("Failed to get student technique id");

        let form_string = format!(
            "status=green&coach_notes={}&student_notes={}&technique_name=Armbar&technique_description={}",
            urlencoding::encode("Improved technique"),
            urlencoding::encode("Feeling more confident"),
            urlencoding::encode("Description of armbar")
        );

        let login_response: LocalResponse = client
            .post("/login")
            .header(ContentType::Form)
            .body("username=coach_user&password=password123")
            .dispatch()
            .await;

        let session_cookies: Vec<_> = login_response.cookies().iter().cloned().collect::<Vec<_>>();

        let response = client
            .post(format!("/student_technique/{}", student_technique_id))
            .cookies(session_cookies)
            .header(ContentType::Form)
            .body(form_string)
            .dispatch()
            .await;

        assert_eq!(response.status(), Status::SeeOther);

        let updated_technique: StudentTechnique =
            get_student_technique(&test_db.pool, student_technique_id)
                .await
                .expect("Failed to get student technique");

        assert_eq!(updated_technique.status, "green");
        assert_eq!(updated_technique.coach_notes, "Improved technique");
        assert_eq!(updated_technique.student_notes, "Feeling more confident");
    }

    #[rocket::async_test]
    async fn test_session_token_security() {
        let test_db = TestDbBuilder::new()
            .student("student_one", Some("Student One"))
            .student("student_two", Some("Student Two"))
            .technique("Armbar", "Description of armbar", None)
            .assign_technique(
                Some("Armbar"),
                Some("student_one"),
                "red",
                "Student notes",
                "",
            )
            .build()
            .await
            .expect("Failed to build test database");

        let (client, test_db): (Client, TestDb) = setup_test_client(test_db).await;

        let student_one_id = test_db
            .user_id("student_one")
            .expect("Student one not found");

        let forged_cookie = Cookie::build(("session_token", "fake_token_for_student_one")).build();
        let logged_in_cookie = Cookie::build(("logged_in", "student_one")).build();

        // This should fail because the token doesn't exist in the database
        let response: LocalResponse = client
            .get(format!("/student/{}", student_one_id))
            .private_cookie(forged_cookie)
            .private_cookie(logged_in_cookie)
            .dispatch()
            .await;

        assert_eq!(response.status(), Status::SeeOther);

        let login_response: LocalResponse = client
            .post("/login")
            .header(ContentType::Form)
            .body("username=student_one&password=password123")
            .dispatch()
            .await;

        assert_eq!(login_response.status(), Status::SeeOther);

        let session_cookies: Vec<_> = login_response.cookies().iter().cloned().collect::<Vec<_>>();

        assert!(
            !session_cookies.is_empty(),
            "No session token cookie found after login"
        );

        let response = client
            .get(format!("/student/{}", student_one_id))
            .cookies(session_cookies)
            .dispatch()
            .await;

        assert_eq!(response.status(), Status::Ok);
    }
}
