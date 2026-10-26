//! The desktop app (#31): the web build in a Tauri window, plus the commands
//! behind the web app's desktop adapters (`apps/web/src/platform/desktop.ts`).

mod storage;

use storage::Storage;
use tauri::{Manager, State};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            app.manage(Storage::open(dir.join("storage.json")));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![kv_get, kv_set, kv_delete, kv_keys])
        .run(tauri::generate_context!())
        .expect("error while running the desktop app");
}
