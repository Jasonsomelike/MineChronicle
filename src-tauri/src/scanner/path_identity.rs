use std::{
    fs::{self, File},
    io,
    path::{Path, PathBuf},
};

/// Keep the handle open for the scan, so a removed directory's ID cannot be
/// reused while deduplication is still in progress. Never compare lossy strings.
#[derive(Debug)]
pub struct DirectoryIdentity {
    pub canonical_path: PathBuf,
    pub key: FileIdentity,
    _handle: File,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct FileIdentity {
    pub volume: u64,
    pub id: u128,
}

impl DirectoryIdentity {
    pub fn open(path: &Path) -> io::Result<Self> {
        let canonical_path = fs::canonicalize(path)?;
        if !fs::metadata(&canonical_path)?.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::NotADirectory,
                "game root is not a directory",
            ));
        }
        let (file, key) = identity(&canonical_path)?;
        Ok(Self {
            canonical_path,
            key,
            _handle: file,
        })
    }
}

#[cfg(windows)]
fn identity(path: &Path) -> io::Result<(File, FileIdentity)> {
    use std::{
        fs::OpenOptions,
        os::windows::{fs::OpenOptionsExt, io::AsRawHandle},
    };
    use windows_sys::Win32::Storage::FileSystem::{
        FileIdInfo, GetFileInformationByHandleEx, FILE_FLAG_BACKUP_SEMANTICS, FILE_ID_INFO,
    };
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)?;
    let mut info = FILE_ID_INFO::default();
    // SAFETY: the live File owns a valid handle. `info` is correctly aligned and
    // sized for FileIdInfo; the OS only writes inside this initialized buffer.
    let success = unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileIdInfo,
            (&mut info as *mut FILE_ID_INFO).cast(),
            std::mem::size_of::<FILE_ID_INFO>() as u32,
        )
    };
    if success == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok((
        file,
        FileIdentity {
            volume: info.VolumeSerialNumber,
            id: u128::from_le_bytes(info.FileId.Identifier),
        },
    ))
}

#[cfg(unix)]
fn identity(path: &Path) -> io::Result<(File, FileIdentity)> {
    use std::os::unix::fs::MetadataExt;
    let file = File::open(path)?;
    let metadata = file.metadata()?;
    let key = FileIdentity {
        volume: metadata.dev(),
        id: u128::from(metadata.ino()),
    };
    Ok((file, key))
}

/// Explicit root aliases are resolved, but links/reparse points below a root
/// are not traversed: their target was not explicitly selected by the user.
pub fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}
