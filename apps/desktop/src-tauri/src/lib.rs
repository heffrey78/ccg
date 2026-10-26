//! The desktop app (#31): the web build in a Tauri window, plus the commands
//! behind the web app's desktop adapters (`apps/web/src/platform/desktop.ts`).

mod folders;
mod storage;

use folders::Folders;
use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use storage::Storage;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
fn kv_get(store: State<Storage>, key: String) -> Option<String> {
    store.get(&key)
}

#[tauri::command]
fn kv_set(store: State<Storage>, key: String, value: String) -> Result<(), String> {
    store.set(&key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
fn kv_delete(store: State<Storage>, key: String) -> Result<(), String> {
    store.delete(&key).map_err(|e| e.to_string())
}

#[tauri::command]
fn kv_keys(store: State<Storage>, prefix: Option<String>) -> Vec<String> {
    store.keys(prefix.as_deref().unwrap_or(""))
}

/// Watchers for open folders, by folder id; dropping one stops it.
#[derive(Default)]
struct Watchers(Mutex<HashMap<u32, notify::RecommendedWatcher>>);

#[derive(Serialize)]
struct OpenedFolder {
    id: u32,
    name: String,
}

/// Asks the user for a folder and opens it. The app can reach it from then on, and only it.
#[tauri::command]
async fn folder_open(app: AppHandle, folders: State<'_, Folders>, watchers: State<'_, Watchers>) -> Result<Option<OpenedFolder>, String> {
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
fn folder_close(id: u32, folders: State<Folders>, watchers: State<Watchers>) {
    watchers.0.lock().unwrap().remove(&id);
    folders.remove(id);
}

#[tauri::command]
fn folder_list(id: u32, folders: State<Folders>) -> Result<Vec<String>, String> {
    folders::list(&folders.root(id)?)
}

/// A file's bytes, sent as raw binary rather than a JSON array.
#[tauri::command]
fn folder_read(id: u32, path: String, folders: State<Folders>) -> Result<Response, String> {
    Ok(Response::new(folders::read(&folders.root(id)?, &path)?))
}

#[tauri::command]
fn folder_write(id: u32, path: String, data: Vec<u8>, folders: State<Folders>) -> Result<(), String> {
    folders::write(&folders.root(id)?, &path, &data)
}

#[tauri::command]
fn folder_remove(id: u32, path: String, folders: State<Folders>) -> Result<(), String> {
    folders::remove(&folders.root(id)?, &path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            app.manage(Storage::open(dir.join("storage.json")));
            app.manage(Folders::default());
            app.manage(Watchers::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            kv_get,
            kv_set,
            kv_delete,
            kv_keys,
            folder_open,
            folder_close,
            folder_list,
            folder_read,
            folder_write,
            folder_remove
        ])
        .run(tauri::generate_context!())
        .expect("error while running the desktop app");
}
