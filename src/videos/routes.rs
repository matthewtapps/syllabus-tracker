use rocket::http::Status;

use crate::auth::User;

#[post("/techniques/<_tid>/videos/upload")]
pub async fn api_video_upload(_tid: i64, _user: User) -> Status {
    Status::NotImplemented
}

#[get("/videos/<_vid>/status")]
pub async fn api_video_status(_vid: i64, _user: User) -> Status {
    Status::NotImplemented
}

#[post("/techniques/<_tid>/videos/link")]
pub async fn api_video_link(_tid: i64, _user: User) -> Status {
    Status::NotImplemented
}

#[get("/techniques/<_tid>/videos")]
pub async fn api_list_technique_videos(_tid: i64, _user: User) -> Status {
    Status::NotImplemented
}

#[patch("/videos/<_vid>")]
pub async fn api_update_video(_vid: i64, _user: User) -> Status {
    Status::NotImplemented
}

#[post("/techniques/<_tid>/videos/reorder")]
pub async fn api_reorder_videos(_tid: i64, _user: User) -> Status {
    Status::NotImplemented
}

#[post("/videos/<_vid>/replace")]
pub async fn api_replace_video(_vid: i64, _user: User) -> Status {
    Status::NotImplemented
}

#[delete("/videos/<_vid>")]
pub async fn api_delete_video(_vid: i64, _user: User) -> Status {
    Status::NotImplemented
}

#[get("/videos/<_vid>/playback-url")]
pub async fn api_video_playback_url(_vid: i64, _user: User) -> Status {
    Status::NotImplemented
}

#[get("/videos/<_vid>/download-url")]
pub async fn api_video_download_url(_vid: i64, _user: User) -> Status {
    Status::NotImplemented
}

#[post("/videos/<_vid>/watch-events")]
pub async fn api_video_watch_events(_vid: i64, _user: User) -> Status {
    Status::NotImplemented
}

#[post("/videos/privacy-ack")]
pub async fn api_video_privacy_ack(_user: User) -> Status {
    Status::NotImplemented
}

#[get("/videos/<_vid>/stats")]
pub async fn api_video_stats(_vid: i64, _user: User) -> Status {
    Status::NotImplemented
}

#[get("/students/<_sid>/watch-activity")]
pub async fn api_student_watch_activity(_sid: i64, _user: User) -> Status {
    Status::NotImplemented
}

#[get("/me/watch-state?<_video_ids>")]
pub async fn api_my_watch_state(_video_ids: Vec<i64>, _user: User) -> Status {
    Status::NotImplemented
}

#[get("/dashboard/video-overview")]
pub async fn api_dashboard_video_overview(_user: User) -> Status {
    Status::NotImplemented
}

#[get("/admin/storage")]
pub async fn api_admin_storage(_user: User) -> Status {
    Status::NotImplemented
}
