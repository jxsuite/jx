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

export function openFileDialog(timeoutMs?: number): Promise<string | null> {
  return chooseViaPortal(
    { directory: false, filters: true, title: "Open project.json" },
    timeoutMs,
  );
}

/** Pick a folder — used by New Project to choose where to scaffold the project. */
export function openDirectoryDialog(): Promise<string | null> {
  return chooseViaPortal({ directory: true, title: "Choose a folder for your new project" });
}
