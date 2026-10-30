#!/usr/bin/env bash
# Installs the APK build.sh made last on the attached device, keeping the app's data, and opens it.
# ANDROID_SERIAL picks a device if there's more than one. ADB names adb, if it isn't on PATH.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
adb="${ADB:-adb}"
apk="$(find ../src-tauri/gen/android/app/build/outputs/apk -name '*.apk' 2>/dev/null | head -n 1)"
if [[ -z "$apk" ]]; then
  echo "No APK yet: run pnpm --filter @ccg/desktop build:android first." >&2
  exit 1
fi
"$adb" install -r "$apk"
"$adb" shell monkey -p dev.ccg.engine -c android.intent.category.LAUNCHER 1 >/dev/null
