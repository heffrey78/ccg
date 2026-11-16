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
libappindicator; see Tauri's prerequisites). Sound on Linux also needs GStreamer's
good plugins, which WebKitGTK plays audio through (`gst-plugins-good` on Arch,
`gstreamer1.0-plugins-good` on Debian and Ubuntu). The bundles take care of this: the
deb and rpm depend on them, and the AppImage carries them.

```sh
pnpm --filter @ccg/desktop dev            # the app on the Vite dev server, with hot reload
pnpm --filter @ccg/desktop build:desktop  # installers under src-tauri/target/release/bundle
pnpm --filter @ccg/desktop test:rust      # the Rust tests
```

## Builds and releases

`.github/workflows/desktop.yml` builds Linux, Windows and, as best effort, Apple-silicon
Mac, and starts each built app with `CCG_SMOKE=1`: it quits with success once the page
shows a game, and fails after a minute if it never does.

- **Every pull request and push:** the bundles are kept as the run's artifacts.
- **Every push to main:** they replace the assets of the
  [Desktop (test builds)](https://github.com/heffrey78/ccg/releases/tag/desktop-test-builds)
  pre-release, under names that stay the same.
- **A tag `v1.2.3`:** must match `version` in `tauri.conf.json`, and drafts a GitHub
  Release with the bundles. Publishing the draft is the owner's decision.

The builds are unsigned, so Windows SmartScreen warns about an unknown publisher (More
info, then Run anyway), and macOS needs Open Anyway in Privacy & Security.
