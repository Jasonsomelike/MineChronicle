use super::DiscoveredInstance;
use serde::Serialize;
use std::{collections::BTreeMap, path::PathBuf};

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct ActiveInstance {
    pub game_root: PathBuf,
    pub name: String,
    pub pids: Vec<u32>,
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::{
        fs,
        os::windows::process::CommandExt,
        process::{Child, Command, Stdio},
        time::{Duration, Instant},
    };

    type TestResult = Result<(), Box<dyn std::error::Error + Send + Sync>>;

    struct ChildGuard(Child);
    impl Drop for ChildGuard {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    #[test]
    #[ignore = "subprocess fixture, invoked only by the lifecycle regression test"]
    fn fixture_wait() -> TestResult {
        let Some(directory) = std::env::var_os("MINECHRONICLE_PROCESS_FIXTURE") else {
            return Ok(());
        };
        let directory = PathBuf::from(directory);
        let deadline = Instant::now() + Duration::from_secs(30);
        while Instant::now() < deadline {
            if directory.join("erase").exists() && !directory.join("erased").exists() {
                #[link(name = "kernel32")]
                extern "system" {
                    fn GetCommandLineW() -> *mut u16;
                }
                // Mutate only this synthetic test child's command line, mirroring
                // runtimes that scrub launch arguments after initialization.
                unsafe {
                    let text = GetCommandLineW();
                    let mut length = 0;
                    while *text.add(length) != 0 {
                        length += 1;
                    }
                    std::ptr::write_bytes(text, 0, length);
                }
                fs::write(directory.join("erased"), b"ready")?;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        Ok(())
    }

    #[test]
    fn native_lifetime_survives_erased_arguments_and_releases_exited_process() -> TestResult {
        let temp = tempfile::tempdir()?;
        let executable = temp.path().join("javaw.exe");
        fs::copy(std::env::current_exe()?, &executable)?;
        let mut command = Command::new(&executable);
        command.args([
            "--exact",
            "launcher::running::tests::fixture_wait",
            "--ignored",
        ]);
        // Harness skip values are real argv entries without being harness flags.
        command
            .arg("--skip")
            .arg(format!("--gameDir={}", temp.path().display()))
            .arg("--skip")
            .arg("--version=Lifecycle fixture")
            .env("MINECHRONICLE_PROCESS_FIXTURE", temp.path())
            .creation_flags(0x08000000)
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = ChildGuard(command.spawn()?);
        let pid = child.0.id();
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if running_games()?.iter().any(|g| g.pid == pid) {
                break;
            }
            if Instant::now() > deadline {
                return Err("fixture not detected".into());
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        fs::write(temp.path().join("erase"), b"erase fixture args")?;
        while !temp.path().join("erased").exists() {
            if Instant::now() > deadline {
                return Err("fixture did not erase arguments".into());
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        for _ in 0..4 {
            let games = running_games()?;
            let game = games
                .iter()
                .find(|g| g.pid == pid)
                .ok_or("live game lost after arguments disappeared")?;
            assert_eq!(game.game_root, temp.path());
            assert_eq!(game.version.as_deref(), Some("Lifecycle fixture"));
            std::thread::sleep(Duration::from_millis(100));
        }
        child.0.kill()?;
        child.0.wait()?;
        assert!(!running_games()?.iter().any(|g| g.pid == pid));
        // A fresh process without game arguments must not inherit the old identity.
        let mut unrelated = ChildGuard(
            Command::new(&executable)
                .args([
                    "--exact",
                    "launcher::running::tests::fixture_wait",
                    "--ignored",
                ])
                .env("MINECHRONICLE_PROCESS_FIXTURE", temp.path())
                .creation_flags(0x08000000)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()?,
        );
        assert!(!running_games()?.iter().any(|g| g.pid == unrelated.0.id()));
        unrelated.0.kill()?;
        unrelated.0.wait()?;
        Ok(())
    }
}
#[derive(Clone, Debug)]
pub struct RunningGame {
    pub pid: u32,
    pub game_root: PathBuf,
    pub version: Option<String>,
}
pub fn game_from_args(pid: u32, args: &[String]) -> Option<RunningGame> {
    let argument = |name: &str| {
        args.iter().enumerate().find_map(|(i, arg)| {
            if arg == name {
                args.get(i + 1).filter(|v| !v.starts_with("--")).cloned()
            } else {
                arg.strip_prefix(&format!("{name}=")).map(str::to_owned)
            }
        })
    };
    let game_root = PathBuf::from(argument("--gameDir")?);
    if !game_root.is_absolute() {
        return None;
    }
    Some(RunningGame {
        pid,
        game_root,
        version: argument("--version"),
    })
}
pub fn match_instances(
    games: &[RunningGame],
    instances: &[DiscoveredInstance],
) -> Vec<ActiveInstance> {
    let key = |p: &std::path::Path| {
        let p = std::fs::canonicalize(p).unwrap_or_else(|_| p.to_owned());
        p.to_string_lossy()
            .trim_start_matches(r"\\?\")
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_lowercase()
    };
    let mut roots = BTreeMap::<String, ActiveInstance>::new();
    for game in games {
        let matching: Vec<_> = instances
            .iter()
            .filter(|i| key(&i.game_root) == key(&game.game_root))
            .collect();
        let Some(first) = matching.first() else {
            continue;
        };
        let name = matching
            .iter()
            .find(|i| game.version.as_deref() == Some(i.name.as_str()))
            .map(|i| i.name.clone())
            .unwrap_or_else(|| {
                if matching.len() == 1 {
                    first.name.clone()
                } else {
                    format!(
                        "{}（共享目录）",
                        matching
                            .iter()
                            .map(|i| i.name.as_str())
                            .collect::<Vec<_>>()
                            .join(" / ")
                    )
                }
            });
        let entry = roots
            .entry(key(&game.game_root))
            .or_insert_with(|| ActiveInstance {
                game_root: std::fs::canonicalize(&first.game_root)
                    .unwrap_or_else(|_| first.game_root.clone()),
                name: name.clone(),
                pids: Vec::new(),
            });
        if !entry.pids.contains(&game.pid) {
            entry.pids.push(game.pid);
            if entry.name != name {
                entry.name = format!("{} / {name}", entry.name);
            }
        }
    }
    roots.into_values().collect()
}

#[cfg(not(windows))]
pub fn running_games() -> Result<Vec<RunningGame>, String> {
    Ok(Vec::new())
}

#[cfg(windows)]
pub fn running_games() -> Result<Vec<RunningGame>, String> {
    use std::{
        ffi::c_void,
        mem::{size_of, zeroed},
        ptr::null_mut,
        sync::{Mutex, OnceLock},
    };
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Foundation::{
            CloseHandle, GetLastError, ERROR_NO_MORE_FILES, HANDLE, INVALID_HANDLE_VALUE,
            WAIT_OBJECT_0, WAIT_TIMEOUT,
        },
        System::{
            Diagnostics::ToolHelp::*,
            Threading::{
                OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
                PROCESS_SYNCHRONIZE,
            },
        },
        UI::Shell::CommandLineToArgvW,
    };
    #[repr(C)]
    struct UnicodeString {
        length: u16,
        maximum_length: u16,
        buffer: *const u16,
    }
    #[link(name = "ntdll")]
    extern "system" {
        fn NtQueryInformationProcess(
            handle: HANDLE,
            class: u32,
            buffer: *mut c_void,
            size: u32,
            returned: *mut u32,
        ) -> i32;
    }
    struct Handle(HANDLE);
    // Windows kernel handles are usable across threads. Ownership remains unique,
    // and all accesses to the retained handles are protected by the cache mutex.
    unsafe impl Send for Handle {}
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
    struct TrackedProcess {
        handle: Handle,
        game: RunningGame,
    }
    static TRACKED: OnceLock<Mutex<BTreeMap<u32, TrackedProcess>>> = OnceLock::new();
    // Query only java process command lines in memory. Retain gameDir/version only;
    // never log or persist the command line, which can contain account credentials.
    unsafe fn read_args(handle: HANDLE) -> Option<Vec<String>> {
        let mut size = 0;
        unsafe {
            NtQueryInformationProcess(handle, 60, null_mut(), 0, &mut size);
        }
        if !(size_of::<UnicodeString>() as u32..=131072).contains(&size) {
            return None;
        }
        let mut buffer = vec![0usize; (size as usize).div_ceil(size_of::<usize>())];
        if unsafe {
            NtQueryInformationProcess(handle, 60, buffer.as_mut_ptr().cast(), size, &mut size)
        } < 0
        {
            return None;
        }
        let value = unsafe { &*buffer.as_ptr().cast::<UnicodeString>() };
        let start = value.buffer as usize;
        let base = buffer.as_ptr() as usize;
        let length = value.length as usize;
        if !length.is_multiple_of(2)
            || !start.is_multiple_of(2)
            || start < base
            || start.checked_add(length)? > base + buffer.len() * size_of::<usize>()
        {
            return None;
        }
        let mut text = unsafe { std::slice::from_raw_parts(value.buffer, length / 2) }.to_vec();
        text.push(0);
        let mut count = 0;
        let parsed = unsafe { CommandLineToArgvW(text.as_ptr(), &mut count) };
        if parsed.is_null() {
            return None;
        }
        let mut args = Vec::new();
        for pointer in unsafe { std::slice::from_raw_parts(parsed, count as usize) } {
            let mut len = 0;
            while unsafe { *pointer.add(len) } != 0 {
                len += 1;
            }
            args.push(String::from_utf16_lossy(unsafe {
                std::slice::from_raw_parts(*pointer, len)
            }));
        }
        unsafe {
            LocalFree(parsed.cast());
        }
        Some(args)
    }
    unsafe {
        let mut tracked = TRACKED
            .get_or_init(Default::default)
            .lock()
            .map_err(|_| "游戏进程追踪状态暂时不可用")?;
        // Keep the actual process object, not just its PID or mutable command line.
        // A signaled handle proves termination even if Windows reuses that PID.
        let mut exited = Vec::new();
        for (pid, process) in tracked.iter() {
            match WaitForSingleObject(process.handle.0, 0) {
                WAIT_OBJECT_0 => exited.push(*pid),
                WAIT_TIMEOUT => {}
                _ => return Err("暂时无法确认游戏进程是否退出，保留当前追踪".into()),
            }
        }
        for pid in exited {
            tracked.remove(&pid);
        }
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return Err("暂时无法检查游戏进程".into());
        }
        let snapshot = Handle(snapshot);
        let mut entry: PROCESSENTRY32W = zeroed();
        entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        let mut valid = Process32FirstW(snapshot.0, &mut entry) != 0;
        while valid {
            let len = entry
                .szExeFile
                .iter()
                .position(|v| *v == 0)
                .unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
            if !tracked.contains_key(&entry.th32ProcessID)
                && (name.eq_ignore_ascii_case("javaw.exe") || name.eq_ignore_ascii_case("java.exe"))
            {
                let handle = OpenProcess(
                    PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                    0,
                    entry.th32ProcessID,
                );
                if !handle.is_null() {
                    let handle = Handle(handle);
                    if let Some(args) = read_args(handle.0) {
                        if let Some(game) = game_from_args(entry.th32ProcessID, &args) {
                            tracked.insert(game.pid, TrackedProcess { handle, game });
                        }
                    }
                }
            }
            valid = Process32NextW(snapshot.0, &mut entry) != 0;
        }
        if GetLastError() != ERROR_NO_MORE_FILES {
            return Err("游戏进程列表读取不完整，保留当前追踪".into());
        }
        Ok(tracked.values().map(|p| p.game.clone()).collect())
    }
}
