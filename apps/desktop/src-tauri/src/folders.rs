//! Project folders on disk (#142): the editor's `ProjectStore` for a folder the
//! user picked. Commands only reach folders opened through the picker, by id,
//! and only paths inside them; a watcher reports changes made outside the app.

use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

/// Folders the user has opened, by id.
#[derive(Default)]
pub struct Folders {
    roots: Mutex<HashMap<u32, PathBuf>>,
    next: Mutex<u32>,
}

impl Folders {
    pub fn add(&self, root: PathBuf) -> u32 {
        let mut next = self.next.lock().unwrap();
        *next += 1;
        self.roots.lock().unwrap().insert(*next, root);
        *next
    }

    pub fn root(&self, id: u32) -> Result<PathBuf, String> {
        self.roots.lock().unwrap().get(&id).cloned().ok_or_else(|| format!("no open folder {id}"))
    }

    pub fn remove(&self, id: u32) {
        self.roots.lock().unwrap().remove(&id);
    }
}

/// Directories a project never holds: version control, dependencies, build output.
pub fn ignored(name: &str) -> bool {
    name.starts_with('.') || matches!(name, "node_modules" | "target" | "dist")
}

/// A '/'-separated path inside `root`; anything that could leave it is refused.
pub fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = Path::new(rel);
    if rel.as_os_str().is_empty() || !rel.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(format!("'{}' is not a path inside the project", rel.display()));
    }
    Ok(root.join(rel))
}

/// Every file under `root`, '/'-separated and sorted, skipping ignored directories.
pub fn list(root: &Path) -> Result<Vec<String>, String> {
    fn walk(dir: &Path, prefix: &str, out: &mut Vec<String>) -> std::io::Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if ignored(&name) {
                continue;
            }
            let path = format!("{prefix}{name}");
            if entry.file_type()?.is_dir() {
                walk(&entry.path(), &format!("{path}/"), out)?;
            } else {
                out.push(path);
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    walk(root, "", &mut out).map_err(|e| e.to_string())?;
    out.sort();
    Ok(out)
}

pub fn read(root: &Path, rel: &str) -> Result<Vec<u8>, String> {
    fs::read(resolve(root, rel)?).map_err(|e| e.to_string())
}

pub fn write(root: &Path, rel: &str, data: &[u8]) -> Result<(), String> {
    let path = resolve(root, rel)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(path, data).map_err(|e| e.to_string())
}

pub fn remove(root: &Path, rel: &str) -> Result<(), String> {
    match fs::remove_file(resolve(root, rel)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ccg-folders-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn writes_reads_lists_and_removes_inside_the_folder() {
        let root = temp_root("roundtrip");
        write(&root, "content/cards/strike.json", b"{}").unwrap();
        write(&root, "game.json", b"{\"id\":\"x\"}").unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join(".git/HEAD"), "ref").unwrap();
        fs::create_dir_all(root.join("node_modules/x")).unwrap();
        fs::write(root.join("node_modules/x/a.js"), "").unwrap();
        assert_eq!(list(&root).unwrap(), vec!["content/cards/strike.json", "game.json"]);
        assert_eq!(read(&root, "game.json").unwrap(), b"{\"id\":\"x\"}");
        remove(&root, "content/cards/strike.json").unwrap();
        remove(&root, "content/cards/strike.json").unwrap();
        assert_eq!(list(&root).unwrap(), vec!["game.json"]);
    }

    #[test]
    fn refuses_paths_that_leave_the_folder() {
        let root = temp_root("escape");
        for bad in ["../outside.json", "content/../../x", "/etc/passwd", "", "./game.json"] {
            assert!(resolve(&root, bad).is_err(), "{bad} should be refused");
        }
        assert!(write(&root, "../escaped.json", b"x").is_err());
        assert!(resolve(&root, "content/units/hero.json").is_ok());
    }

    #[test]
    fn folder_ids_are_only_what_was_opened() {
        let folders = Folders::default();
        let id = folders.add(PathBuf::from("/tmp/a"));
        assert_eq!(folders.root(id).unwrap(), PathBuf::from("/tmp/a"));
        assert!(folders.root(id + 1).is_err());
        folders.remove(id);
        assert!(folders.root(id).is_err());
    }
}
