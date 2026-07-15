// Build Service — real compilation via child_process.
// No mocks, no timers. Real duration via Instant::now().

use super::BuildResult;
use std::process::Stdio;
use std::time::Instant;
use tokio::process::Command;

/// Check if a command exists and return its version output.
pub async fn check_command(cmd: &str, args: &[&str]) -> Option<String> {
    let result = Command::new(cmd)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .ok()?;

    let output = if !result.stdout.is_empty() {
        String::from_utf8_lossy(&result.stdout).to_string()
    } else {
        String::from_utf8_lossy(&result.stderr).to_string()
    };

    // Return first line as version
    output.lines().next().map(|s| s.trim().to_string())
}

/// Build a Windows desktop target using `dotnet build`.
pub async fn build_windows(project_path: &str) -> BuildResult {
    let desktop_path = format!("{}/desktop", project_path);
    let start = Instant::now();

    let result = Command::new("dotnet")
        .args(["build", "--configuration", "Release"])
        .current_dir(&desktop_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await;

    let duration_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(output) => BuildResult {
            success: output.status.success(),
            duration_ms,
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            target: "desktop".to_string(),
        },
        Err(e) => BuildResult {
            success: false,
            duration_ms,
            stdout: String::new(),
            stderr: format!("Failed to run dotnet build: {}. Is .NET SDK installed?", e),
            target: "desktop".to_string(),
        },
    }
}

/// Build an Android target using `./gradlew assembleDebug`.
pub async fn build_android(project_path: &str) -> BuildResult {
    let android_path = format!("{}/android", project_path);
    let start = Instant::now();

    let gradlew = if cfg!(windows) { "gradlew.bat" } else { "./gradlew" };

    let result = Command::new(gradlew)
        .args(["assembleDebug"])
        .current_dir(&android_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await;

    let duration_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(output) => BuildResult {
            success: output.status.success(),
            duration_ms,
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            target: "android".to_string(),
        },
        Err(e) => BuildResult {
            success: false,
            duration_ms,
            stdout: String::new(),
            stderr: format!("Failed to run gradlew: {}. Is Android SDK installed?", e),
            target: "android".to_string(),
        },
    }
}

/// Build a web target using `npm run build`.
pub async fn build_web(project_path: &str) -> BuildResult {
    let web_path = format!("{}/web-admin", project_path);
    let start = Instant::now();

    let result = Command::new("npm")
        .args(["run", "build"])
        .current_dir(&web_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await;

    let duration_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(output) => BuildResult {
            success: output.status.success(),
            duration_ms,
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            target: "web".to_string(),
        },
        Err(e) => BuildResult {
            success: false,
            duration_ms,
            stdout: String::new(),
            stderr: format!("Failed to run npm build: {}", e),
            target: "web".to_string(),
        },
    }
}
