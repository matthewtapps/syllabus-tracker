use std::path::Path;

use tracing::{info, warn};

pub fn load_environment() -> Result<(), Box<dyn std::error::Error>> {
    let is_production =
        dotenvy::var("ROCKET_PROFILE").unwrap_or("development".to_string()) == "production";

    let env_files = if is_production {
        vec!["config/common.env", "config/prod.env", ".secrets.env"]
    } else {
        vec!["config/common.env", "config/dev.env", ".secrets.env"]
    };

    for env_file in env_files {
        load_env_file(env_file)?;
    }

    Ok(())
}

fn load_env_file(path: &str) -> Result<(), Box<dyn std::error::Error>> {
    if !Path::new(path).exists() {
        warn!("Warning: Environment file {} not found, skipping", path);
        return Ok(());
    }

    dotenvy::from_filename_override(path)?;
    info!("Loaded environment from: {}", path);
    Ok(())
}

#[cfg(test)]
pub fn load_test_environment() -> Result<(), Box<dyn std::error::Error>> {
    let test_env_files = vec!["config/common.env", ".secrets.env"];

    for env_file in test_env_files {
        load_env_file(env_file)?;
    }

    Ok(())
}
