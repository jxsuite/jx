/**
 * Registering `.jxn` for an AppImage (specs/desktop.md §7.8).
 *
 * An AppImage is one file a user put somewhere, with no install step, so nothing tells the desktop
 * that Jx Studio opens `.jxn` unless something does it on purpose. This is that something, run only
 * when the user asks: it writes the type to the user's shared MIME database and a desktop entry
 * whose `Exec` is this AppImage, then asks the two database tools to notice, when they are on
 * `PATH`. Nothing here runs on its own, because an AppImage's promise is that nothing on the system
 * changes until you ask. Every other channel declares the type when it is installed.
 *
 * The entry records the AppImage it points at, so a launch from a different place can say the
 * registration is stale rather than rewrite it unasked.
 *
 * @docs studio/desktop
 */
import { execFile } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type * as Electron from "electron";
import * as executables from "@jxsuite/schema/which";
import { FILE_TYPE_CHANNELS } from "../shared/bridge";
import type { FileTypeReport, FileTypeState } from "@jxsuite/studio/types";

/** The MIME type `.jxn` is declared as on every channel. */
export const JXN_MIME_TYPE = "text/x-jxn";

/**
 * The shared MIME database's description of `.jxn`. `jx-studio.mime.xml` is the same type with a
 * header comment, and a test holds the two equal; this copy is what an AppImage writes, because the
 * main-process bundle carries no data files.
 */
export const JXN_MIME_XML = `<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="${JXN_MIME_TYPE}">
    <comment>Jx file</comment>
    <sub-class-of type="text/plain"/>
    <generic-icon name="text-x-generic"/>
    <glob pattern="*.jxn"/>
  </mime-type>
</mime-info>
`;

/** The desktop entry's file name, apart from any entry a package installed. */
export const DESKTOP_ENTRY_NAME = "jx-studio-appimage.desktop";

/** The key the entry records its AppImage under. */
const APPIMAGE_KEY = "X-JxStudio-AppImage";

/** What registering reads and writes, injectable for tests. */
export interface FileTypeHost {
  /** The running AppImage's path (`APPIMAGE`), or null when this is not an AppImage. */
  appImage: string | null;
  /** `$XDG_DATA_HOME`, or `~/.local/share`. */
  dataHome: string;
  /** The packaged icon, copied beside the entry because the AppImage's own mount moves. */
  icon: string | null;
  copyFile: (from: string, to: string) => void;
  readText: (path: string) => string | null;
  /** Run a program to completion; rejects when it fails. */
  run: (program: string, args: readonly string[]) => Promise<void>;
  which: (program: string) => string | null;
  writeText: (path: string, text: string) => void;
}

/**
 * A desktop entry `Exec` argument, quoted as the Desktop Entry Specification asks: in double
 * quotes, with `"`, `` ` ``, `$` and `\` escaped.
 */
function execArgument(value: string): string {
  return `"${value.replaceAll(/["`$\\]/g, String.raw`\$&`)}"`;
}

/** Where the entry goes. */
function entryPath(host: Pick<FileTypeHost, "dataHome">): string {
  return join(host.dataHome, "applications", DESKTOP_ENTRY_NAME);
}

/** Where the icon goes. */
function iconPath(host: Pick<FileTypeHost, "dataHome">): string {
  return join(host.dataHome, "jx-studio", "icon.png");
}

/**
 * The desktop entry for an AppImage at `appImage`.
 *
 * @param appImage The AppImage's path.
 * @param icon The icon's path, or null for the theme's `jx-studio`.
 */
export function appImageDesktopEntry(appImage: string, icon: string | null): string {
  return [
    "[Desktop Entry]",
    "Name=Jx Studio",
    "Comment=Visual JSON component editor",
    `Exec=${execArgument(appImage)} %F`,
    `Icon=${icon ?? "jx-studio"}`,
    "Terminal=false",
    "Type=Application",
    "Categories=Development;WebDevelopment;",
    `MimeType=application/json;text/markdown;${JXN_MIME_TYPE};`,
    "StartupWMClass=jx-studio",
    `${APPIMAGE_KEY}=${appImage}`,
    "",
  ].join("\n");
}

/**
 * Whether `.jxn` is registered for the AppImage running now.
 *
 * @param host What to read.
 */
export function fileTypeState(host: FileTypeHost): FileTypeState {
  const entry = host.readText(entryPath(host));
  if (entry === null) {
    return "unregistered";
  }
  const recorded = new RegExp(`^${APPIMAGE_KEY}=(.*)$`, "m").exec(entry)?.[1];
  return recorded === host.appImage ? "registered" : "stale";
}

/**
 * Register `.jxn` for the current user and this AppImage.
 *
 * @param host What to write and run.
 * @throws {Error} When this is not an AppImage, which has nothing of its own to register.
 */
export async function registerFileTypes(host: FileTypeHost): Promise<FileTypeReport> {
  if (host.appImage === null) {
    throw new Error("Only an AppImage registers .jxn files itself; every other copy is installed.");
  }
  const report: FileTypeReport = { ran: [], skipped: [], wrote: [] };
  const mime = join(host.dataHome, "mime", "packages", "jx-studio.xml");
  host.writeText(mime, JXN_MIME_XML);
  report.wrote.push(mime);

  let icon: string | null = null;
  if (host.icon !== null) {
    icon = iconPath(host);
    host.copyFile(host.icon, icon);
    report.wrote.push(icon);
  }
  const entry = entryPath(host);
  host.writeText(entry, appImageDesktopEntry(host.appImage, icon));
  report.wrote.push(entry);

  const tools: [string, string][] = [
    ["update-mime-database", join(host.dataHome, "mime")],
    ["update-desktop-database", join(host.dataHome, "applications")],
  ];
  for (const [tool, directory] of tools) {
    const program = host.which(tool);
    if (program === null) {
      report.skipped.push(tool);
      continue;
    }
    await host.run(program, [directory]);
    report.ran.push(tool);
  }
  return report;
}

/**
 * The host on this machine.
 *
 * @param env The process environment, which names the AppImage and the data directory.
 * @param icon The packaged icon, when there is one.
 */
export function nodeFileTypeHost(env: NodeJS.ProcessEnv, icon: string | null): FileTypeHost {
  return {
    appImage: env.APPIMAGE || null,
    copyFile: (from, to) => {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    },
    dataHome: env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
    icon,
    readText: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    run: (program, args) =>
      new Promise((resolve, reject) => {
        execFile(program, [...args], (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      }),
    which: (program) => executables.which(program),
    writeText: (path, text) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    },
  };
}

/**
 * Answer the bridge's three questions (`shared/bridge.ts`): whether this copy registers `.jxn`
 * itself, whether it has, and doing it.
 *
 * @param electron The Electron API.
 * @param host What registering reads and writes.
 */
export function registerFileTypeActions(electron: typeof Electron, host: FileTypeHost): void {
  electron.ipcMain.on(FILE_TYPE_CHANNELS.available, (event) => {
    event.returnValue = host.appImage !== null;
  });
  electron.ipcMain.handle(FILE_TYPE_CHANNELS.state, () => fileTypeState(host));
  electron.ipcMain.handle(FILE_TYPE_CHANNELS.register, () => registerFileTypes(host));
}
