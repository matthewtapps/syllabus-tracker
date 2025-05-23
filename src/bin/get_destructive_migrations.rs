use std::path::Path;

use sqlx::SqlitePool;
use syllabus_tracker::lib::migrations::{
    MigrationError, get_schema_changes, read_schema_file_to_string,
};

#[tokio::main]
async fn main() {
    let destructive_changes = get_destructive_changes()
        .await
        .expect("Failed to check for destructive changes");

    let no_destructive_changes = destructive_changes.tables_removed.len() == 0
        && destructive_changes.indexes_removed.len() == 0
        && destructive_changes.columns_removed.len() == 0;

    if no_destructive_changes {
        println!("Changes passed the check ✓");
    } else {
        println!("Destructive changes detected:");
        if destructive_changes.tables_removed.len() > 0 {
            print_string_vec(
                destructive_changes.tables_removed,
                Some(&"    Table removed:"),
            );
        }

        if destructive_changes.indexes_removed.len() > 0 {
            print_string_vec(
                destructive_changes.indexes_removed,
                Some(&"    Index removed:"),
            );
        }

        if destructive_changes.columns_removed.len() > 0 {
            for table in destructive_changes.columns_removed {
                let table_prefix = format!("    Column removed from table {}:", table.table_name);
                print_string_vec(table.columns_removed, Some(&table_prefix));
            }
        }
    }
}

fn print_string_vec(vec: Vec<String>, prefix: Option<&str>) {
    let print_prefix = prefix.unwrap_or("");
    for string in vec {
        println!("{} {}", print_prefix, string)
    }
}

struct DestructiveChanges {
    tables_removed: Vec<String>,
    columns_removed: Vec<ColumnDestructiveChanges>,
    indexes_removed: Vec<String>,
}

struct ColumnDestructiveChanges {
    table_name: String,
    columns_removed: Vec<String>,
}

async fn get_destructive_changes() -> Result<DestructiveChanges, MigrationError> {
    let schema_var =
        std::env::var("SCHEMA_PATH").expect("Failed to find schema path from environment variable");
    let schema_path = Path::new(&schema_var);

    let schema = read_schema_file_to_string(schema_path)?;

    let database_url = std::env::var("DATABASE_URL").expect("Failed to find database url");

    let pool = SqlitePool::connect(&database_url)
        .await
        .expect("Failed to connect to SQLite database");

    let changes_needed = get_schema_changes(pool, &schema).await?;

    let mut columns_removed: Vec<ColumnDestructiveChanges> = Vec::new();

    for table in changes_needed.modified_tables {
        columns_removed.push(ColumnDestructiveChanges {
            table_name: table.name,
            columns_removed: table.removed_columns,
        })
    }

    Ok(DestructiveChanges {
        tables_removed: changes_needed.removed_tables,
        indexes_removed: changes_needed.removed_indices,
        columns_removed,
    })
}
