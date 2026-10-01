/**
 * Covers `scripts/store-submit.ts` without touching a real Partner Center account: the network
 * client is a fake that records calls, so what's under test is the decision logic — the credentials
 * gate, the pending-submission guard, the package swap, and the poll's terminal conditions — not
 * the HTTP.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isFailureStatus,
  isTerminalStatus,
  mergePackages,
  missingCredentials,
  parseArgs,
  pollUntilSettled,
  readCredentials,
  submitToStore,
} from "./store-submit.ts";
import type { PackageEntry, StoreClient } from "./store-submit.ts";

describe("missingCredentials / readCredentials", () => {
  const full = {
    STORE_TENANT_ID: "tenant",
    STORE_CLIENT_ID: "client",
    STORE_CLIENT_SECRET: "secret",
    STORE_APP_ID: "9P7DQL3T4NJ6",
  };

  test("nothing missing once all four are set", () => {
    expect(missingCredentials(full)).toEqual([]);
    expect(readCredentials(full)).toEqual({
      tenantId: "tenant",
      clientId: "client",
      clientSecret: "secret",
      appId: "9P7DQL3T4NJ6",
    });
  });

  test("names each absent var, not just the first", () => {
    expect(missingCredentials({})).toEqual([
      "STORE_TENANT_ID",
      "STORE_CLIENT_ID",
      "STORE_CLIENT_SECRET",
      "STORE_APP_ID",
    ]);
  });

  test("readCredentials refuses a partial set rather than returning half-filled creds", () => {
    // A partial set (e.g. only STORE_APP_ID set by someone mid-setup) must not produce credentials with `undefined` fields silently cast to strings — that would fail at the AAD token call with a confusing 400 instead of the clear "not configured yet" notice.
    expect(readCredentials({ STORE_APP_ID: "9P7DQL3T4NJ6" })).toBeNull();
  });
});

describe("mergePackages", () => {
  test("a fresh app with no existing packages just adds the new one", () => {
    expect(mergePackages([], "JxStudio_5.2.0.0_x64.msix")).toEqual([
      { fileName: "JxStudio_5.2.0.0_x64.msix", fileStatus: "PendingUpload" },
    ]);
  });

  test("marks every existing package for deletion and queues the new one", () => {
    const existing: PackageEntry[] = [
      {
        fileName: "JxStudio_0.20.0.0_x64.msix",
        fileStatus: "Published",
        minimumDirectXVersion: "None",
      },
    ];
    expect(mergePackages(existing, "JxStudio_5.2.0.0_x64.msix")).toEqual([
      {
        fileName: "JxStudio_0.20.0.0_x64.msix",
        fileStatus: "PendingDelete",
        minimumDirectXVersion: "None",
      },
      { fileName: "JxStudio_5.2.0.0_x64.msix", fileStatus: "PendingUpload" },
    ]);
  });

  test("re-running for the same version is a no-op on that entry, not a duplicate", () => {
    // A retry after a transient failure re-submits the same file name. It must not appear twice — once as the kept `PendingUpload` and once marked for deletion — which would tell the Store API to delete the very package it's meant to publish.
    const existing: PackageEntry[] = [
      { fileName: "JxStudio_5.2.0.0_x64.msix", fileStatus: "PendingUpload" },
    ];
    expect(mergePackages(existing, "JxStudio_5.2.0.0_x64.msix")).toEqual([
      { fileName: "JxStudio_5.2.0.0_x64.msix", fileStatus: "PendingUpload" },
    ]);
  });

  test("preserves fields it doesn't own, other than fileStatus", () => {
    const existing: PackageEntry[] = [
      { fileName: "old.msix", fileStatus: "Published", minimumDirectXVersion: "12" },
    ];
    const [kept] = mergePackages(existing, "new.msix");
    expect(kept).toMatchObject({ minimumDirectXVersion: "12" });
  });
});

describe("isTerminalStatus / isFailureStatus", () => {
  test.each([
    ["CommitStarted", false],
    ["PreProcessing", false],
    ["Certification", false],
    ["PreProcessingFailed", true],
    ["CertificationFailed", true],
    ["ReleaseFailed", true],
    ["Release", true],
    ["Published", true],
  ])("%s -> terminal=%s", (status, terminal) => {
    expect(isTerminalStatus(status)).toBe(terminal);
  });

  test("only *Failed statuses are failures, not every terminal status", () => {
    expect(isFailureStatus("Release")).toBe(false);
    expect(isFailureStatus("Published")).toBe(false);
    expect(isFailureStatus("CertificationFailed")).toBe(true);
  });
});

describe("parseArgs", () => {
  test("takes the one positional argument", () => {
    expect(parseArgs(["packages/desktop/artifacts/JxStudio_5.2.0.0_x64.msix"])).toEqual({
      msixPath: "packages/desktop/artifacts/JxStudio_5.2.0.0_x64.msix",
    });
  });

  test("ignores flags when picking the positional argument", () => {
    expect(parseArgs(["--verbose", "a.msix"])).toEqual({ msixPath: "a.msix" });
  });

  test("rejects zero or multiple positional arguments", () => {
    expect(() => parseArgs([])).toThrow();
    expect(() => parseArgs(["a.msix", "b.msix"])).toThrow();
  });
});

describe("pollUntilSettled", () => {
  test("stops as soon as a terminal status appears, without sleeping past it", async () => {
    const statuses = ["PreProcessing", "Certification", "Release"];
    let calls = 0;
    const sleeps: number[] = [];
    const client = {
      getSubmissionStatus: async () => {
        const status = statuses[calls]!;
        calls += 1;
        return { status };
      },
    };

    const result = await pollUntilSettled(client, "sub-1", {
      maxAttempts: 10,
      intervalMs: 5,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(result).toEqual({ status: "Release", settled: true });
    expect(calls).toBe(3);
    expect(sleeps).toEqual([5, 5]); // Only between polls, never after the terminal one
  });

  test("running out of attempts while still in progress is NOT treated as settled", async () => {
    const client = { getSubmissionStatus: async () => ({ status: "Certification" }) };
    const result = await pollUntilSettled(client, "sub-1", {
      maxAttempts: 3,
      intervalMs: 1,
      sleep: async () => {},
    });
    expect(result).toEqual({ status: "Certification", settled: false });
  });

  test("surfaces errors from a failure status", async () => {
    const client = {
      getSubmissionStatus: async () => ({
        status: "CertificationFailed",
        errors: [{ code: "InvalidPackage" }],
      }),
    };
    const result = await pollUntilSettled(client, "sub-1", { sleep: async () => {} });
    expect(result.settled).toBe(true);
    expect(result.errors).toEqual([{ code: "InvalidPackage" }]);
  });
});

/**
 * A fake StoreClient that records every call it received, for asserting call order/arguments.
 * Logging always happens here, with an override only replacing what a method returns/does beyond
 * that — so a test overriding `getPendingSubmissionId` still shows up in `calls`, matching what the
 * real client would have done.
 */
function fakeClient(overrides: Partial<StoreClient> = {}): {
  client: StoreClient;
  calls: string[];
} {
  const calls: string[] = [];
  const defaults: StoreClient = {
    getPendingSubmissionId: async () => null,
    createSubmission: async () => ({
      id: "sub-1",
      fileUploadUrl: "https://blob.example/upload",
      applicationPackages: [{ fileName: "JxStudio_0.20.0.0_x64.msix", fileStatus: "Published" }],
    }),
    deleteSubmission: async () => {},
    uploadPackageZip: async () => {},
    updateSubmission: async () => {},
    commitSubmission: async () => {},
    getSubmissionStatus: async () => ({ status: "Certification" }),
  };
  const merged = { ...defaults, ...overrides };

  const client: StoreClient = {
    getPendingSubmissionId: async () => {
      calls.push("getPendingSubmissionId");
      return merged.getPendingSubmissionId();
    },
    createSubmission: async () => {
      calls.push("createSubmission");
      return merged.createSubmission();
    },
    deleteSubmission: async (id) => {
      calls.push(`deleteSubmission:${id}`);
      return merged.deleteSubmission(id);
    },
    uploadPackageZip: async (fileUploadUrl, zipPath) => {
      calls.push("uploadPackageZip");
      return merged.uploadPackageZip(fileUploadUrl, zipPath);
    },
    updateSubmission: async (id, applicationPackages) => {
      calls.push(`updateSubmission:${id}`);
      return merged.updateSubmission(id, applicationPackages);
    },
    commitSubmission: async (id) => {
      calls.push(`commitSubmission:${id}`);
      return merged.commitSubmission(id);
    },
    getSubmissionStatus: async (id) => {
      calls.push("getSubmissionStatus");
      return merged.getSubmissionStatus(id);
    },
  };
  return { client, calls };
}

describe("submitToStore", () => {
  let msixPath: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "store-submit-test-"));
    msixPath = join(tmpDir, "JxStudio_5.2.0.0_x64.msix");
    writeFileSync(msixPath, "fake msix bytes");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const noopZip = () => {
    /* The real zipper shells out to `zip`; tests never need a real archive */
  };

  test("refuses to touch a pending submission by default", async () => {
    const { client, calls } = fakeClient({
      getPendingSubmissionId: async () => "sub-existing",
    });

    const outcome = await submitToStore(client, {
      msixPath,
      forceReplacePending: false,
      buildZip: noopZip,
    });

    expect(outcome).toEqual({ kind: "refused-pending-submission" });
    // Nothing past the pending check should have run — this is the guard that protects a submission a human is mid-edit on in Partner Center.
    expect(calls).toEqual(["getPendingSubmissionId"]);
  });

  test("deletes the pending submission only when explicitly told to", async () => {
    const { client, calls } = fakeClient({
      getPendingSubmissionId: async () => "sub-stuck",
    });

    await submitToStore(client, {
      msixPath,
      forceReplacePending: true,
      buildZip: noopZip,
      poll: { maxAttempts: 1, sleep: async () => {} },
    });

    expect(calls[0]).toBe("getPendingSubmissionId");
    expect(calls[1]).toBe("deleteSubmission:sub-stuck");
    expect(calls[2]).toBe("createSubmission");
  });

  test("happy path: create, upload, swap packages, commit, then poll", async () => {
    const { client, calls } = fakeClient();

    const outcome = await submitToStore(client, {
      msixPath,
      forceReplacePending: false,
      buildZip: noopZip,
      poll: { maxAttempts: 1, sleep: async () => {} },
    });

    expect(calls).toEqual([
      "getPendingSubmissionId",
      "createSubmission",
      "uploadPackageZip",
      "updateSubmission:sub-1",
      "commitSubmission:sub-1",
      "getSubmissionStatus",
    ]);
    expect(outcome).toEqual({ kind: "committed", settled: false, status: "Certification" });
  });

  test("passes the swapped package list, not the raw existing one, to updateSubmission", async () => {
    let updatedPackages: unknown;
    const { client } = fakeClient({
      updateSubmission: async (_id, packages) => {
        updatedPackages = packages;
      },
    });

    await submitToStore(client, {
      msixPath,
      forceReplacePending: false,
      buildZip: noopZip,
      poll: { maxAttempts: 1, sleep: async () => {} },
    });

    expect(updatedPackages).toEqual([
      { fileName: "JxStudio_0.20.0.0_x64.msix", fileStatus: "PendingDelete" },
      { fileName: "JxStudio_5.2.0.0_x64.msix", fileStatus: "PendingUpload" },
    ]);
  });

  test("reports a certification failure with its error details, distinctly from success", async () => {
    const { client } = fakeClient({
      getSubmissionStatus: async () => ({
        status: "CertificationFailed",
        errors: [{ code: "InvalidPackage", details: "manifest missing runFullTrust approval" }],
      }),
    });

    const outcome = await submitToStore(client, {
      msixPath,
      forceReplacePending: false,
      buildZip: noopZip,
      poll: { maxAttempts: 1, sleep: async () => {} },
    });

    expect(outcome).toEqual({
      kind: "failed",
      status: "CertificationFailed",
      errors: [{ code: "InvalidPackage", details: "manifest missing runFullTrust approval" }],
    });
  });

  test("rejects a missing msix file before making any network call", async () => {
    const { client, calls } = fakeClient();

    expect(
      submitToStore(client, {
        msixPath: join(tmpDir, "does-not-exist.msix"),
        forceReplacePending: false,
        buildZip: noopZip,
      }),
    ).rejects.toThrow("No such file");
    expect(calls).toEqual([]);
  });
});
