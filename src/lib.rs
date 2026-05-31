#[macro_use]
extern crate rocket;

use std::path::Path;

pub mod api;
pub mod auth;
pub mod capabilities;
pub mod db;
pub mod env;
pub mod error;
pub mod models;
pub mod telemetry;
pub mod validation;
pub mod videos;

pub mod lib {
    pub mod migrations;
}

pub fn get_schema_string() -> String {
    let schema_var =
        dotenvy::var("SCHEMA_PATH").expect("Failed to find schema path from environment variable");
    lib::migrations::read_schema_file_to_string(Path::new(&schema_var))
        .expect("Failed to read schema file to string")
}
