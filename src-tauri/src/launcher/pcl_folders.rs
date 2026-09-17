//! Read only PCL's folder registry value and running launcher executable paths.
use serde::{Deserialize, Serialize};
use std::{
    io,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PclFolder {
    pub name: String,
    pub path: PathBuf,
    pub available: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PclLink {
    pub folders: Vec<PclFolder>,
    pub launchers: Vec<PathBuf>,
    pub issues: Vec<String>,
}

pub fn parse_folders(value: &str) -> io::Result<Vec<PclFolder>> {
    if value.len() > 128 * 1024 {
        return Err(io::Error::other("PCL 文件夹配置过大"));
    }
    let mut folders = Vec::new();
    for entry in value.split('|').filter(|s| !s.is_empty()) {
        if folders.len() >= 32 {
            return Err(io::Error::other("PCL 文件夹超过 32 个，请分批手动导入"));
        }
        let (name, raw) = entry
            .split_once('>')
            .ok_or_else(|| io::Error::other("PCL 文件夹列表格式无效"))?;
        let path = PathBuf::from(raw);
        if name.is_empty() || !path.is_absolute() || path.parent().is_none() {
            return Err(io::Error::other(
                "PCL 文件夹必须是明确的绝对目录，不能是整块磁盘",
            ));
        }
        let path = std::fs::canonicalize(&path).unwrap_or(path);
        if !folders.iter().any(|f: &PclFolder| f.path == path) {
            folders.push(PclFolder {
                name: name.to_owned(),
                available: path.is_dir(),
                path,
            });
        }
    }
    Ok(folders)
}

pub fn discover() -> io::Result<PclLink> {
    let mut folders = parse_folders(&platform::folder_value()?)?;
    let launchers = platform::launchers()?;
    for base in &launchers {
        let mut candidates = vec![base.clone()];
        if let Ok(entries) = std::fs::read_dir(base) {
            candidates.extend(
                entries
                    .take(256)
                    .filter_map(Result::ok)
                    .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
                    .map(|e| e.path()),
            );
        }
        for path in candidates {
            if path.join("versions").is_dir() || path.file_name().is_some_and(|n| n == ".minecraft")
            {
                let path = std::fs::canonicalize(&path)?;
                if !folders.iter().any(|f| f.path == path) {
                    folders.push(PclFolder {
                        name: "当前启动器文件夹".into(),
                        available: true,
                        path,
                    });
                }
            }
        }
    }
    let mut issues = Vec::new();
    if launchers.is_empty() {
        issues.push(
            "未检测到正在运行的 PCL；可读取已保存文件夹，打开 PCL 后重新连接可确认全局隔离设置。"
                .into(),
        );
    }
    if folders.len() > 32 {
        return Err(io::Error::other("PCL 文件夹超过 32 个，请分批手动导入"));
    }
    Ok(PclLink {
        folders,
        launchers,
        issues,
    })
}

pub fn validate_launcher(path: &Path) -> io::Result<PathBuf> {
    let path = std::fs::canonicalize(path)?;
    if !path.join("PCL/Setup.ini").is_file() {
        return Err(io::Error::other("所选目录没有 PCL/Setup.ini"));
    }
    Ok(path)
}

#[cfg(windows)]
mod platform {
    use super::*;
    use crate::wide::wide;
    use windows_sys::Win32::{
        Foundation::{CloseHandle, ERROR_FILE_NOT_FOUND, ERROR_SUCCESS, INVALID_HANDLE_VALUE},
        System::{Diagnostics::ToolHelp::*, Registry::*, Threading::*},
    };
    pub fn folder_value() -> io::Result<String> {
        let mut data = vec![0u16; 65536];
        let mut bytes = (data.len() * 2) as u32;
        // Fixed key/value, read-only API; no authentication values enumerated.
        let result = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                wide("Software\\PCL").as_ptr(),
                wide("LaunchFolders").as_ptr(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                data.as_mut_ptr().cast(),
                &mut bytes,
            )
        };
        if result == ERROR_FILE_NOT_FOUND {
            return Ok(String::new());
        }
        if result != ERROR_SUCCESS {
            return Err(io::Error::from_raw_os_error(result as i32));
        }
        String::from_utf16(&data[..(bytes as usize / 2).saturating_sub(1)])
            .map_err(io::Error::other)
    }
    pub fn launchers() -> io::Result<Vec<PathBuf>> {
        let mut found = Vec::new();
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot == INVALID_HANDLE_VALUE {
                return Err(io::Error::last_os_error());
            }
            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            let mut valid = Process32FirstW(snapshot, &mut entry) != 0;
            while valid {
                let end = entry
                    .szExeFile
                    .iter()
                    .position(|v| *v == 0)
                    .unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..end]).to_ascii_lowercase();
                if name.contains("plain craft launcher") || name.starts_with("pcl") {
                    let handle =
                        OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, entry.th32ProcessID);
                    if !handle.is_null() {
                        let mut buf = vec![0u16; 32768];
                        let mut size = buf.len() as u32;
                        if QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size) != 0 {
                            let exe =
                                PathBuf::from(String::from_utf16_lossy(&buf[..size as usize]));
                            if let Some(base) = exe.parent() {
                                if let Ok(base) = super::validate_launcher(base) {
                                    if !found.contains(&base) {
                                        found.push(base);
                                    }
                                }
                            }
                        }
                        CloseHandle(handle);
                    }
                }
                valid = Process32NextW(snapshot, &mut entry) != 0;
            }
            CloseHandle(snapshot);
        }
        found.sort();
        Ok(found)
    }
}
#[cfg(not(windows))]
mod platform {
    use super::*;
    pub fn folder_value() -> io::Result<String> {
        Ok(String::new())
    }
    pub fn launchers() -> io::Result<Vec<PathBuf>> {
        Ok(Vec::new())
    }
}
