//! Small shared Windows helpers.
//!
//! `wide` builds the NUL-terminated UTF-16 buffer that the `*W` Win32 APIs
//! require. It was duplicated verbatim in the startup-registry and PCL-folder
//! modules; keeping one copy avoids the trailing NUL being dropped in one place
//! only, which would silently read past the end of the string.
#[cfg(windows)]
pub(crate) fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
