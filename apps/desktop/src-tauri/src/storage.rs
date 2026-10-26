//! Key-value storage for saves and settings (#141): the desktop side of the
//! client's `KeyValueStorage`, kept as one JSON file in the app-data folder.
//! Writes go to a temporary file first, then replace the old one, so a crash
//! mid-write never leaves a half-written file.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct Storage {
    path: PathBuf,
    data: Mutex<BTreeMap<String, String>>,
}

impl Storage {
    /// Opens the store at `path`, starting empty if the file is missing or unreadable.
    pub fn open(path: PathBuf) -> Storage {
        let data = fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        Storage { path, data: Mutex::new(data) }
    }

    pub fn get(&self, key: &str) -> Option<String> {
        self.data.lock().unwrap().get(key).cloned()
    }

    pub fn set(&self, key: &str, value: &str) -> io::Result<()> {
        let mut data = self.data.lock().unwrap();
        data.insert(key.to_owned(), value.to_owned());
        write_atomically(&self.path, &serde_json::to_string(&*data)?)
    }

    pub fn delete(&self, key: &str) -> io::Result<()> {
        let mut data = self.data.lock().unwrap();
        if data.remove(key).is_some() {
            write_atomically(&self.path, &serde_json::to_string(&*data)?)?;
        }
        Ok(())
    }

    /// Keys starting with `prefix`, sorted.
    pub fn keys(&self, prefix: &str) -> Vec<String> {
        self.data.lock().unwrap().keys().filter(|k| k.starts_with(prefix)).cloned().collect()
    }
}

fn write_atomically(path: &Path, text: &str) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, text)?;
    fs::rename(&temp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ccg-storage-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join("storage.json")
    }

    #[test]
    fn keeps_values_across_reopening() {
        let path = temp_path("reopen");
        let store = Storage::open(path.clone());
        store.set("settings:speed", "2").unwrap();
        store.set("save:run", "{\"x\":1}").unwrap();
        let again = Storage::open(path);
        assert_eq!(again.get("settings:speed").as_deref(), Some("2"));
        assert_eq!(again.get("save:run").as_deref(), Some("{\"x\":1}"));
        assert_eq!(again.get("missing"), None);
    }

    #[test]
    fn lists_keys_by_prefix_and_deletes() {
        let store = Storage::open(temp_path("keys"));
        for key in ["settings:b", "settings:a", "save:x"] {
            store.set(key, "1").unwrap();
        }
        assert_eq!(store.keys("settings:"), vec!["settings:a", "settings:b"]);
        store.delete("settings:a").unwrap();
        store.delete("never-there").unwrap();
        assert_eq!(store.keys(""), vec!["save:x", "settings:b"]);
    }

    #[test]
    fn starts_empty_from_a_corrupt_file() {
        let path = temp_path("corrupt");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "not json").unwrap();
        assert!(Storage::open(path).keys("").is_empty());
    }
}
