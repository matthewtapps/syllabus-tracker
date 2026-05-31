#[cfg(test)]
mod tests {
    use rocket::http::Status;
    use serde_json::Value;

    use crate::test::test_utils::{create_standard_test_db, setup_test_client_with};

    #[rocket::async_test]
    async fn capabilities_reports_videos_true_when_enabled() {
        let test_db = create_standard_test_db().await;
        let (client, _db) = setup_test_client_with(test_db, true).await;

        let response = client.get("/api/capabilities").dispatch().await;
        assert_eq!(response.status(), Status::Ok);
        let body: Value =
            serde_json::from_str(&response.into_string().await.unwrap()).unwrap();
        assert_eq!(body["videos"], Value::Bool(true));
    }

    #[rocket::async_test]
    async fn capabilities_reports_videos_false_when_disabled() {
        let test_db = create_standard_test_db().await;
        let (client, _db) = setup_test_client_with(test_db, false).await;

        let response = client.get("/api/capabilities").dispatch().await;
        assert_eq!(response.status(), Status::Ok);
        let body: Value =
            serde_json::from_str(&response.into_string().await.unwrap()).unwrap();
        assert_eq!(body["videos"], Value::Bool(false));
    }

    /// When the videos flag is off the video routes must not be mounted. We
    /// check this on an upload route and a read route so a regression that
    /// only re-mounts one of the route groups would still be caught.
    #[rocket::async_test]
    async fn video_routes_return_404_when_disabled() {
        let test_db = create_standard_test_db().await;
        let (client, _db) = setup_test_client_with(test_db, false).await;

        let upload = client
            .post("/api/techniques/1/videos/upload")
            .dispatch()
            .await;
        assert_eq!(
            upload.status(),
            Status::NotFound,
            "upload route should be unmounted when videos disabled",
        );

        let status = client.get("/api/videos/1/status").dispatch().await;
        assert_eq!(
            status.status(),
            Status::NotFound,
            "status route should be unmounted when videos disabled",
        );
    }
}
