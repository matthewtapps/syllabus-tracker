use std::path::Path;

use tracing::{info, warn};

pub fn load_environment() -> Result<(), Box<dyn std::error::Error>> {
    let is_production =
        dotenvy::var("ROCKET_PROFILE").unwrap_or("development".to_string()) == "production";

    // Load most-specific files first so existing shell env wins, then secrets,
    // then environment-specific, then common defaults.
    let env_files = if is_production {
        vec![".secrets.env", "config/prod.env", "config/common.env"]
    } else {
        vec![".secrets.env", "config/dev.env", "config/common.env"]
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

    dotenvy::from_filename(path)?;
    info!("Loaded environment from: {}", path);
    Ok(())
}

#[cfg(any(test, feature = "test-support"))]
pub fn load_test_environment() -> Result<(), Box<dyn std::error::Error>> {
    let test_env_files = vec!["config/common.env", ".secrets.env"];

    for env_file in test_env_files {
        load_env_file(env_file)?;
    }

    Ok(())
}
