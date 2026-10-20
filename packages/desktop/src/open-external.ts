import { spawn } from "node:child_process";

/**
 * Open a URL in the user's default browser.
 *
 * Studio's Preview mode routes link clicks through here (see `setPreviewNavigateHandler`), and so
 * do `View: Open in Browser` and the GitHub sign-in redirect: each of the three exists to leave the
 * editor's window, and a frameless app window with no address bar, history or devtools is not the
 * browser any of them means.
 *
 * The backend is a Bun process, so it hands the URL to the desktop's own opener rather than to
 * Electron.
 *
 * **Web schemes only.** The opener resolves a scheme to whatever handler the desktop has registered
 * for it, so an unrestricted one turns "a link in a previewed page" into "run the program the OS
 * associates with this scheme" — and the page being previewed is a project's own content. `http`,
 * `https` and `mailto` are what the three callers actually produce.
 *
 * Spawned with an argument vector and no shell, so the URL is never parsed as a command line.
 *
 * Returns false when the URL could not be handed over, so the caller can fall back to
 * `window.open`.
 *
 * @param url The URL to open.
 * @param platform The OS; `process.platform` by default.
 */
export function openExternal(url: string, platform: NodeJS.Platform = process.platform): boolean {
  let scheme: string;
  try {
    ({ protocol: scheme } = new URL(url));
  } catch {
    return false;
  }
  if (scheme !== "http:" && scheme !== "https:" && scheme !== "mailto:") {
    return false;
  }
  const [command, args] =
    platform === "darwin"
      ? (["open", [url]] as const)
      : platform === "win32"
        ? // No shell: `start` is a cmd builtin and would need one, which is where URL text becomes
          // A command line. This entry point takes the URL as a single argument.
          (["rundll32", ["url.dll,FileProtocolHandler", url]] as const)
        : (["xdg-open", [url]] as const);
  try {
    const child = spawn(command, [...args], { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
