/**
 * The Android adapters (#156): what only the Android app has. Only `platform/index.ts`
 * uses this module.
 */

/** Takes Android's back from the webview. Returns how to stop listening. */
export function onAndroidBack(handler: () => void): () => void {
  let stopped = false;
  let stop: (() => void) | undefined;
  void import('@tauri-apps/api/app')
    .then(({ onBackButtonPress }) => onBackButtonPress(handler))
    .then((listener) => {
      if (stopped) void listener.unregister();
      else stop = () => void listener.unregister();
    });
  return () => {
    stopped = true;
    stop?.();
  };
}

/** Leaves the app, as back does from its first page. */
export function exitAndroid(): void {
  void import('@tauri-apps/api/app').then(({ exit }) => exit(0));
}
