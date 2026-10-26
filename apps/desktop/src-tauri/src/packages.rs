//! The local packages folder (#143): game packages installed from disk, as
//! folders (a package's files) or zips (an editor export), in
//! `<app data>/packages`. Play loads every one; the editor can install into it.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::folders;

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Package {
    /// A package's own files: `game.json`, `content/`, `assets/`.
    Folder { name: String, files: Vec<String> },
    /// A zipped package, as the editor exports.
    Zip { name: String },
}

/// A package name: what an installed zip or folder may be called.
pub fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

/// Every package in `dir`, by name: folders holding a game.json, and .zip files.
pub fn scan(dir: &Path) -> Result<Vec<Package>, String> {
    let mut out = Vec::new();
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(e) => return Err(e.to_string()),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if folders::ignored(&name) {
            continue;
        }
        if path.is_dir() && path.join("game.json").is_file() {
            out.push(Package::Folder { files: folders::list(&path)?, name });
        } else if let Some(stem) = name.strip_suffix(".zip") {
            out.push(Package::Zip { name: stem.to_owned() });
        }
    }
    out.sort_by(|a, b| key(a).cmp(key(b)));
    Ok(out)
}

fn key(p: &Package) -> &str {
    match p {
        Package::Folder { name, .. } | Package::Zip { name } => name,
    }
}

/// A file of a folder package, or (with no path) a zip package's bytes.
pub fn read(dir: &Path, name: &str, path: Option<&str>) -> Result<Vec<u8>, String> {
    if !folders::ignored(name) && name.chars().all(|c| c != '/' && c != '\\') && name != ".." {
        match path {
            Some(path) => folders::read(&dir.join(name), path),
            None => fs::read(dir.join(format!("{name}.zip"))).map_err(|e| e.to_string()),
        }
    } else {
        Err(format!("'{name}' is not a package name"))
    }
}

/// Installs a zipped package as `<name>.zip`, replacing an earlier one.
pub fn install_zip(dir: &Path, name: &str, data: &[u8]) -> Result<PathBuf, String> {
    if !valid_name(name) {
        return Err(format!("'{name}' is not a package name"));
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{name}.zip"));
    let temp = dir.join(format!(".{name}.zip.tmp"));
    fs::write(&temp, data).map_err(|e| e.to_string())?;
    fs::rename(&temp, &path).map_err(|e| e.to_string())?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ccg-packages-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn finds_folder_and_zip_packages() {
        let dir = temp_dir("scan");
        folders::write(&dir.join("duel"), "game.json", b"{}").unwrap();
        folders::write(&dir.join("duel"), "content/cards/strike.json", b"{}").unwrap();
        fs::create_dir_all(dir.join("not-a-package")).unwrap();
        install_zip(&dir, "sporeline", b"PK").unwrap();
        fs::write(dir.join("notes.txt"), "x").unwrap();
        assert_eq!(
            scan(&dir).unwrap(),
            vec![
                Package::Folder { name: "duel".into(), files: vec!["content/cards/strike.json".into(), "game.json".into()] },
                Package::Zip { name: "sporeline".into() },
            ]
        );
        assert_eq!(read(&dir, "sporeline", None).unwrap(), b"PK");
        assert_eq!(read(&dir, "duel", Some("game.json")).unwrap(), b"{}");
        assert!(scan(&dir.join("missing")).unwrap().is_empty());
    }

    #[test]
    fn refuses_names_and_paths_outside_the_folder() {
        let dir = temp_dir("names");
        assert!(install_zip(&dir, "../escape", b"x").is_err());
        assert!(install_zip(&dir, "Upper", b"x").is_err());
        assert!(read(&dir, "..", None).is_err());
        assert!(read(&dir, "duel", Some("../../etc/passwd")).is_err());
        install_zip(&dir, "ok-name_2", b"one").unwrap();
        install_zip(&dir, "ok-name_2", b"two").unwrap();
        assert_eq!(read(&dir, "ok-name_2", None).unwrap(), b"two");
    }
}
