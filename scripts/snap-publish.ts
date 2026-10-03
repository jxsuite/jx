/**
 * Publishes the desktop snaps to the Snap Store, so an Ubuntu release reaches `snap install
 * jx-studio` the same way a Windows release reaches the Microsoft Store (`store-publish.yml`): with
 * nothing left for a human to click after the one-time setup.
 *
 * `build-snap.yml` builds one `jx-studio_<version>_<arch>.snap` per architecture
 * (`packages/desktop/snap/snapcraft.yaml`) and attaches them to the `desktop-v*` release; this
 * uploads each one with `snapcraft upload --release=<channels>`. snapcraft is the store's own
 * client and the only supported one, so this drives the CLI rather than the store API. What this
 * script adds is the policy the CLI does not have:
 *
 * - **Soft no-op until the secret exists.** `SNAPCRAFT_STORE_CREDENTIALS` is the output of `snapcraft
 *   export-login`, a one-time manual step (packages/desktop/AGENTS.md, "Snap Store Publishing").
 *   Until it is set this exits 0 with a notice rather than reddening every release.
 * - **Idempotent re-runs.** The store refuses a byte-identical upload. On a re-run of a release that
 *   already reached the store, that refusal means the work is done, so it is success.
 * - **Manual review is not failure.** The store holds some uploads for a human reviewer (always the
 *   first, and any that change interfaces). That is the analogue of MSIX certification still
 *   running: the upload landed, and the store releases it when the review passes.
 * - **The one quiet failure gets a warning.** An exported login lasts at most a year. When it lapses,
 *   every release would fail on authentication, so a credential that expires within
 *   `EXPIRY_WARNING_DAYS` is announced on every run before that happens.
 *
 *   bun scripts/snap-publish.ts [--release=stable] <file.snap>...
 */

import { existsSync } from "node:fs";
import { basename } from "node:path";

export const CREDENTIALS_ENV = "SNAPCRAFT_STORE_CREDENTIALS";
export const EXPIRY_WARNING_DAYS = 30;
const DEFAULT_CHANNELS = "stable";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CommandResult {
  exitCode: number;
  output: string;
}

/** The store client, injected so the policy is testable without a store account. */
export interface SnapcraftCli {
  upload: (file: string, channels: string) => Promise<CommandResult>;
  whoami: () => Promise<CommandResult>;
}

export function parseArgs(argv: string[]): { files: string[]; channels: string } {
  let channels = DEFAULT_CHANNELS;
  const files: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith("--release=")) {
      channels = arg.slice("--release=".length);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      files.push(arg);
    }
  }
  if (files.length === 0) {
    throw new Error("Expected at least one .snap file");
  }
  if (!/^[a-z0-9./-]+(,[a-z0-9./-]+)*$/.test(channels)) {
    throw new Error(`Invalid channel list: ${JSON.stringify(channels)}`);
  }
  return { channels, files };
}

export type UploadOutcome =
  | { kind: "released"; revision: string | null }
  | { kind: "already-uploaded" }
  | { kind: "manual-review"; revision: string | null }
  | { kind: "failed"; output: string };

/**
 * What one `snapcraft upload` meant. Unknown output with a non-zero exit is a failure: the patterns
 * only ever turn a known refusal into success, never an unknown one.
 */
export function classifyUpload({ exitCode, output }: CommandResult): UploadOutcome {
  const revision = /Revision (\d+)/i.exec(output)?.[1] ?? null;
  if (/manual review/i.test(output)) {
    return { kind: "manual-review", revision };
  }
  if (exitCode === 0) {
    return { kind: "released", revision };
  }
  if (/already been uploaded|already uploaded|binary_sha3_384/i.test(output)) {
    return { kind: "already-uploaded" };
  }
  return { kind: "failed", output };
}

/** Days until the exported login expires, from `snapcraft whoami`, or null if it does not say. */
export function daysUntilExpiry(whoamiOutput: string, now: Date): number | null {
  const match = /expires:\s*(\S+)/i.exec(whoamiOutput);
  if (!match) {
    return null;
  }
  const expires = Date.parse(match[1]!);
  if (Number.isNaN(expires)) {
    return null;
  }
  return Math.floor((expires - now.getTime()) / DAY_MS);
}

export interface PublishResult {
  failed: boolean;
  lines: string[];
}

export async function publishSnaps(
  cli: SnapcraftCli,
  { files, channels, now = new Date() }: { files: string[]; channels: string; now?: Date },
): Promise<PublishResult> {
  const lines: string[] = [];
  for (const file of files) {
    if (!existsSync(file)) {
      throw new Error(`No such file: ${file}`);
    }
  }

  const who = await cli.whoami();
  if (who.exitCode !== 0) {
    return {
      failed: true,
      lines: [`snapcraft whoami failed; the credentials were refused:\n${who.output}`],
    };
  }
  const days = daysUntilExpiry(who.output, now);
  if (days !== null && days <= EXPIRY_WARNING_DAYS) {
    lines.push(
      `::warning::${CREDENTIALS_ENV} expires in ${days} day(s). Re-run snapcraft export-login and ` +
        `replace the secret before then (packages/desktop/AGENTS.md, "Snap Store Publishing").`,
    );
  }

  let failed = false;
  for (const file of files) {
    const name = basename(file);
    const outcome = classifyUpload(await cli.upload(file, channels));
    switch (outcome.kind) {
      case "released": {
        lines.push(`${name}: revision ${outcome.revision ?? "?"} released to ${channels}.`);
        break;
      }
      case "already-uploaded": {
        lines.push(`${name}: the store already has this exact file; nothing to do.`);
        break;
      }
      case "manual-review": {
        lines.push(
          `${name}: revision ${outcome.revision ?? "?"} is held for manual review; the store ` +
            `releases it to ${channels} when the review passes.`,
        );
        break;
      }
      case "failed": {
        failed = true;
        lines.push(`::error::${name}: upload failed:\n${outcome.output}`);
        break;
      }
      default: {
        const exhaustive: never = outcome;
        throw new Error(`Unhandled outcome: ${JSON.stringify(exhaustive)}`);
      }
    }
  }
  return { failed, lines };
}

async function run(cmd: string[]): Promise<CommandResult> {
  const proc = Bun.spawn(cmd, { stderr: "pipe", stdout: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, output: `${stdout}${stderr}` };
}

/** The real client: the `snapcraft` CLI, which reads the credentials from the environment itself. */
export const liveCli: SnapcraftCli = {
  upload: (file, channels) => run(["snapcraft", "upload", `--release=${channels}`, file]),
  whoami: () => run(["snapcraft", "whoami"]),
};

if (import.meta.main) {
  if (!Bun.env[CREDENTIALS_ENV]) {
    console.log(
      `Snap Store credentials not configured (missing ${CREDENTIALS_ENV}); skipping the upload. ` +
        'See packages/desktop/AGENTS.md\'s "Snap Store Publishing" section.',
    );
    process.exit(0);
  }
  const { files, channels } = parseArgs(Bun.argv.slice(2));
  const result = await publishSnaps(liveCli, { channels, files });
  for (const line of result.lines) {
    console.log(line);
  }
  process.exit(result.failed ? 1 : 0);
}
