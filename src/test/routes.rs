#[cfg(test)]
mod tests {
    use rocket::http::Status;

    use crate::test::test_utils::{create_standard_test_db, setup_test_client};

    #[rocket::async_test]
    async fn test_index_requires_auth() {
        let test_db = create_standard_test_db().await;
        let (client, _) = setup_test_client(test_db).await;

        let response = client.get("/api/me").dispatch().await;
        assert_eq!(response.status(), Status::Unauthorized);

        let spa_response = client.get("/").dispatch().await;
        assert_eq!(spa_response.status(), Status::Ok);
    }
}
