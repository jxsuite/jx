/**
 * Which prebuilt addon belongs to a host.
 *
 * A triple names one build of the addon: `linux-x64-gnu`, `darwin-arm64`, `win32-x64-msvc`. It is
 * the suffix of both the file a checkout builds (`jx-compiler.<triple>.node`) and the package npm
 * installs for that host (`@jxsuite/compiler-binding-<triple>`).
 */

/** Every triple a release builds, in the order the release lane publishes them. */
export const RELEASE_TRIPLES = [
  "linux-x64-gnu",
  "linux-x64-musl",
  "linux-arm64-gnu",
  "linux-arm64-musl",
  "darwin-x64",
  "darwin-arm64",
  "win32-x64-msvc",
  "win32-arm64-msvc",
] as const;

export type Triple = (typeof RELEASE_TRIPLES)[number];

/** The facts about a host that choose its addon. */
export interface Host {
  platform: string;
  arch: string;
  /** Whether the C library is musl. Only read on Linux. */
  musl: boolean;
}

/**
 * The triples that can load on a host, most likely first.
 *
 * Linux yields both C libraries, because the detection is a heuristic and trying the other build
 * costs one failed `require`. A host no release covers yields nothing, and the loader's error says
 * so.
 */
export function hostTriples(host: Host): Triple[] {
  const cpu = host.arch === "x64" || host.arch === "arm64" ? host.arch : null;
  if (!cpu) {
    return [];
  }
  if (host.platform === "linux") {
    const [first, second] = host.musl ? (["musl", "gnu"] as const) : (["gnu", "musl"] as const);
    return [`linux-${cpu}-${first}`, `linux-${cpu}-${second}`];
  }
  if (host.platform === "darwin") {
    return [`darwin-${cpu}`];
  }
  if (host.platform === "win32") {
    return [`win32-${cpu}-msvc`];
  }
  return [];
}

/** The file name of the addon a checkout builds for a triple. */
export function addonFileName(triple: string): string {
  return `jx-compiler.${triple}.node`;
}

/** The npm package that carries the prebuilt addon for a triple. */
export function addonPackageName(triple: string): string {
  return `@jxsuite/compiler-binding-${triple}`;
}
