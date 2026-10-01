import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CommandResult, SnapcraftCli } from "./snap-publish";
import {
  classifyUpload,
  daysUntilExpiry,
  EXPIRY_WARNING_DAYS,
  parseArgs,
  publishSnaps,
} from "./snap-publish";

const NOW = new Date("2026-10-01T00:00:00Z");
const WHOAMI_OK = "email: ci@jxsuite.com\nusername: jxsuite\nexpires: 2027-09-30T00:00:00.000Z\n";

let dir: string;
let amd64: string;
let arm64: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "snap-publish-"));
  amd64 = join(dir, "jx-studio_5.2.0_amd64.snap");
  arm64 = join(dir, "jx-studio_5.2.0_arm64.snap");
  writeFileSync(amd64, "");
  writeFileSync(arm64, "");
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

const LOGGED_IN: CommandResult = { exitCode: 0, output: WHOAMI_OK };

function fakeCli(
  uploads: CommandResult[],
  whoami: CommandResult = LOGGED_IN,
): SnapcraftCli & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async upload(file, channels) {
      calls.push(`upload:${file.split(/[\\/]/).pop()}:${channels}`);
      return uploads.shift() ?? { exitCode: 0, output: "Revision 1 created" };
    },
    async whoami() {
      calls.push("whoami");
      return whoami;
    },
  };
}

describe("parseArgs", () => {
  test("defaults the channel to stable and keeps every file", () => {
    expect(parseArgs(["a.snap", "b.snap"])).toEqual({
      channels: "stable",
      files: ["a.snap", "b.snap"],
    });
  });

  test("takes a channel list from --release", () => {
    expect(parseArgs(["--release=edge,beta", "a.snap"]).channels).toBe("edge,beta");
  });

  test("refuses no files, unknown options and malformed channels", () => {
    expect(() => parseArgs([])).toThrow("at least one");
    expect(() => parseArgs(["--channel=edge", "a.snap"])).toThrow("Unknown option");
    expect(() => parseArgs(["--release=edge;rm", "a.snap"])).toThrow("Invalid channel");
  });
});

describe("classifyUpload", () => {
  test("a clean exit is a release, with its revision", () => {
    expect(
      classifyUpload({ exitCode: 0, output: "Revision 12 created for 'jx-studio' and released" }),
    ).toEqual({ kind: "released", revision: "12" });
  });

  test("a hold for manual review is not a failure, whatever the exit code", () => {
    for (const exitCode of [0, 1]) {
      expect(
        classifyUpload({ exitCode, output: "Revision 3 created, needs manual review" }).kind,
      ).toBe("manual-review");
    }
  });

  test("a byte-identical re-upload is already done", () => {
    expect(
      classifyUpload({ exitCode: 1, output: "binary_sha3_384: already been uploaded" }).kind,
    ).toBe("already-uploaded");
  });

  test("an unknown refusal stays a failure and carries the store's message", () => {
    expect(classifyUpload({ exitCode: 2, output: "lint-snap-v2_confinement" })).toEqual({
      kind: "failed",
      output: "lint-snap-v2_confinement",
    });
  });

  test("a clean exit without a revision is still a release", () => {
    expect(classifyUpload({ exitCode: 0, output: "" })).toEqual({
      kind: "released",
      revision: null,
    });
  });
});

describe("daysUntilExpiry", () => {
  test("reads the expiry snapcraft whoami prints", () => {
    expect(daysUntilExpiry(WHOAMI_OK, NOW)).toBe(364);
  });

  test("is null when whoami does not say, or says something unparseable", () => {
    expect(daysUntilExpiry("username: jxsuite", NOW)).toBeNull();
    expect(daysUntilExpiry("expires: someday", NOW)).toBeNull();
  });
});

describe("publishSnaps", () => {
  test("checks the login, then uploads every architecture to the channel", async () => {
    const cli = fakeCli([
      { exitCode: 0, output: "Revision 7 created" },
      { exitCode: 0, output: "Revision 8 created" },
    ]);
    const result = await publishSnaps(cli, { channels: "stable", files: [amd64, arm64], now: NOW });
    expect(cli.calls).toEqual([
      "whoami",
      "upload:jx-studio_5.2.0_amd64.snap:stable",
      "upload:jx-studio_5.2.0_arm64.snap:stable",
    ]);
    expect(result.failed).toBe(false);
    expect(result.lines).toEqual([
      "jx-studio_5.2.0_amd64.snap: revision 7 released to stable.",
      "jx-studio_5.2.0_arm64.snap: revision 8 released to stable.",
    ]);
  });

  test("a re-run and a manual-review hold both succeed", async () => {
    const cli = fakeCli([
      { exitCode: 1, output: "already been uploaded" },
      { exitCode: 0, output: "Revision 9 created; waiting for manual review" },
    ]);
    const result = await publishSnaps(cli, { channels: "edge", files: [amd64, arm64], now: NOW });
    expect(result.failed).toBe(false);
    expect(result.lines[0]).toContain("already has this exact file");
    expect(result.lines[1]).toContain("revision 9 is held for manual review");
  });

  test("one failed architecture fails the run but still attempts the other", async () => {
    const cli = fakeCli([
      { exitCode: 1, output: "review failed" },
      { exitCode: 0, output: "Revision 4" },
    ]);
    const result = await publishSnaps(cli, { channels: "stable", files: [amd64, arm64], now: NOW });
    expect(result.failed).toBe(true);
    expect(cli.calls).toHaveLength(3);
    expect(result.lines[0]).toStartWith("::error::jx-studio_5.2.0_amd64.snap");
  });

  test("warns when the exported login is about to lapse", async () => {
    const soon = new Date(NOW.getTime() + (EXPIRY_WARNING_DAYS - 1) * 24 * 60 * 60 * 1000);
    const cli = fakeCli([], { exitCode: 0, output: `expires: ${soon.toISOString()}` });
    const result = await publishSnaps(cli, { channels: "stable", files: [amd64], now: NOW });
    expect(result.lines[0]).toStartWith("::warning::SNAPCRAFT_STORE_CREDENTIALS expires in 29");
  });

  test("refused credentials fail before anything is uploaded", async () => {
    const cli = fakeCli([], { exitCode: 1, output: "invalid macaroon" });
    const result = await publishSnaps(cli, { channels: "stable", files: [amd64], now: NOW });
    expect(result.failed).toBe(true);
    expect(cli.calls).toEqual(["whoami"]);
    expect(result.lines[0]).toContain("invalid macaroon");
  });

  test("a missing file throws before the store is contacted", () => {
    const cli = fakeCli([]);
    expect(
      publishSnaps(cli, { channels: "stable", files: [join(dir, "nope.snap")], now: NOW }),
    ).rejects.toThrow("No such file");
    expect(cli.calls).toEqual([]);
  });
});
