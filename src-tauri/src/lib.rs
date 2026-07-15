// Nirman Desktop — Unified Builder Host
// Tauri 2.0 application that wraps the Next.js frontend and provides
// native OS access for real build execution, preview streaming, and
// file watching.
//
// When Rust is installed, `bun run tauri:dev` compiles and launches
// this as a native desktop window. Without Rust, the web version at
// localhost:3000 still works with CodeViewer fallback.

mod preview_engine;

use preview_engine::{check_sdks, build_target, start_preview, stop_preview};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            check_sdks,
            build_target,
            start_preview,
            stop_preview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nirman Desktop");
}
