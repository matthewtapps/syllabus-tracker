#[macro_use]
extern crate rocket;

pub mod api;
pub mod auth;
pub mod capabilities;
pub mod catchers;
pub mod db;
pub mod env;
pub mod error;
pub mod models;
pub mod syllabi;
pub mod telemetry;
pub mod validation;
pub mod videos;

pub mod lib {
    pub mod seed;
}
