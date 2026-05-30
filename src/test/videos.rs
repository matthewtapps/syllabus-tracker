#[cfg(test)]
mod tests {
    use rocket::http::{ContentType, Header, Status};
    use rocket::local::asynchronous::Client;
    use serde_json::json;

    use crate::test::test_utils::{
        create_standard_test_db, login_test_user, setup_test_client, TestDb,
    };

    const BOUNDARY: &str = "----testboundarysillybus";

    fn multipart_upload_body(
        file_bytes: &[u8],
        filename: &str,
        title: &str,
        description: Option<&str>,
    ) -> Vec<u8> {
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

        if let Some(description) = description {
            body.extend_from_slice(format!("--{}\r\n", BOUNDARY).as_bytes());
            body.extend_from_slice(b"Content-Disposition: form-data; name=\"description\"\r\n\r\n");
            body.extend_from_slice(description.as_bytes());
            body.extend_from_slice(b"\r\n");
        }

        body.extend_from_slice(format!("--{}--\r\n", BOUNDARY).as_bytes());
        body
    }

    fn multipart_content_type() -> ContentType {
        ContentType::parse_flexible(&format!("multipart/form-data; boundary={}", BOUNDARY))
            .expect("multipart content type")
    }

    async fn login_as(client: &Client, username: &str) {
        let _ = login_test_user(client, username, "password123").await;
    }

    async fn first_technique_id(db: &TestDb) -> i64 {
        db.technique_id("Armbar").expect("Armbar technique seeded")
    }

    async fn poll_status_until_ready(client: &Client, video_id: i64) -> String {
        for _ in 0..50 {
            let response = client
                .get(format!("/api/videos/{}/status", video_id))
                .dispatch()
                .await;
            if response.status() == Status::Ok {
                let body: serde_json::Value =
                    serde_json::from_str(&response.into_string().await.unwrap()).unwrap();
                let status = body["processing_status"].as_str().unwrap().to_string();
                if status != "processing" {
                    return status;
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        "timeout".to_string()
    }

    #[rocket::async_test]
    async fn upload_requires_coach_permission() {
        let test_db = create_standard_test_db().await;
        let (client, db) = setup_test_client(test_db).await;
        let tid = first_technique_id(&db).await;

        login_as(&client, "student_user").await;

        let body = multipart_upload_body(b"fake-mp4-bytes", "clip.mp4", "Demo", None);
        let response = client
            .post(format!("/api/techniques/{}/videos/upload", tid))
            .header(multipart_content_type())
            .body(body)
            .dispatch()
            .await;
        assert_eq!(response.status(), Status::Forbidden);
    }

    #[rocket::async_test]
    async fn upload_rejects_wrong_content_type() {
        let test_db = create_standard_test_db().await;
        let (client, db) = setup_test_client(test_db).await;
        let tid = first_technique_id(&db).await;

        login_as(&client, "coach_user").await;

        // Build a multipart body whose file part advertises image/png.
        let body = format!(
            "--{boundary}\r\n\
             Content-Disposition: form-data; name=\"file\"; filename=\"clip.png\"\r\n\
             Content-Type: image/png\r\n\r\n\
             not-a-real-video\r\n\
             --{boundary}\r\n\
             Content-Disposition: form-data; name=\"title\"\r\n\r\n\
             Demo\r\n\
             --{boundary}--\r\n",
            boundary = BOUNDARY
        );
        let response = client
            .post(format!("/api/techniques/{}/videos/upload", tid))
            .header(multipart_content_type())
            .body(body)
            .dispatch()
            .await;
        assert_eq!(response.status(), Status::UnsupportedMediaType);
    }

    #[rocket::async_test]
    async fn upload_creates_row_then_processes() {
        let test_db = create_standard_test_db().await;
        let (client, db) = setup_test_client(test_db).await;
        let tid = first_technique_id(&db).await;

        login_as(&client, "coach_user").await;

        let body = multipart_upload_body(b"fake-mp4-bytes", "clip.mp4", "Demo", Some("notes"));
        let response = client
            .post(format!("/api/techniques/{}/videos/upload", tid))
            .header(multipart_content_type())
            .body(body)
            .dispatch()
            .await;
        assert_eq!(response.status(), Status::Ok);

        let body: serde_json::Value =
            serde_json::from_str(&response.into_string().await.unwrap()).unwrap();
        let video_id = body["video_id"].as_i64().unwrap();
        assert_eq!(body["processing_status"], "processing");

        let final_status = poll_status_until_ready(&client, video_id).await;
        assert_eq!(final_status, "ready");
    }

    #[rocket::async_test]
    async fn link_video_parses_youtube_url() {
        let test_db = create_standard_test_db().await;
        let (client, db) = setup_test_client(test_db).await;
        let tid = first_technique_id(&db).await;

        login_as(&client, "coach_user").await;

        let response = client
            .post(format!("/api/techniques/{}/videos/link", tid))
            .header(ContentType::JSON)
            .body(
                json!({
                    "title": "Demo on YouTube",
                    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
                })
                .to_string(),
            )
            .dispatch()
            .await;
        assert_eq!(response.status(), Status::Ok);

        let body: serde_json::Value =
            serde_json::from_str(&response.into_string().await.unwrap()).unwrap();
        assert_eq!(body["kind"], "youtube");
        assert_eq!(body["processing_status"], "ready");
        assert_eq!(body["external_video_id"], "dQw4w9WgXcQ");
    }

    #[rocket::async_test]
    async fn link_video_handles_unknown_host() {
        let test_db = create_standard_test_db().await;
        let (client, db) = setup_test_client(test_db).await;
        let tid = first_technique_id(&db).await;

        login_as(&client, "coach_user").await;

        let response = client
            .post(format!("/api/techniques/{}/videos/link", tid))
            .header(ContentType::JSON)
            .body(json!({"title": "Other host", "url": "https://example.com/clip"}).to_string())
            .dispatch()
            .await;
        assert_eq!(response.status(), Status::Ok);

        let body: serde_json::Value =
            serde_json::from_str(&response.into_string().await.unwrap()).unwrap();
        assert_eq!(body["kind"], "link");
    }

    #[rocket::async_test]
    async fn list_orders_by_position() {
        let test_db = create_standard_test_db().await;
        let (client, db) = setup_test_client(test_db).await;
        let tid = first_technique_id(&db).await;

        login_as(&client, "coach_user").await;

        for n in 0..3 {
            client
                .post(format!("/api/techniques/{}/videos/link", tid))
                .header(ContentType::JSON)
                .body(
                    json!({
                        "title": format!("Video {}", n),
                        "url": format!("https://youtu.be/abc{}", n),
                    })
                    .to_string(),
                )
                .dispatch()
                .await;
        }

        let response = client
            .get(format!("/api/techniques/{}/videos", tid))
            .dispatch()
            .await;
        assert_eq!(response.status(), Status::Ok);
        let body: serde_json::Value =
            serde_json::from_str(&response.into_string().await.unwrap()).unwrap();
        let videos = body["videos"].as_array().unwrap();
        assert_eq!(videos.len(), 3);
        for (i, v) in videos.iter().enumerate() {
            assert_eq!(v["position"].as_i64().unwrap(), i as i64);
        }
    }

    #[rocket::async_test]
    async fn playback_url_only_when_ready() {
        let test_db = create_standard_test_db().await;
        let (client, db) = setup_test_client(test_db).await;
        let tid = first_technique_id(&db).await;

        login_as(&client, "coach_user").await;

        // External link videos are immediately ready but have no storage_key,
        // so signed playback should still 409.
        let link_response = client
            .post(format!("/api/techniques/{}/videos/link", tid))
            .header(ContentType::JSON)
            .body(json!({"title": "Yt", "url": "https://youtu.be/xyz123"}).to_string())
            .dispatch()
            .await;
        let body: serde_json::Value =
            serde_json::from_str(&link_response.into_string().await.unwrap()).unwrap();
        let link_id = body["id"].as_i64().unwrap();

        let response = client
            .get(format!("/api/videos/{}/playback-url", link_id))
            .dispatch()
            .await;
        assert_eq!(response.status(), Status::Conflict);

        // Now upload, wait until ready, signed URL works.
        let upload_response = client
            .post(format!("/api/techniques/{}/videos/upload", tid))
            .header(multipart_content_type())
            .body(multipart_upload_body(b"bytes", "clip.mp4", "Native", None))
            .dispatch()
            .await;
        let body: serde_json::Value =
            serde_json::from_str(&upload_response.into_string().await.unwrap()).unwrap();
        let video_id = body["video_id"].as_i64().unwrap();
        assert_eq!(poll_status_until_ready(&client, video_id).await, "ready");

        let response = client
            .get(format!("/api/videos/{}/playback-url", video_id))
            .dispatch()
            .await;
        assert_eq!(response.status(), Status::Ok);
        let body: serde_json::Value =
            serde_json::from_str(&response.into_string().await.unwrap()).unwrap();
        assert!(body["url"].as_str().unwrap().starts_with("memory://"));
    }

    #[rocket::async_test]
    async fn delete_video_requires_permission() {
        let test_db = create_standard_test_db().await;
        let (client, db) = setup_test_client(test_db).await;
        let tid = first_technique_id(&db).await;

        login_as(&client, "coach_user").await;
        let link_response = client
            .post(format!("/api/techniques/{}/videos/link", tid))
            .header(ContentType::JSON)
            .body(json!({"title": "Yt", "url": "https://youtu.be/xyz789"}).to_string())
            .dispatch()
            .await;
        let body: serde_json::Value =
            serde_json::from_str(&link_response.into_string().await.unwrap()).unwrap();
        let video_id = body["id"].as_i64().unwrap();

        // Different cookie jar: log in as a student.
        login_as(&client, "student_user").await;
        let response = client
            .delete(format!("/api/videos/{}", video_id))
            .dispatch()
            .await;
        assert_eq!(response.status(), Status::Forbidden);

        login_as(&client, "coach_user").await;
        let response = client
            .delete(format!("/api/videos/{}", video_id))
            .dispatch()
            .await;
        assert_eq!(response.status(), Status::NoContent);
    }

    #[rocket::async_test]
    async fn reorder_videos_persists_positions() {
        let test_db = create_standard_test_db().await;
        let (client, db) = setup_test_client(test_db).await;
        let tid = first_technique_id(&db).await;

        login_as(&client, "coach_user").await;

        let mut ids = Vec::new();
        for n in 0..3 {
            let r = client
                .post(format!("/api/techniques/{}/videos/link", tid))
                .header(ContentType::JSON)
                .body(
                    json!({
                        "title": format!("Video {}", n),
                        "url": format!("https://youtu.be/order{}", n),
                    })
                    .to_string(),
                )
                .dispatch()
                .await;
            let body: serde_json::Value =
                serde_json::from_str(&r.into_string().await.unwrap()).unwrap();
            ids.push(body["id"].as_i64().unwrap());
        }
        let reversed: Vec<i64> = ids.iter().rev().copied().collect();

        let response = client
            .post(format!("/api/techniques/{}/videos/reorder", tid))
            .header(ContentType::JSON)
            .body(json!({"ordered_ids": reversed.clone()}).to_string())
            .dispatch()
            .await;
        assert_eq!(response.status(), Status::NoContent);

        let response = client
            .get(format!("/api/techniques/{}/videos", tid))
            .dispatch()
            .await;
        let body: serde_json::Value =
            serde_json::from_str(&response.into_string().await.unwrap()).unwrap();
        let videos = body["videos"].as_array().unwrap();
        let observed: Vec<i64> = videos
            .iter()
            .map(|v| v["id"].as_i64().unwrap())
            .collect();
        assert_eq!(observed, reversed);
    }

    async fn upload_ready_video(client: &Client, tid: i64) -> i64 {
        let response = client
            .post(format!("/api/techniques/{}/videos/upload", tid))
            .header(multipart_content_type())
            .body(multipart_upload_body(b"bytes", "clip.mp4", "Tracked", None))
            .dispatch()
            .await;
        let body: serde_json::Value =
            serde_json::from_str(&response.into_string().await.unwrap()).unwrap();
        let video_id = body["video_id"].as_i64().unwrap();
        assert_eq!(poll_status_until_ready(client, video_id).await, "ready");
        video_id
    }

    async fn post_watch_events(
        client: &Client,
        video_id: i64,
        play_id: &str,
        events: Vec<serde_json::Value>,
    ) -> rocket::http::Status {
        client
            .post(format!("/api/videos/{}/watch-events", video_id))
            .header(ContentType::JSON)
            .body(
                json!({
                    "play_id": play_id,
                    "events": events,
                })
                .to_string(),
            )
            .dispatch()
            .await
            .status()
    }

    #[rocket::async_test]
    async fn watch_event_ingest_increments_aggregates() {
        let test_db = create_standard_test_db().await;
        let (client, db) = setup_test_client(test_db).await;
        let tid = first_technique_id(&db).await;

        login_as(&client, "coach_user").await;
        let video_id = upload_ready_video(&client, tid).await;

        login_as(&client, "student_user").await;
        let status = post_watch_events(
            &client,
            video_id,
            "play-aaa",
            vec![
                json!({"event": "started"}),
                json!({"event": "progress_25", "seconds_watched": 8}),
                json!({"event": "completed", "seconds_watched": 30}),
            ],
        )
        .await;
        assert_eq!(status, Status::NoContent);

        let response = client
            .get(format!("/api/me/watch-state?video_ids={}", video_id))
            .dispatch()
            .await;
        let body: serde_json::Value =
            serde_json::from_str(&response.into_string().await.unwrap()).unwrap();
        let agg = &body["videos"][video_id.to_string()];
        assert_eq!(agg["play_count"].as_i64().unwrap(), 1);
        assert_eq!(agg["completed_count"].as_i64().unwrap(), 1);
        assert_eq!(agg["total_seconds_watched"].as_i64().unwrap(), 30);
    }

    #[rocket::async_test]
    async fn rewatch_with_new_play_id_increments_play_count() {
        let test_db = create_standard_test_db().await;
        let (client, db) = setup_test_client(test_db).await;
        let tid = first_technique_id(&db).await;

        login_as(&client, "coach_user").await;
        let video_id = upload_ready_video(&client, tid).await;

        login_as(&client, "student_user").await;
        post_watch_events(
            &client,
            video_id,
            "play-1",
            vec![
                json!({"event": "started"}),
                json!({"event": "completed", "seconds_watched": 25}),
            ],
        )
        .await;
        post_watch_events(
            &client,
            video_id,
            "play-2",
            vec![
                json!({"event": "started"}),
                json!({"event": "completed", "seconds_watched": 25}),
            ],
        )
        .await;

        let response = client
            .get(format!("/api/me/watch-state?video_ids={}", video_id))
            .dispatch()
            .await;
        let body: serde_json::Value =
            serde_json::from_str(&response.into_string().await.unwrap()).unwrap();
        let agg = &body["videos"][video_id.to_string()];
        assert_eq!(agg["play_count"].as_i64().unwrap(), 2);
        assert_eq!(agg["completed_count"].as_i64().unwrap(), 2);
        assert_eq!(agg["total_seconds_watched"].as_i64().unwrap(), 50);
    }

    #[rocket::async_test]
    async fn completed_idempotent_within_play_id() {
        let test_db = create_standard_test_db().await;
        let (client, db) = setup_test_client(test_db).await;
        let tid = first_technique_id(&db).await;

        login_as(&client, "coach_user").await;
        let video_id = upload_ready_video(&client, tid).await;

        login_as(&client, "student_user").await;
        post_watch_events(
            &client,
            video_id,
            "play-9",
            vec![
                json!({"event": "started"}),
                json!({"event": "completed", "seconds_watched": 25}),
            ],
        )
        .await;
        // Same play_id, completed fires again (e.g. duplicate beacon).
        post_watch_events(
            &client,
            video_id,
            "play-9",
            vec![json!({"event": "completed", "seconds_watched": 25})],
        )
        .await;

        let response = client
            .get(format!("/api/me/watch-state?video_ids={}", video_id))
            .dispatch()
            .await;
        let body: serde_json::Value =
            serde_json::from_str(&response.into_string().await.unwrap()).unwrap();
        let agg = &body["videos"][video_id.to_string()];
        assert_eq!(agg["play_count"].as_i64().unwrap(), 1);
        assert_eq!(agg["completed_count"].as_i64().unwrap(), 1);
    }

    #[rocket::async_test]
    async fn watch_event_rejects_unknown_event_name() {
        let test_db = create_standard_test_db().await;
        let (client, db) = setup_test_client(test_db).await;
        let tid = first_technique_id(&db).await;

        login_as(&client, "coach_user").await;
        let video_id = upload_ready_video(&client, tid).await;

        login_as(&client, "student_user").await;
        let status = post_watch_events(
            &client,
            video_id,
            "play-x",
            vec![json!({"event": "secretly_scrubbed"})],
        )
        .await;
        assert_eq!(status, Status::UnprocessableEntity);
    }

    #[rocket::async_test]
    async fn privacy_ack_persists() {
        let test_db = create_standard_test_db().await;
        let (client, _db) = setup_test_client(test_db).await;

        login_as(&client, "student_user").await;
        let initial = client.get("/api/videos/privacy-ack").dispatch().await;
        let body: serde_json::Value =
            serde_json::from_str(&initial.into_string().await.unwrap()).unwrap();
        assert_eq!(body["acked"], false);

        let ack = client.post("/api/videos/privacy-ack").dispatch().await;
        assert_eq!(ack.status(), Status::NoContent);

        let after = client.get("/api/videos/privacy-ack").dispatch().await;
        let body: serde_json::Value =
            serde_json::from_str(&after.into_string().await.unwrap()).unwrap();
        assert_eq!(body["acked"], true);
    }

    // Silence unused Header import when adding follow-up cases.
    #[allow(dead_code)]
    fn _header(name: &'static str, value: &'static str) -> Header<'static> {
        Header::new(name, value)
    }
}
