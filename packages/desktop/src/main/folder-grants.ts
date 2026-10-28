/**
 * The folders a Mac App Store build has been allowed into, kept across launches.
 *
 * The App Sandbox lets an application read a folder only after the user has picked it, and the
 * permission belongs to the process that received it and to the children that process starts
 * afterwards. Studio's backend is a child of the Electron main process, so a folder picked after
 * the backend started is invisible to it. A security-scoped bookmark is how a grant outlives the
 * launch: this module stores one per picked folder, and `restore` takes them all back up before the
 * backend is spawned, so the backend inherits every folder the user has ever chosen.
 *
 * Everything the platform does is a parameter, so a test holds the logic without a sandbox.
 *
 * @docs studio/desktop
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative } from "node:path";

/** One granted folder and the bookmark that restores access to it. */
export interface Grant {
  /** The base64 bookmark Electron's dialog returned for the pick. */
  bookmark: string;
  /** The folder the grant covers: it and everything inside it. */
  path: string;
}

/** Where grants are kept between launches. */
export interface GrantStore {
  read: () => Grant[];
  write: (grants: Grant[]) => void;
}

/** What the app does with grants: ask whether a path is covered, take a new one, restore the old. */
export interface FolderGrants {
  /** Remember `bookmark` for `path` and start using it now. */
  add: (path: string, bookmark: string) => void;
  /** Whether `path` is a granted folder or lies inside one. */
  covers: (path: string) => boolean;
  /** Start using every stored grant; call before the backend is spawned. */
  restore: () => void;
}

/** Whether `path` is `folder` or lies inside it. */
function isInside(folder: string, path: string): boolean {
  const inside = relative(folder, path);
  return inside === "" || (!inside.startsWith("..") && !isAbsolute(inside));
}

/** Whether a value read from disk has the shape of a grant. */
function isGrant(value: unknown): value is Grant {
  return (
    typeof value === "object" &&
    value !== null &&
    "path" in value &&
    "bookmark" in value &&
    typeof value.path === "string" &&
    typeof value.bookmark === "string"
  );
}

/**
 * Keep grants in a JSON file.
 *
 * A missing or unreadable file is no grants at all, and a write that fails is reported and dropped:
 * losing a bookmark costs the user one more folder prompt, and must never stop the app.
 *
 * @param file The JSON file.
 */
export function fileGrantStore(file: string): GrantStore {
  return {
    read: () => {
      try {
        const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
        if (!Array.isArray(parsed)) {
          return [];
        }
        return parsed.filter((entry): entry is Grant => isGrant(entry));
      } catch {
        return [];
      }
    },
    write: (grants) => {
      try {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(grants, null, 2));
      } catch (error) {
        console.error("[folder-grants]", error);
      }
    },
  };
}

/**
 * Open the grants a store holds.
 *
 * @param store Where grants are kept.
 * @param startAccessing Electron's `app.startAccessingSecurityScopedResource`: it takes a bookmark
 *   and returns the function that gives the access back.
 */
export function openFolderGrants(
  store: GrantStore,
  startAccessing: (bookmark: string) => () => void,
): FolderGrants {
  const grants = store.read();
  const using = new Set<string>();

  function use(grant: Grant): void {
    if (using.has(grant.path)) {
      return;
    }
    try {
      startAccessing(grant.bookmark);
      using.add(grant.path);
    } catch (error) {
      // A bookmark whose folder has moved or been deleted: skip it, the user will pick again.
      console.error("[folder-grants]", error);
    }
  }

  return {
    add: (path, bookmark) => {
      const existing = grants.findIndex((grant) => grant.path === path);
      if (existing === -1) {
        grants.push({ bookmark, path });
      } else {
        grants[existing] = { bookmark, path };
        using.delete(path);
      }
      store.write(grants);
      use({ bookmark, path });
    },
    covers: (path) => grants.some((grant) => using.has(grant.path) && isInside(grant.path, path)),
    restore: () => {
      for (const grant of grants) {
        use(grant);
      }
    },
  };
}
