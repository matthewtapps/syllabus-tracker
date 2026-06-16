use std::path::{Path, PathBuf};

use tracing::{info, warn};

pub fn load_environment() -> Result<(), Box<dyn std::error::Error>> {
    let is_production =
        dotenvy::var("ROCKET_PROFILE").unwrap_or("development".to_string()) == "production";

    // Load most-specific files first so existing shell env wins, then secrets,
    // then environment-specific, then common defaults.
    let env_files = if is_production {
        vec!["config/prod.env", "config/common.env"]
    } else {
        vec![".secrets.env", "config/dev.env", "config/common.env"]
    };

    for env_file in env_files {
        load_env_file(Path::new(env_file))?;
    }

    Ok(())
}

fn load_env_file(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    if !path.exists() {
        warn!(
            "Warning: Environment file {} not found, skipping",
            path.display()
        );
        return Ok(());
    }

    dotenvy::from_filename(path)?;
    info!("Loaded environment from: {}", path.display());
    Ok(())
}

#[cfg(any(test, feature = "test-support"))]
pub fn load_test_environment() -> Result<(), Box<dyn std::error::Error>> {
    // Tests run with CWD = package dir under cargo workspaces. Chdir to the
    // workspace root (anchored via CARGO_MANIFEST_DIR) so relative paths in
    // env files (e.g. SCHEMA_PATH=config/schema.sql) resolve the same way
    // they did pre-workspace-move. Safe under nextest's process-per-test
    // execution model.
    let workspace_root: PathBuf = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("CARGO_MANIFEST_DIR has at least two ancestors")
        .to_path_buf();
    std::env::set_current_dir(&workspace_root)?;

    for env_file in ["config/common.env", ".secrets.env"] {
        load_env_file(Path::new(env_file))?;
    }

    Ok(())
}
