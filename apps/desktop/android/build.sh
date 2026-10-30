#!/usr/bin/env bash
# Builds the Android app (#161): a debug-signed APK for `target` (aarch64, a phone; x86_64, the
# emulator), with the tools env.sh names. Unity's SDK carries no accepted licences, so Gradle can't
# fetch anything missing: the generated project is pointed at platform 36, which the SDK has, and
# targets 34. The Gradle project (src-tauri/gen/android) is generated, and not committed.
set -euo pipefail
target="${1:-aarch64}"
cd "$(dirname "${BASH_SOURCE[0]}")"
source env.sh
tauri=(node "$(realpath ../node_modules/@tauri-apps/cli/tauri.js)")
cd ../src-tauri
if [[ ! -d gen/android ]]; then
  "${tauri[@]}" android init --ci
  # The app's own icon, in place of the template's.
  icons="$(mktemp -d)"
  "${tauri[@]}" icon app-icon.png --output "$icons" > /dev/null
  cp -r "$icons"/android/* gen/android/app/src/main/res/
  rm -rf "$icons"
fi
sed -i -E 's/compileSdk = [0-9]+/compileSdk = 36/; s/targetSdk = [0-9]+/targetSdk = 34/' gen/android/app/build.gradle.kts
# Gradle runs `node tauri …` from src-tauri, where there's no "tauri": give it the CLI's script.
find gen/android/buildSrc -name BuildTask.kt -exec sed -i "s|listOf(\"tauri\", \"android\", \"android-studio-script\")|listOf(\"${tauri[1]}\", \"android\", \"android-studio-script\")|" {} +
# The debug key CCG_ANDROID_DEBUG_KEYSTORE names, where it's set (CI), so an APK installs over the last.
grep -q 'CCG_ANDROID_DEBUG_KEYSTORE' gen/android/app/build.gradle.kts || cat >> gen/android/app/build.gradle.kts <<'GRADLE'

android { signingConfigs { getByName("debug") { System.getenv("CCG_ANDROID_DEBUG_KEYSTORE")?.let { storeFile = file(it) } } } }
GRADLE
# `android build --debug` uses Cargo's dev profile: optimized and stripped here, so the APK is a
# download a phone can take, without slowing the desktop's dev builds.
export CARGO_PROFILE_DEV_OPT_LEVEL=s CARGO_PROFILE_DEV_DEBUG=false CARGO_PROFILE_DEV_STRIP=true
# An APK of the last build would be taken for this one's.
rm -rf gen/android/app/build/outputs/apk
"${tauri[@]}" android build --debug --apk --target "$target"
find gen/android/app/build/outputs/apk -name '*.apk'
