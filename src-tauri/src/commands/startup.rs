use serde::Serialize;

#[derive(Serialize)]
pub struct StartupStatus {
    supported: bool,
    enabled: bool,
    executable: String,
}

fn quoted_command(path: &std::path::Path) -> Result<String, String> {
    let text = path.to_str().ok_or("启动路径不是有效的Unicode")?;
    if text.contains('"') || text.contains(['\r', '\n']) {
        return Err("无效启动路径".into());
    }
    let command = format!("\"{text}\"");
    if command.encode_utf16().count() > 260 {
        return Err("启动路径过长，Windows启动项最多支持260字符".into());
    }
    Ok(command)
}

#[cfg(windows)]
mod platform {
    use windows_sys::Win32::{
        Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS},
        System::Registry::*,
    };
    const KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    const VALUE: &str = "MineChronicle";
    use crate::wide::wide;
    pub fn read() -> Result<String, String> {
        let mut data = vec![0u16; 32768];
        let mut bytes = (data.len() * 2) as u32;
        // Read only this application's startup value, never enumerate other programs.
        let code = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                wide(KEY).as_ptr(),
                wide(VALUE).as_ptr(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                data.as_mut_ptr().cast(),
                &mut bytes,
            )
        };
        if code == ERROR_FILE_NOT_FOUND {
            return Ok(String::new());
        }
        if code != ERROR_SUCCESS {
            return Err(std::io::Error::from_raw_os_error(code as i32).to_string());
        }
        String::from_utf16(&data[..(bytes as usize / 2).saturating_sub(1)])
            .map_err(|e| e.to_string())
    }
    pub fn write(command: Option<&str>) -> Result<(), String> {
        let mut key = std::ptr::null_mut();
        let code = unsafe { RegCreateKeyW(HKEY_CURRENT_USER, wide(KEY).as_ptr(), &mut key) };
        if code != ERROR_SUCCESS {
            return Err(std::io::Error::from_raw_os_error(code as i32).to_string());
        }
        let code = unsafe {
            let result = if let Some(command) = command {
                let text = wide(command);
                RegSetValueExW(
                    key,
                    wide(VALUE).as_ptr(),
                    0,
                    REG_SZ,
                    text.as_ptr().cast(),
                    (text.len() * 2) as u32,
                )
            } else {
                RegDeleteValueW(key, wide(VALUE).as_ptr())
            };
            RegCloseKey(key);
            result
        };
        if code == ERROR_SUCCESS || (command.is_none() && code == ERROR_FILE_NOT_FOUND) {
            Ok(())
        } else {
            Err(std::io::Error::from_raw_os_error(code as i32).to_string())
        }
    }
}

/// Reads the registry; the command wrapper keeps it off the main thread.
fn startup_status_sync() -> Result<StartupStatus, String> {
    let executable = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .into_owned();
    #[cfg(windows)]
    let registered = platform::read()?;
    #[cfg(windows)]
    let enabled = !registered.is_empty();
    #[cfg(windows)]
    let executable = if enabled {
        registered.trim_matches('"').to_owned()
    } else {
        executable
    };
    #[cfg(not(windows))]
    let enabled = false;
    Ok(StartupStatus {
        supported: cfg!(windows),
        enabled,
        executable,
    })
}

#[tauri::command]
pub async fn startup_status() -> Result<StartupStatus, String> {
    tauri::async_runtime::spawn_blocking(startup_status_sync)
        .await
        .map_err(|e| e.to_string())?
}

/// Writes the registry; the command wrapper keeps it off the main thread.
#[cfg(windows)]
fn set_startup_enabled_sync(enabled: bool) -> Result<StartupStatus, String> {
    if enabled {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        platform::write(Some(&quoted_command(&exe)?))?;
    } else {
        platform::write(None)?;
    }
    startup_status_sync()
}

#[tauri::command]
pub async fn set_startup_enabled(enabled: bool) -> Result<StartupStatus, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || set_startup_enabled_sync(enabled))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err("仅Windows桌面版支持开机自启动".into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn startup_command_quotes_spaces_and_rejects_invalid_paths() {
        assert_eq!(
            quoted_command(std::path::Path::new("D:/游戏 软件/MineChronicle.exe"))
                .ok()
                .as_deref(),
            Some("\"D:/游戏 软件/MineChronicle.exe\"")
        );
        assert!(quoted_command(std::path::Path::new("D:/bad\"path.exe")).is_err());
        assert!(quoted_command(std::path::Path::new(&"x".repeat(260))).is_err());
    }
}
