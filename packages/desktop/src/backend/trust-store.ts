/**
 * Which folders the user has agreed to run code from (specs/desktop.md §4.7).
 *
 * A project is executable input: opening one runs its documents in the canvas and its modules in
 * this process. So the first open of a folder asks, and this store is what the answer is kept in.
 * It is consent and not a sandbox, and the key is a folder and not its contents: a `git pull` in a
 * trusted folder runs without asking again, and a trusted project's own code can edit this file.
 *
 * @docs studio/desktop
 */
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { readRecents } from "./recent-store";
import { normalizeRoot } from "./roots";
import { configFile } from "./user-config";
import { readStringStore, updateStore } from "./user-store";
import type { RecentProjectEntry } from "../shared/rpc-schema";

const STORE_NAME = "trusted-projects.json";

/** What the hub asks of the store. */
export interface TrustStore {
  /** Remember that the user agreed to run this folder's code. */
  grant: (root: string) => Promise<void>;
  /** Whether the user has agreed to. Anything uncertain is no: the worst case is one more prompt. */
  isTrusted: (root: string) => Promise<boolean>;
}

/**
 * The store's key for a folder.
 *
 * `normalizeRoot` resolves symlinks, so a link into a trusted folder is that folder and a link to
 * an unknown one is not trusted by its name. NFC is added here and not there, because
 * `normalizeRoot` also derives a project's storage partition, and changing that key would strand
 * the page storage of any project whose path macOS reports decomposed.
 */
function keyFor(root: string): string {
  return normalizeRoot(root).normalize("NFC");
}

/** What the store is built from, each replaceable by a test. */
export interface TrustStoreOptions {
  /** The store's path. */
  file?: string;
  /** The projects the user has already been working in. */
  recents?: () => Promise<RecentProjectEntry[]>;
}

/**
 * Open the store.
 *
 * The first time it runs it starts from Recent, so nobody who upgrades is asked about a project
 * they have been working in. Only an ABSENT file seeds: a file that exists and cannot be read reads
 * as empty, which asks again rather than trusting anything by accident.
 *
 * @param options Where it lives and what it seeds from.
 */
export function openTrustStore(options: TrustStoreOptions = {}): TrustStore {
  const { file = configFile(STORE_NAME), recents = readRecents } = options;
  let seeded: Promise<void> | null = null;

  function seed(): Promise<void> {
    seeded ??= (async () => {
      if (existsSync(file)) {
        return;
      }
      const stamp = new Date().toISOString();
      const known = await recents();
      const entries = known
        .filter((recent) => isAbsolute(recent.root))
        .map((recent) => [keyFor(recent.root), stamp] as const);
      await updateStore(file, readStringStore, (current) => ({
        ...Object.fromEntries(entries),
        ...current,
      }));
    })().catch((error: Error) => {
      // Nothing seeded means more prompts than necessary, never fewer.
      console.error("[trust-store]", error);
    });
    return seeded;
  }

  return {
    grant: async (root) => {
      await seed();
      const key = keyFor(root);
      await updateStore(file, readStringStore, (current) => ({
        ...current,
        [key]: new Date().toISOString(),
      }));
    },
    isTrusted: async (root) => {
      await seed();
      return Object.hasOwn(await readStringStore(file), keyFor(root));
    },
  };
}
