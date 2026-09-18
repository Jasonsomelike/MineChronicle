use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn install(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "打开 MineChronicle", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "彻底退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut tray = TrayIconBuilder::with_id("minechronicle")
        .tooltip("MineChronicle · 点击打开，右键退出")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show(app),
            "quit" => {
                // Mark an unfinished observation honestly before terminating.
                // This opens SQLite and runs a migration check, so do it off the
                // UI thread and exit from there; the menu callback returns at
                // once instead of blocking the window.
                let app = app.clone();
                std::thread::spawn(move || {
                    if let Some(database) = app.try_state::<crate::database::DatabaseState>() {
                        if let Ok(repo) = crate::database::Repository::open(&database.path) {
                            let _ = repo.interrupt_observed_sessions();
                        }
                    }
                    app.exit(0);
                });
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg(windows)]
pub struct InstanceGuard(*mut std::ffi::c_void);
#[cfg(windows)]
impl Drop for InstanceGuard {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

/// Creates (or opens) the named single-instance mutex.
///
/// Returns the guard plus whether the mutex already existed, i.e. another
/// instance owns it. Split out from `single_instance` so the mutual-exclusion
/// behaviour can be tested with a unique name instead of the real one, and so
/// the wait-for-window loop stays out of the test path.
#[cfg(windows)]
pub fn acquire_instance_mutex(name: &str) -> std::io::Result<(InstanceGuard, bool)> {
    use std::{ffi::c_void, ptr::null};
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateMutexW(attributes: *const c_void, owner: i32, name: *const u16) -> *mut c_void;
    }
    let name: Vec<_> = name.encode_utf16().chain(Some(0)).collect();
    unsafe {
        let handle = CreateMutexW(null(), 0, name.as_ptr());
        if handle.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        // ERROR_ALREADY_EXISTS is 183; CreateMutexW sets it when the named
        // object already existed, which is how a second launch is detected.
        let already_exists = windows_sys::Win32::Foundation::GetLastError() == 183;
        Ok((InstanceGuard(handle), already_exists))
    }
}

/// Outcome of the second-instance check.
#[cfg(windows)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecondLaunch {
    /// This is the only instance; keep the guard for the process lifetime.
    Primary,
    /// Another instance was found and its window was brought to the front.
    Focused,
    /// Another instance holds the mutex but no window appeared in time.
    Unresponsive,
}

/// A second launch restores the resident window, avoiding duplicate trackers.
#[cfg(windows)]
pub fn single_instance() -> std::io::Result<(InstanceGuard, SecondLaunch)> {
    use std::{ffi::c_void, ptr::null};
    #[link(name = "user32")]
    extern "system" {
        fn FindWindowW(class: *const u16, title: *const u16) -> *mut c_void;
        fn ShowWindow(window: *mut c_void, command: i32) -> i32;
        fn SetForegroundWindow(window: *mut c_void) -> i32;
    }
    let (guard, already_exists) = acquire_instance_mutex("Local\\MineChronicle.Desktop.Instance")?;
    if !already_exists {
        return Ok((guard, SecondLaunch::Primary));
    }
    // 10 x 100 ms rather than 30: the resident process is already running, so a
    // window that is not up within a second is not coming, and the extra two
    // seconds were pure delay before an unexplained exit.
    let title: Vec<_> = "MineChronicle".encode_utf16().chain(Some(0)).collect();
    for _ in 0..10 {
        let window = unsafe { FindWindowW(null(), title.as_ptr()) };
        if !window.is_null() {
            unsafe {
                ShowWindow(window, 9);
                SetForegroundWindow(window);
            }
            return Ok((guard, SecondLaunch::Focused));
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    // The mutex is held but nothing could be focused. Reported rather than
    // returning a bare None, because the caller used to exit with code 0 and no
    // message at all - a double-click that appeared to do nothing.
    Ok((guard, SecondLaunch::Unresponsive))
}

/// Tells the user why a second launch did nothing, instead of exiting silently.
///
/// `MessageBoxW` is used because this runs before the Tauri window exists, so
/// there is no UI to report through yet.
#[cfg(windows)]
pub fn report_second_launch(outcome: SecondLaunch) {
    use std::ffi::c_void;
    if outcome != SecondLaunch::Unresponsive {
        return;
    }
    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(
            window: *mut c_void,
            text: *const u16,
            caption: *const u16,
            kind: u32,
        ) -> i32;
    }
    // MB_ICONINFORMATION | MB_SETFOREGROUND (MB_OK is 0)
    const KIND: u32 = 0x40 | 0x10000;
    let text: Vec<u16> = "MineChronicle 已在运行，但未能找到它的窗口。\n\n请从任务栏打开，或在任务管理器中结束 MineChronicle 后重试。"
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let caption: Vec<u16> = "MineChronicle".encode_utf16().chain(Some(0)).collect();
    unsafe {
        MessageBoxW(std::ptr::null_mut(), text.as_ptr(), caption.as_ptr(), KIND);
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    /// Two acquisitions of the same name must not both claim to be first.
    #[test]
    fn second_acquisition_reports_an_existing_instance() {
        // A unique name keeps this independent of a real running MineChronicle
        // and of previous runs, whose mutex object can outlive the process.
        let name = format!(
            "Local\\MineChronicle.Test.{}.{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_nanos())
        );
        let (first, first_existed) = acquire_instance_mutex(&name).expect("first");
        assert!(
            !first_existed,
            "the first acquisition must create the mutex"
        );

        let (second, second_existed) = acquire_instance_mutex(&name).expect("second");
        assert!(
            second_existed,
            "the second acquisition must observe the existing mutex"
        );

        // Dropping both handles releases the name.
        drop(first);
        drop(second);
        let (_third, third_existed) = acquire_instance_mutex(&name).expect("third");
        assert!(
            !third_existed,
            "after every guard is dropped the name must be free again"
        );
    }
}
