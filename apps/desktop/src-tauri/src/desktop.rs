//! The commands only a desktop has: folders the player opens, watching them, and
//! the packages folder they can reach from a file manager.

use crate::{folders, packages};
use folders::Folders;
use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

pub fn manage(app: &tauri::App) {
    app.manage(Folders::default());
    app.manage(Watchers::default());
}

/// Watchers for open folders, by folder id; dropping one stops it.
#[derive(Default)]
pub struct Watchers(Mutex<HashMap<u32, notify::RecommendedWatcher>>);

#[derive(Serialize)]
pub struct OpenedFolder {
    id: u32,
    name: String,
}

/// Asks the user for a folder and opens it. The app can reach it from then on, and only it.
#[tauri::command]
pub async fn folder_open(app: AppHandle, folders: State<'_, Folders>, watchers: State<'_, Watchers>) -> Result<Option<OpenedFolder>, String> {
    let Some(picked) = app.dialog().file().set_title("Open a game project folder").blocking_pick_folder() else {
        return Ok(None);
    };
    let root = picked.into_path().map_err(|e| e.to_string())?;
    let name = root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| root.display().to_string());
    let id = folders.add(root.clone());
    // Changes made outside the app (git, a text editor) are reported; the editor rereads and decides.
    let handle = app.clone();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        let relevant = event.paths.iter().any(|p| !p.components().any(|c| folders::ignored(&c.as_os_str().to_string_lossy())));
        if relevant && !event.kind.is_access() {
            let _ = handle.emit("folder-changed", id);
        }
    })
    .map_err(|e| e.to_string())?;
    watcher.watch(&root, RecursiveMode::Recursive).map_err(|e| e.to_string())?;
    watchers.0.lock().unwrap().insert(id, watcher);
    Ok(Some(OpenedFolder { id, name }))
}

#[tauri::command]
pub fn folder_close(id: u32, folders: State<Folders>, watchers: State<Watchers>) {
    watchers.0.lock().unwrap().remove(&id);
    folders.remove(id);
}

#[tauri::command]
pub fn folder_list(id: u32, folders: State<Folders>) -> Result<Vec<String>, String> {
    folders::list(&folders.root(id)?)
}

/// A file's bytes, sent as raw binary rather than a JSON array.
#[tauri::command]
pub fn folder_read(id: u32, path: String, folders: State<Folders>) -> Result<Response, String> {
    Ok(Response::new(folders::read(&folders.root(id)?, &path)?))
}

#[tauri::command]
pub fn folder_write(id: u32, path: String, data: Vec<u8>, folders: State<Folders>) -> Result<(), String> {
    folders::write(&folders.root(id)?, &path, &data)
}

#[tauri::command]
pub fn folder_remove(id: u32, path: String, folders: State<Folders>) -> Result<(), String> {
    folders::remove(&folders.root(id)?, &path)
}

/// `<app data>/packages`, where installed game packages live (#143).
fn packages_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("packages"))
}

#[tauri::command]
pub fn packages_list(app: AppHandle) -> Result<Vec<packages::Package>, String> {
    packages::scan(&packages_dir(&app)?)
}

/// A folder package's file, or a zip package's bytes when no path is given.
#[tauri::command]
pub fn packages_read(app: AppHandle, name: String, path: Option<String>) -> Result<Response, String> {
    Ok(Response::new(packages::read(&packages_dir(&app)?, &name, path.as_deref())?))
}

#[tauri::command]
pub fn packages_install(app: AppHandle, name: String, data: Vec<u8>) -> Result<(), String> {
    packages::install_zip(&packages_dir(&app)?, &name, &data).map(|_| ())
}

/// Shows the packages folder in the system's file manager, creating it first.
#[tauri::command]
pub fn packages_reveal(app: AppHandle) -> Result<(), String> {
    let dir = packages_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}
