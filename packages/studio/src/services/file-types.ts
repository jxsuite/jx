/**
 * Registering `.jxn` with the desktop, for the one desktop copy that does it when asked: an
 * AppImage (desktop.md §7.8).
 *
 * Every other channel declares the type when it is installed, so the command exists only where the
 * desktop adapter publishes `fileTypes`, a launcher-only member outside `StudioPlatform`, as
 * `windowControls` is (desktop.md §3.1). An AppImage that moved since it registered is told so as
 * the window opens, rather than re-registered behind the user's back.
 *
 * @docs studio/desktop
 */
import { isFunction, isJsonObject, isNonNullObject, isString } from "@jxsuite/schema/guards";
import { errorMessage } from "@jxsuite/schema/parse";
import { getPlatform, hasPlatform } from "../platform";
import { notify } from "./notify";
import type { Command } from "../commands/registry";
import type { FileTypeRegistration, FileTypeReport, FileTypeState, StudioPlatform } from "../types";
import type { JsonObject } from "@jxsuite/schema/types";

const STATES: readonly FileTypeState[] = ["unregistered", "registered", "stale"];

/** One list of a report, as the desktop answered it. */
function names(report: JsonObject, key: keyof FileTypeReport): string[] {
  const value = report[key];
  return Array.isArray(value) ? value.filter((item) => isString(item)) : [];
}

/**
 * A host as this module reads it: Studio's platform, which a launcher may give members of its own
 * beyond the interface (desktop.md §3.1).
 */
export type LauncherHost = StudioPlatform | { readonly fileTypes?: unknown };

/** The id the command and the stale warning's action share. */
export const REGISTER_FILE_TYPES = "file.registerFileTypes";

/**
 * The host's registration, or null on every host that has none.
 *
 * @param platform The registered adapter, the current one by default.
 */
export function fileTypeRegistration(
  platform: LauncherHost | null = hasPlatform() ? getPlatform() : null,
): FileTypeRegistration | null {
  if (platform === null || !("fileTypes" in platform)) {
    return null;
  }
  const { fileTypes } = platform;
  if (
    !isNonNullObject(fileTypes) ||
    !("register" in fileTypes && isFunction(fileTypes.register)) ||
    !("state" in fileTypes && isFunction(fileTypes.state))
  ) {
    return null;
  }
  const { register, state } = fileTypes;
  // What crosses the preload is checked here, at the boundary, rather than asserted.
  return {
    register: async () => {
      const answer: unknown = await Promise.resolve(register());
      // A report crosses the preload by structured clone, as plain data.
      return isJsonObject(answer)
        ? {
            ran: names(answer, "ran"),
            skipped: names(answer, "skipped"),
            wrote: names(answer, "wrote"),
          }
        : { ran: [], skipped: [], wrote: [] };
    },
    state: async () => {
      const answer: unknown = await Promise.resolve(state());
      // Anything but one of the three is read as not registered.
      return STATES.find((known) => known === answer) ?? "unregistered";
    },
  };
}

/** Register `.jxn`, and say what happened. */
export async function registerJxnFiles(): Promise<void> {
  const registration = fileTypeRegistration();
  if (!registration) {
    return;
  }
  try {
    const report = await registration.register();
    const later =
      report.skipped.length > 0
        ? ` Your desktop picks it up the next time you sign in, because ${report.skipped.join(" and ")} is not installed.`
        : "";
    notify.success(`Double-clicking a .jxn file now opens it in this copy of Jx Studio.${later}`, {
      key: "file-types",
      source: "Desktop",
    });
  } catch (error) {
    notify.error("Could not register .jxn files.", {
      detail: errorMessage(error),
      key: "file-types",
      source: "Desktop",
    });
  }
}

/**
 * Say so when `.jxn` is registered for a copy of the AppImage that has since moved, so a
 * double-click would start the old one. Nothing is rewritten without being asked.
 */
export async function checkJxnRegistration(): Promise<void> {
  const registration = fileTypeRegistration();
  if (!registration) {
    return;
  }
  let state: FileTypeState;
  try {
    state = await registration.state();
  } catch {
    return;
  }
  if (state === "stale") {
    notify.warn(
      ".jxn files open with a copy of Jx Studio that is somewhere else. Register .jxn Files again to open them with this one.",
      { action: REGISTER_FILE_TYPES, key: "file-types", source: "Desktop" },
    );
  }
}

/** The command records. */
export function fileTypeCommands(): Command[] {
  return [
    {
      id: REGISTER_FILE_TYPES,
      title: "Register .jxn Files",
      category: "File",
      level: "application",
      menus: ["palette"],
      when: (ctx) => ctx.capability.fileTypes,
      requires: "an AppImage, the one copy of Jx Studio that registers file types when asked",
      run: () => registerJxnFiles(),
    },
  ];
}
