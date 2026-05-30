use rocket::State;
use rocket::serde::{Deserialize, Serialize, json::Json};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Capabilities {
    pub videos: bool,
}

#[get("/capabilities")]
pub fn api_capabilities(caps: &State<Capabilities>) -> Json<Capabilities> {
    Json(**caps)
}
