# Desktop and Android apps

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

## Android

The Android app (#156, decision #157) is this same crate, with what needs a desktop
behind `cfg(desktop)` (`src-tauri/src/desktop.rs`). It offers play only, without the
editor, and keeps saves and settings in the app's own storage.

```sh
pnpm --filter @ccg/desktop build:android           # a debug-signed APK for a phone
pnpm --filter @ccg/desktop build:android:emulator  # the same for an x86_64 emulator
pnpm --filter @ccg/desktop android:install         # install the last APK over adb, and open it
```

The tools aren't on PATH: `android/env.sh` points at the Android SDK, NDK 27 and JDK 17
that come with Unity, and at Rust with the Android targets in its own rustup folder.
Set `UNITY_ANDROID` or `CCG_RUST_HOME` if yours are elsewhere. Unity's SDK has no accepted
licences, so Gradle can't download anything missing, and `android/build.sh` points the
generated project at compile SDK 36 and target SDK 34. That's fine for sideloading; the
Play Store would need a higher target and a release key.

The Gradle project (`src-tauri/gen/android`) is generated and not committed. Delete it to
regenerate it.

`.github/workflows/android.yml` builds the phone's APK on every push and pull request that
changes the app. Every push to main puts it on the
[Android (latest)](https://github.com/heffrey78/ccg/releases/tag/android-latest) pre-release, at
`https://github.com/heffrey78/ccg/releases/download/android-latest/ccg-android.apk`. Each APK
installs over the last only if they share a signing key, kept in the `ANDROID_DEBUG_KEYSTORE`
secret (base64).

`pnpm --filter @ccg/web e2e:android` runs the app end to end on a device or an emulator, with the
network off. It needs an APK built for that device's architecture. Tested on the emulator; check
sound and touch on a real phone too, as the emulator runs without audio.
