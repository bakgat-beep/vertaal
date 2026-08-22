// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        tauri_plugin_sql::Migration {
            version: 1,
            description: "initial_schema",
            sql: include_str!("../migrations/0001_initial.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 2,
            description: "add_category_column",
            sql: include_str!("../migrations/0002_add_category.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 3,
            description: "add_subcategory_column",
            sql: include_str!("../migrations/0003_add_subcategory.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 4,
            description: "add_flagged_column",
            sql: include_str!("../migrations/0004_add_flagged.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 5,
            description: "dedupe_translations_and_add_unique_constraint",
            sql: include_str!("../migrations/0005_dedupe_translations.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 6,
            description: "add_projects_and_multi_language_support",
            sql: include_str!("../migrations/0006_projects_and_languages.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:pdx-afrikaans.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}