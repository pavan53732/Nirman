// Preview Engine — real build execution, preview launching, and stream service.
// No mocks, no timers. Uses real child_process spawning via Tauri shell plugin.

pub mod build_service;
pub mod preview_manager;
pub mod stream_service;

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct SdkStatus {
    pub dotnet: Option<String>,
    pub java: Option<String>,
    pub android_sdk: bool,
    pub gradle: bool,
    pub rust: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BuildResult {
    pub success: bool,
    pub duration_ms: u64,
    pub stdout: String,
    pub stderr: String,
    pub target: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PreviewHandle {
    pub id: String,
    pub target: String,
    pub pid: Option<u32>,
    pub stream_url: Option<String>,
    pub window_handle: Option<u64>,
    pub error: Option<String>,
}

/// Check which SDKs are installed on the system.
#[tauri::command]
pub async fn check_sdks() -> SdkStatus {
    SdkStatus {
        dotnet: build_service::check_command("dotnet", &["--version"]).await,
        java: build_service::check_command("java", &["-version"]).await,
        android_sdk: std::env::var("ANDROID_HOME").is_ok(),
        gradle: build_service::check_command("gradle", &["--version"]).await.is_some(),
        rust: build_service::check_command("rustc", &["--version"]).await,
    }
}

/// Build a target (web/desktop/android) using real toolchain.
#[tauri::command]
pub async fn build_target(target: String, project_path: String) -> BuildResult {
    match target.as_str() {
        "web" => build_service::build_web(&project_path).await,
        "desktop" => build_service::build_windows(&project_path).await,
        "android" => build_service::build_android(&project_path).await,
        _ => BuildResult {
            success: false,
            duration_ms: 0,
            stdout: String::new(),
            stderr: format!("Unknown target: {}", target),
            target,
        },
    }
}

/// Start a live preview for the given target.
#[tauri::command]
pub async fn start_preview(target: String, project_path: String) -> PreviewHandle {
    preview_manager::start(&target, &project_path).await
}

/// Stop a running preview.
#[tauri::command]
pub async fn stop_preview(handle_id: String) -> bool {
    preview_manager::stop(&handle_id).await
}
