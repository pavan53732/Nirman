// Stream Service — captures real window frames and streams via WebSocket.
// Windows: uses Windows Graphics Capture API.
// Android: uses adb screencap loop.
// Web: no capture needed (iframe serves directly).

/// Capture Android screen via `adb exec-out screencap -p`.
pub async fn capture_android_screen() -> Option<Vec<u8>> {
    use std::process::Stdio;
    use tokio::process::Command;

    let result = Command::new("adb")
        .args(["exec-out", "screencap", "-p"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await
        .ok()?;

    if result.status.success() {
        Some(result.stdout)
    } else {
        None
    }
}
