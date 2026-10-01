/**
 * The one patch `build-msix.ts` applies to Electrobun's launcher `main.js` before compiling it into
 * `bin\bun.exe`.
 *
 * An MSIX installs under `C:\Program Files\WindowsApps`, and a Bun Worker started from there gets
 * EPERM reading its entrypoint. So the flat-files branch (the one a payload with no `app.asar`
 * takes) is rewritten to copy `Resources\app\bun\index.js` into the temp directory and start the
 * Worker from the copy, which is what the ASAR branch already does.
 *
 * ## Why this is a module with a test and not a string in `build-msix.ts`
 *
 * The first version of this patch called `__require("fs").readFileSync(...)`. That was right for
 * the Electrobun 1 launcher, whose bundle defined a `__require` helper. Electrobun 2's `main.js`
 * imports `readFileSync` from `fs` and defines no `__require`, so the patched line threw
 * `ReferenceError: __require is not defined` the moment the app started. `launcher.exe` spawned
 * `bun.exe`, `bun.exe` exited 1 with its stderr discarded, and the window never appeared: desktop
 * 5.2.0 passed Microsoft Store certification, installed from the Store, and could not launch.
 * Nothing in the build noticed, for two reasons this file removes:
 *
 * - The patch's own "pattern not found" case was a `console.log` warning, so a launcher that no
 *   longer matched produced an unpatched (EPERM) MSIX and a green build. It throws now.
 * - The patched text referenced identifiers nothing checked. {@link patchLauncherMain} refuses to
 *   patch a launcher that does not already import every identifier the replacement uses, so the
 *   next Electrobun that renames or drops one fails the build instead of the install.
 */

/** The flat-files branch exactly as Electrobun 2's launcher emits it. */
export const FLAT_FILES_ORIGINAL = `} else {
    console.log(\`[LAUNCHER] Loading app code from flat files\`);
    appEntrypointPath = join(appFolderPath, "bun", "index.js");
  }`;

export const FLAT_FILES_PATCHED = `} else {
    console.log(\`[LAUNCHER] Loading app code from flat files\`);
    const __flatEntry = join(appFolderPath, "bun", "index.js");
    const __appData = readFileSync(__flatEntry, "utf8");
    const __tmpName = \`electrobun-\${Date.now()}-\${Math.random().toString(36).substring(7)}.js\`;
    appEntrypointPath = join(tmpdir(), __tmpName);
    writeFileSync(appEntrypointPath, __appData);
    console.log(\`[LAUNCHER] Copied app entrypoint to: \${appEntrypointPath}\`);
  }`;

/** What {@link FLAT_FILES_PATCHED} calls, each of which the launcher must already have imported. */
export const REQUIRED_IMPORTS = ["join", "readFileSync", "tmpdir", "writeFileSync"] as const;

/** Names bound by the module's top-level `import { ... } from "..."` statements. */
export function importedNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/^import\s*\{([^}]*)\}\s*from\s*["'][^"']+["'];?/gm)) {
    for (const part of match[1]!.split(",")) {
      const local = part
        .trim()
        .split(/\s+as\s+/)
        .at(-1)!;
      if (local) {
        names.add(local);
      }
    }
  }
  return names;
}

/**
 * Returns `source` with the flat-files branch replaced by {@link FLAT_FILES_PATCHED}.
 *
 * Throws, rather than returning `source` unchanged, when the branch is absent (an Electrobun
 * upgrade reshaped it) or when the launcher does not import everything the replacement calls. An
 * unpatched or half-patched launcher both produce an MSIX that builds, certifies, and does not
 * start.
 */
export function patchLauncherMain(source: string): string {
  if (!source.includes(FLAT_FILES_ORIGINAL)) {
    throw new Error(
      "msix-launcher-patch: the launcher's flat-files branch no longer matches what " +
        "FLAT_FILES_ORIGINAL expects, so the EPERM workaround cannot be applied. Electrobun's " +
        "launcher changed; update scripts/msix-launcher-patch.ts against the new main.js.",
    );
  }

  const imported = importedNames(source);
  const missing = REQUIRED_IMPORTS.filter((name) => !imported.has(name));
  if (missing.length > 0) {
    throw new Error(
      `msix-launcher-patch: the launcher does not import ${missing.join(", ")}, which the patched ` +
        "flat-files branch calls. Using an undeclared name here is what shipped desktop 5.2.0 " +
        "unable to launch; import it in the launcher or change the patch.",
    );
  }

  return source.replace(FLAT_FILES_ORIGINAL, FLAT_FILES_PATCHED);
}
