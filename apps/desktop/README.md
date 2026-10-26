# Desktop app

The play client and the editor in a [Tauri 2](https://tauri.app) window (#31). It runs
the `apps/web` build unchanged; only the platform adapters differ, and they all live
in `apps/web/src/platform/`. `index.ts` picks the browser or the desktop adapters,
and `desktop.ts` calls the Rust commands in `src-tauri/src/lib.rs`.

| | Browser | Desktop |
| --- | --- | --- |
| Saves and settings | IndexedDB | `storage.json` in the app-data folder |
| Full screen | Fullscreen API | the native window |
| Editor: Open folder | Chromium's folder picker (File System Access) | the native folder picker; the app can reach only folders opened this way, and a watcher reloads files changed outside the app (git, a text editor) |
| Installed games | Load a game from a zip (kept for the session) | the `packages` folder in app data: game folders and exported zips there appear in Play (Play → Open packages folder); the editor's Export → Install in Play puts the project there |

## Run it

You need Rust, and on Linux the webview libraries (WebKitGTK 4.1, librsvg, and
libappindicator; see Tauri's prerequisites).

```sh
pnpm --filter @ccg/desktop dev            # the app on the Vite dev server, with hot reload
pnpm --filter @ccg/desktop build:desktop  # installers under src-tauri/target/release/bundle
pnpm --filter @ccg/desktop test:rust      # the Rust tests
```

CI builds Linux and Windows bundles in `.github/workflows/desktop.yml`. Download
them from the run's artifacts.
