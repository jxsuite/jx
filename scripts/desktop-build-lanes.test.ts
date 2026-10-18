/**
 * The desktop release lanes, judged without running them.
 *
 * The three `bundle-desktop-*` workflows, the Store lane and the orchestration that wires them are
 * `workflow_call`-only, so nothing executes them before a tag: a wrong file name, a missing flag or
 * a job that no longer waits for the asset it downloads is first discovered by a release. These
 * tests hold the contracts that can be read from the files:
 *
 * - Each lane packages through the desktop package's own script, for the target and architecture it
 *   is named for, and without publishing (the lane attaches the files itself);
 * - Each lane starts the packaged backend before it ships, the guard that would have caught every
 *   packaging bug found while writing this pipeline;
 * - The files electrobuilder will name (from `electron-builder.yml`) are the files
 *   `release-assets.json` promises, and the globs each lane uploads cover them, with the update
 *   metadata electron-updater reads;
 * - The Store lane downloads what the Windows lane builds, and waits for it.
 *
 * It lives flat in `scripts/` for the same reason `scripts/dependabot-config.test.ts` does: it runs
 * unconditionally via `bun test --isolate scripts` in test.yml's `changes` job, and `.github/**`
 * reaches no test workspace, so this is the only place a workflow edit is judged.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isString } from "@jxsuite/schema/guards";

const WORKFLOWS = ".github/workflows";
const DESKTOP = "packages/desktop";

interface Step {
  "continue-on-error"?: boolean;
  if?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: { files?: string; path?: string };
}
interface Job {
  if?: string;
  needs?: string | string[];
  steps?: Step[];
  strategy?: { matrix?: { include?: { arch?: string; platform?: string }[] } };
}
interface Workflow {
  jobs?: Record<string, Job>;
}

/** Parse a committed workflow. */
function workflow(file: string): Workflow {
  /* SAFETY: every file is a committed GitHub Actions workflow, and every `Workflow` / `Job` /
     `Step` member read here is optional and re-checked where its value is used. */
  return Bun.YAML.parse(readFileSync(join(WORKFLOWS, file), "utf8")) as Workflow;
}

/** The one job of a bundle lane, and its steps. */
function steps(file: string): Step[] {
  return Object.values(workflow(file).jobs ?? {})[0]?.steps ?? [];
}

/** The step whose command contains `needle`. */
function stepRunning(file: string, needle: string): Step | undefined {
  return steps(file).find((step) => isString(step.run) && step.run.includes(needle));
}

/** The lines of a multi-line `with: files:` / `path:` value. */
function globs(value: string | undefined): string[] {
  return (value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** What the release asset manifest promises. */
interface Asset {
  downloadable: boolean;
  file: string;
  platform: string;
}
function releaseAssets(): Asset[] {
  /* SAFETY: this package's own committed manifest; `assets` entries carry these three members. */
  return (
    JSON.parse(readFileSync(join(DESKTOP, "release-assets.json"), "utf8")) as { assets: Asset[] }
  ).assets;
}

/** The one member of an electron-builder block these tests read. */
interface Named {
  artifactName?: string;
}
/** The blocks of `electron-builder.yml` that name an artifact. */
interface BuilderConfig {
  appx?: Named;
  linux?: Named;
  mac?: Named;
  nsis?: Named;
}

/** The `artifactName` a platform block (or its installer block) declares. */
function artifactName(block: keyof BuilderConfig): string {
  /* SAFETY: this package's own committed config; the four blocks read here are mappings whose
     only member read is `artifactName`, re-checked as a string below. */
  const config = Bun.YAML.parse(
    readFileSync(join(DESKTOP, "electron-builder.yml"), "utf8"),
  ) as BuilderConfig;
  const name = config[block]?.artifactName;
  if (!isString(name)) {
    throw new Error(`electron-builder.yml has no ${block}.artifactName`);
  }
  return name;
}

/** Expand electron-builder's `${arch}` and `${ext}` the way it does for one target. */
function expand(pattern: string, arch: string, ext: string): string {
  return pattern.replace("${arch}", arch).replace("${ext}", ext);
}

const LANES = [
  { arch: "arm64", file: "bundle-desktop-macos.yml", target: "mac" },
  { arch: "x64", file: "bundle-desktop-windows.yml", target: "win" },
  { arch: "${{ matrix.arch }}", file: "bundle-desktop-linux.yml", target: "linux" },
] as const;

describe("every bundle lane", () => {
  test.each(LANES)(
    "$file packages $target through the desktop package, without publishing",
    (lane) => {
      const run = stepRunning(lane.file, "package --target")?.run ?? "";
      expect(run).toContain("bun run --cwd packages/desktop package");
      expect(run).toContain(`--target ${lane.target}`);
      expect(run).toContain(`--arch ${lane.arch}`);
      // The lane attaches the files itself, so electron-builder must not also publish them.
      expect(run).toContain("--publish never");
    },
  );

  test.each(LANES)("$file starts the packaged backend before it ships", (lane) => {
    expect(stepRunning(lane.file, "--cwd packages/desktop smoke")).toBeDefined();
  });

  test("only the Windows smoke test is allowed to fail without failing the lane, until it has run", () => {
    const tolerant = LANES.flatMap((lane) =>
      stepRunning(lane.file, "--cwd packages/desktop smoke")?.["continue-on-error"] === true
        ? [lane.target]
        : [],
    );
    expect(tolerant).toEqual(["win"]);
  });

  test.each(LANES)("$file attaches to the release even when an earlier step failed", (lane) => {
    const attach = steps(lane.file).find((step) =>
      step.uses?.startsWith("softprops/action-gh-release"),
    );
    expect(attach?.if).toBe("${{ !cancelled() }}");
  });

  test.each(LANES)("$file never mentions the toolchain it replaced", (lane) => {
    expect(readFileSync(join(WORKFLOWS, lane.file), "utf8")).not.toMatch(/electrobun|hutch/i);
  });
});

describe("the files each lane ships", () => {
  /** Every download the manifest promises, by platform. */
  const downloadable = (platform: string): string[] =>
    releaseAssets()
      .flatMap((asset) => (asset.downloadable && asset.platform === platform ? [asset.file] : []))
      .toSorted();

  test("macOS: the dmg electron-builder names is the dmg the manifest promises", () => {
    expect([expand(artifactName("mac"), "arm64", "dmg")]).toEqual(downloadable("macos"));
  });

  test("Windows: the installer electron-builder names is the one the manifest promises", () => {
    expect([expand(artifactName("nsis"), "x64", "exe")]).toEqual(downloadable("windows"));
  });

  test("Linux: the AppImage for each architecture is what the manifest promises", () => {
    expect(
      ["arm64", "x64"].map((arch) => expand(artifactName("linux"), arch, "AppImage")).toSorted(),
    ).toEqual(downloadable("linux"));
  });

  test.each([
    ["bundle-desktop-macos.yml", ["*.dmg", "*.zip", "*.blockmap", "latest*.yml"]],
    ["bundle-desktop-windows.yml", ["*.exe", "*.appx", "*.blockmap", "latest*.yml"]],
    ["bundle-desktop-linux.yml", ["*.AppImage", "latest*.yml"]],
  ])("%s uploads and attaches the installers and the update metadata", (file, wanted) => {
    const attach = steps(file).find((step) => step.uses?.startsWith("softprops/action-gh-release"));
    const upload = steps(file).find((step) => step.uses?.startsWith("actions/upload-artifact"));
    for (const kind of [attach?.with?.files, upload?.with?.path]) {
      const listed = globs(kind).map((glob) => glob.replace("packages/desktop/artifacts/", ""));
      expect(listed).toEqual(wanted);
    }
  });

  test("the macOS lane ships the zip electron-updater applies, not only the dmg people download", () => {
    expect(expand(artifactName("mac"), "arm64", "zip")).toBe("macos-arm64-JxStudio.zip");
  });
});

describe("the Store lane", () => {
  test("downloads the appx the Windows lane builds, with the name electron-builder gives it", () => {
    const download = stepRunning("store-publish.yml", "gh release download");
    expect(download?.run).toContain("--pattern '*.appx'");
    expect(expand(artifactName("appx"), "x64", "appx")).toBe("win-x64-JxStudio.appx");
  });

  test("is wired to wait for the Windows lane, and skips when it failed", () => {
    const store = workflow("release-please.yml").jobs?.["store-publish"];
    expect(store?.needs).toEqual(["release-please", "desktop-windows"]);
    expect(store?.if ?? "").toContain("needs.desktop-windows.result == 'success'");
  });

  test("release-please no longer waits for a build job that does not exist", () => {
    const jobs = workflow("release-please.yml").jobs ?? {};
    expect(jobs["build-msix"]).toBeUndefined();
    for (const job of Object.values(jobs)) {
      const needs = job.needs === undefined ? [] : [job.needs].flat();
      expect(needs).not.toContain("build-msix");
    }
  });
});

describe("the workflow set as a whole", () => {
  test("no workflow names the toolchain the desktop app moved off", () => {
    const offenders = readdirSync(WORKFLOWS)
      .filter((file) => /\.ya?ml$/.test(file))
      .filter((file) =>
        /electrobun|hutch|cottontail/i.test(readFileSync(join(WORKFLOWS, file), "utf8")),
      );
    expect(offenders).toEqual([]);
  });

  test("the pull-request workflow stages and smoke-tests the desktop backend, and `ci` requires it", () => {
    const pullRequests = workflow("test.yml");
    const job = pullRequests.jobs?.["desktop-bundle"];
    const commands = (job?.steps ?? []).map((step) => step.run ?? "");
    expect(commands).toContain("bun run --cwd packages/desktop stage");
    expect(commands).toContain("bun run --cwd packages/desktop smoke");
    expect([pullRequests.jobs?.ci?.needs].flat()).toContain("desktop-bundle");
  });
});
