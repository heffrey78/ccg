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

/** Tells when the app goes to the background and returns, as its activity says. Returns how to stop listening. */
export function onAndroidBackground(handler: (background: boolean) => void, target: EventTarget = window): () => void {
  const background = () => handler(true);
  const foreground = () => handler(false);
  target.addEventListener('ccg-background', background);
  target.addEventListener('ccg-foreground', foreground);
  return () => {
    target.removeEventListener('ccg-background', background);
    target.removeEventListener('ccg-foreground', foreground);
  };
}

/**
 * Keeps the page clear of a camera cutout and any system bars showing (#172). The app draws edge to
 * edge and the webview doesn't report them reliably, so the shell gives them, in CSS pixels, as
 * `window.ccgShell.safeArea()`, and fires `ccg-insets` when they change, as on rotating.
 */
export function followAndroidInsets(): void {
  if (typeof window === 'undefined') return;
  const apply = () => {
    const shell = (window as unknown as { ccgShell?: { safeArea(): string } }).ccgShell;
    if (!shell) return;
    const area = JSON.parse(shell.safeArea()) as Record<string, number>;
    for (const [edge, px] of Object.entries(area)) document.documentElement.style.setProperty(`--ccg-safe-${edge}`, `${px}px`);
  };
  apply();
  window.addEventListener('ccg-insets', apply);
}
