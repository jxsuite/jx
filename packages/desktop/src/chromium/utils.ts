import { sessionBus } from "dbus-ts";

// Minimal D-Bus portal interface types (external/opaque)
interface DbusFileChooserPortal {
  OpenFile: (
    parent: string,
    title: string,
    options: [string, [string, unknown]][],
  ) => Promise<[string, ...unknown[]]>;
}

/**
 * The interfaces this module asks the session bus for, keyed by D-Bus interface name. dbus-ts types
 * `getInterface()` from this map, so the portal proxy needs no assertion. The Request interface is
 * deliberately absent: dbus-ts does not type signals, so its proxy stays a plain `DBusInterface`
 * and the Response handler declares its own parameters.
 */
interface PortalInterfaces {
  "org.freedesktop.portal.FileChooser": DbusFileChooserPortal;
}

/**
 * One `a{sv}` entry of a portal Response as dbus-ts unmarshals it: `[key, [signature, value]]`.
 * Both inner slots are optional because the bus delivers whatever the portal wrote, and a short
 * entry reads as "no uris" rather than throwing inside the signal handler.
 */
type PortalResultEntry = [string, [string, string[]?]?];

/** A FileChooser Response's `results`: the raw `a{sv}` entry list, or a decoded `{ uris }` map. */
type PortalResponseResults = PortalResultEntry[] | { uris?: string[] };

/**
 * Open the freedesktop FileChooser portal and resolve to the first selected path (or null on
 * cancel/error). `directory: true` selects a folder (used by New Project to pick a parent dir);
 * `directory: false` selects a project.json file (used by Open Project). Resolves null if the
 * portal never fires a Response within `timeoutMs`.
 *
 * @param {{ directory: boolean; title: string; filters?: boolean }} opts
 * @param {number} [timeoutMs]
 * @returns {Promise<string | null>}
 */
async function chooseViaPortal(
  opts: {
    directory: boolean;
    title: string;
    filters?: boolean;
  },
  timeoutMs = 60_000,
): Promise<string | null> {
  const bus = await sessionBus<PortalInterfaces>();

  try {
    const portal = await bus.getInterface(
      "org.freedesktop.portal.Desktop",
      "/org/freedesktop/portal/desktop",
      "org.freedesktop.portal.FileChooser",
    );

    const handleToken = `bun_${Math.random().toString(36).slice(2, 11)}`;

    const options: [string, [string, unknown]][] = [
      ["directory", ["b", opts.directory]],
      ["modal", ["b", true]],
      ["handle_token", ["s", handleToken]],
    ];
    if (opts.filters) {
      options.push(["filters", ["a(sa(us))", [["Project files", [[0, "*.json"]]]]]]);
    }

    const [handle] = await portal.OpenFile("", opts.title, options);

    const result = await new Promise<string | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), timeoutMs);

      void bus
        .getInterface("org.freedesktop.portal.Desktop", handle, "org.freedesktop.portal.Request")
        .then((request) => {
          void request.on("Response", (response: number, results: PortalResponseResults) => {
            clearTimeout(timeout);
            if (response !== 0) {
              resolve(null);
              return;
            }
            // D-Bus portal response: nested array format [key, [type, value[]]] or {uris: string[]}
            const uris = Array.isArray(results)
              ? (results.at(0)?.[1]?.[1] ?? [])
              : (results.uris ?? []);
            if (uris.length === 0) {
              resolve(null);
              return;
            }
            try {
              const filePath = new URL(uris[0]).pathname;
              resolve(filePath);
            } catch {
              resolve(null);
            }
          });
        });
    });

    return result;
  } finally {
    bus.connection.end();
  }
}

/** Run an AppleScript, resolving its exit code and standard output. */
export type RunAppleScript = (script: string) => Promise<{ exitCode: number; stdout: string }>;

/**
 * `osascript -e <script>`.
 *
 * @param bin The interpreter; tests substitute a program every host has.
 */
export async function runOsascript(
  script: string,
  bin = "osascript",
): Promise<{ exitCode: number; stdout: string }> {
  const child = Bun.spawn([bin, "-e", script], { stderr: "ignore", stdout: "pipe" });
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return { exitCode, stdout };
}

/**
 * The macOS open panel, through AppleScript's `choose file` / `choose folder`: the freedesktop
 * portal does not exist there, and the launcher is a Bun process with no AppKit of its own.
 * Resolves the chosen POSIX path, or null on cancel (osascript exits non-zero with error -128).
 *
 * @param opts `directory` selects a folder rather than a JSON file; `title` is the panel's prompt.
 * @param run The AppleScript runner, injectable for tests.
 */
export async function chooseViaAppleScript(
  opts: { directory: boolean; title: string },
  run: RunAppleScript = runOsascript,
): Promise<string | null> {
  // The prompt is a literal of this module's, but quoting it properly costs nothing.
  const prompt = JSON.stringify(opts.title);
  const choose = opts.directory
    ? `choose folder with prompt ${prompt}`
    : `choose file with prompt ${prompt} of type {"public.json"}`;
  const { exitCode, stdout } = await run(`POSIX path of (${choose})`);
  const path = stdout.trim();
  if (exitCode !== 0 || path === "") {
    return null;
  }
  // A folder's POSIX path ends in "/", which no other picker in the launcher returns.
  return path.length > 1 ? path.replace(/\/$/, "") : path;
}

/**
 * Pick a project.json: the desktop portal on Linux, the system open panel on macOS.
 *
 * @param timeoutMs How long the portal may stay open (Linux only).
 * @param platform The OS; `process.platform` by default.
 * @param run The AppleScript runner (macOS only), injectable for tests.
 */
export function openFileDialog(
  timeoutMs?: number,
  platform: NodeJS.Platform = process.platform,
  run: RunAppleScript = runOsascript,
): Promise<string | null> {
  const title = "Open project.json";
  if (platform === "darwin") {
    return chooseViaAppleScript({ directory: false, title }, run);
  }
  return chooseViaPortal({ directory: false, filters: true, title }, timeoutMs);
}

/**
 * Pick a folder — used by New Project to choose where to scaffold the project.
 *
 * @param platform The OS; `process.platform` by default.
 * @param run The AppleScript runner (macOS only), injectable for tests.
 */
export function openDirectoryDialog(
  platform: NodeJS.Platform = process.platform,
  run: RunAppleScript = runOsascript,
): Promise<string | null> {
  const title = "Choose a folder for your new project";
  if (platform === "darwin") {
    return chooseViaAppleScript({ directory: true, title }, run);
  }
  return chooseViaPortal({ directory: true, title });
}
