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
                if let Some(database) = app.try_state::<crate::database::DatabaseState>() {
                    if let Ok(repo) = crate::database::Repository::open(&database.path) {
                        let _ = repo.interrupt_observed_sessions();
                    }
                }
                app.exit(0);
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

/// A second launch restores the resident window, avoiding duplicate trackers.
#[cfg(windows)]
pub fn single_instance() -> std::io::Result<Option<InstanceGuard>> {
    use std::{ffi::c_void, ptr::null};
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateMutexW(attributes: *const c_void, owner: i32, name: *const u16) -> *mut c_void;
    }
    #[link(name = "user32")]
    extern "system" {
        fn FindWindowW(class: *const u16, title: *const u16) -> *mut c_void;
        fn ShowWindow(window: *mut c_void, command: i32) -> i32;
        fn SetForegroundWindow(window: *mut c_void) -> i32;
    }
    let name: Vec<_> = "Local\\MineChronicle.Desktop.Instance"
        .encode_utf16()
        .chain(Some(0))
        .collect();
    unsafe {
        let handle = CreateMutexW(null(), 0, name.as_ptr());
        if handle.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        let already_exists = windows_sys::Win32::Foundation::GetLastError() == 183;
        let guard = InstanceGuard(handle);
        if !already_exists {
            return Ok(Some(guard));
        }
        let title: Vec<_> = "MineChronicle".encode_utf16().chain(Some(0)).collect();
        for _ in 0..30 {
            let window = FindWindowW(null(), title.as_ptr());
            if !window.is_null() {
                ShowWindow(window, 9);
                SetForegroundWindow(window);
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        Ok(None)
    }
}
