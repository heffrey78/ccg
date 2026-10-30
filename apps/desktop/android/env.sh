# The Android build's tools (#161): Unity's Android SDK, NDK and JDK (read only), and Rust with the
# Android targets from its own rustup folder, both as Writer's Android build uses them. Nothing here
# changes the system's Rust or PATH outside the shell that sources it.
#
# With CCG_ANDROID_ENV=given (CI) the environment already has ANDROID_HOME, NDK_HOME, JAVA_HOME and a
# Rust with the Android targets, and nothing is changed.
if [[ "${CCG_ANDROID_ENV:-}" != given ]]; then
  UNITY_ANDROID="${UNITY_ANDROID:-$HOME/Unity/Hub/Editor/6000.6.2f1/Editor/Data/PlaybackEngines/AndroidPlayer}"
  export ANDROID_HOME="$UNITY_ANDROID/SDK"
  export ANDROID_SDK_ROOT="$ANDROID_HOME"
  export NDK_HOME="$UNITY_ANDROID/NDK"
  export JAVA_HOME="$UNITY_ANDROID/OpenJDK"
  export RUSTUP_HOME="${CCG_RUST_HOME:-$HOME/.local/share/writer-rust}/rustup"
  export CARGO_HOME="${CCG_RUST_HOME:-$HOME/.local/share/writer-rust}/cargo"
  export PATH="$CARGO_HOME/bin:$JAVA_HOME/bin:$PATH"
fi
