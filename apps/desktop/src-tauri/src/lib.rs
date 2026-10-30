//! The desktop app (#31): the web build in a Tauri window, plus the commands
//! behind the web app's desktop adapters (`apps/web/src/platform/desktop.ts`).
//! Android (#156, decision #157) is this same crate without what needs a desktop:
//! folders, watching them, and showing the packages folder (`desktop.rs`).

#[cfg(desktop)]
mod desktop;
#[cfg(desktop)]
mod folders;
#[cfg(desktop)]
mod packages;
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

/// How the smoke test (#160) reports: with CCG_SMOKE set, the app quits once the page has shown a game, or fails.
const SMOKE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
const SMOKE_PAGE_CHECK: &str = r#"
const smokeCheck = () => {
  if (document.body && document.body.innerText.includes('Duel')) window.__TAURI_INTERNALS__.invoke('smoke_passed');
  else setTimeout(smokeCheck, 200);
};
smokeCheck();
"#;

#[tauri::command]
fn smoke_passed() {
    println!("smoke test passed: the page shows a game");
    std::process::exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let smoke = std::env::var_os("CCG_SMOKE").is_some();
    if smoke {
        std::thread::spawn(|| {
            std::thread::sleep(SMOKE_TIMEOUT);
            eprintln!("smoke test failed: no game on the page after {SMOKE_TIMEOUT:?}");
            std::process::exit(1);
        });
    }
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_opener::init());
    builder
        .on_page_load(move |webview, payload| {
            if smoke && payload.event() == tauri::webview::PageLoadEvent::Finished {
                let _ = webview.eval(SMOKE_PAGE_CHECK);
            }
        })
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            app.manage(Storage::open(dir.join("storage.json")));
            #[cfg(desktop)]
            desktop::manage(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            kv_get,
            kv_set,
            kv_delete,
            kv_keys,
            #[cfg(desktop)]
            desktop::folder_open,
            #[cfg(desktop)]
            desktop::folder_close,
            #[cfg(desktop)]
            desktop::folder_list,
            #[cfg(desktop)]
            desktop::folder_read,
            #[cfg(desktop)]
            desktop::folder_write,
            #[cfg(desktop)]
            desktop::folder_remove,
            #[cfg(desktop)]
            desktop::packages_list,
            #[cfg(desktop)]
            desktop::packages_read,
            #[cfg(desktop)]
            desktop::packages_install,
            #[cfg(desktop)]
            desktop::packages_reveal,
            smoke_passed
        ])
        .run(tauri::generate_context!())
        .expect("error while running the desktop app");
}
