/**
 * Publishes the desktop MSIX to the Microsoft Store, so a `desktop-v*` release stops ending at "a
 * human opens Partner Center and clicks through five pages by hand" (which is how desktop-v5.2.0
 * shipped: `build-msix.yml` already attaches `JxStudio_<version>_x64.msix` to the GitHub release,
 * and this is the step that used to not exist after that).
 *
 * Talks to the Microsoft Store submission API (`manage.devcenter.microsoft.com/v1.0`) directly —
 * there is no first-party GitHub Action for it, and the unofficial ones are unmaintained. The flow
 * mirrors what Partner Center's own UI does for a "new submission from the last one":
 *
 * 1. AAD client-credentials token (`resource=https://manage.devcenter.microsoft.com`, the v1 audience
 *    form the Store API still expects — NOT the v2.0 `scope` form).
 * 2. Refuse to proceed if the app already has a pending submission — see "Never clobbers a submission
 *    in progress" below.
 * 3. Create a submission (Microsoft clones the last PUBLISHED submission's listing, pricing, and age
 *    ratings — this script touches only `applicationPackages`, so a description edited by hand in
 *    Partner Center survives every future automated release).
 * 4. Zip the `.msix` (the upload target wants a zip with the package at its root, exactly like
 *    dragging a file onto the Packages page) and PUT it to the submission's blob SAS URL.
 * 5. Mark every existing package `PendingDelete` and add the new one `PendingUpload`
 *    (`mergePackages`), PUT the updated submission back.
 * 6. Commit, then poll status for a bounded window. Certification can take hours to days (documented,
 *    from experience, in `CLAUDE.md`), so this does not wait for it — it watches only long enough
 *    to catch a same-minute validation failure and then hands off, printing the Partner Center URL
 *    for whoever is on call.
 *
 * ## Soft no-op until the four secrets exist
 *
 * `STORE_TENANT_ID` / `STORE_CLIENT_ID` / `STORE_CLIENT_SECRET` / `STORE_APP_ID` come from an Azure
 * AD app registration wired to the Partner Center account — a one-time manual setup this script
 * cannot do for itself. Until that exists, every one of them is unset in CI, and this exits 0 with
 * a notice rather than reddening every release. See CLAUDE.md's "Microsoft Store Publishing"
 * section for the setup steps and exactly which secret goes where.
 *
 * ## Never clobbers a submission in progress
 *
 * The Store API allows exactly one open submission per app; creating a new one when one is already
 * pending is a 409 until the old one is deleted or committed. So the obvious CI move is "delete
 * whatever's pending, then create ours" — and that is _destructive by default_ toward a submission
 * a human is mid-edit on in the Partner Center UI, which is exactly the state this repository was
 * in when this script was written (desktop-v5.2.0, submitted by hand, was still in certification).
 * Default behaviour is therefore to fail loudly and change nothing when a pending submission
 * already exists; `FORCE_REPLACE_PENDING=true` is the explicit, human-typed opt-in for the one case
 * where deleting it is actually intended (e.g. a stuck submission from a previous failed run).
 *
 *     bun scripts/store-submit.ts <path-to-msix>
 *     FORCE_REPLACE_PENDING=true bun scripts/store-submit.ts <path-to-msix>
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API_ROOT = "https://manage.devcenter.microsoft.com/v1.0/my";
const TOKEN_RESOURCE = "https://manage.devcenter.microsoft.com";

export interface StoreCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  appId: string;
}

/** Which of the four required env vars this run is missing, if any. */
export function missingCredentials(env: Record<string, string | undefined>): string[] {
  const required = ["STORE_TENANT_ID", "STORE_CLIENT_ID", "STORE_CLIENT_SECRET", "STORE_APP_ID"];
  return required.filter((key) => !env[key]);
}

export function readCredentials(env: Record<string, string | undefined>): StoreCredentials | null {
  if (missingCredentials(env).length > 0) {
    return null;
  }
  return {
    tenantId: env.STORE_TENANT_ID!,
    clientId: env.STORE_CLIENT_ID!,
    clientSecret: env.STORE_CLIENT_SECRET!,
    appId: env.STORE_APP_ID!,
  };
}

export interface PackageEntry {
  fileName: string;
  fileStatus?: string;
  [key: string]: unknown;
}

/**
 * What a submission's `applicationPackages` should look like after swapping in a new file: every
 * existing entry other than the new one marked for deletion, plus the new one queued to upload.
 * Pure so the swap logic is tested without a live submission — this is the one part of the flow
 * that decides what actually changes in the Store listing.
 */
export function mergePackages(existing: PackageEntry[], newFileName: string): PackageEntry[] {
  const kept: PackageEntry[] = [];
  for (const pkg of existing) {
    if (pkg.fileName === newFileName) {
      continue;
    }
    kept.push({ ...pkg, fileStatus: "PendingDelete" });
  }
  kept.push({ fileName: newFileName, fileStatus: "PendingUpload" });
  return kept;
}

/** Submission status values that mean the automated part of the job is over, one way or another. */
export function isTerminalStatus(status: string): boolean {
  return status.endsWith("Failed") || status === "Release" || status === "Published";
}

export function isFailureStatus(status: string): boolean {
  return status.endsWith("Failed");
}

export function parseArgs(argv: string[]): { msixPath: string } {
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  if (positional.length !== 1) {
    throw new Error(
      `Expected exactly one argument (path to the .msix file), got ${positional.length}: ${JSON.stringify(positional)}`,
    );
  }
  return { msixPath: positional[0]! };
}

export interface StoreClient {
  getPendingSubmissionId: () => Promise<string | null>;
  createSubmission: () => Promise<{
    id: string;
    fileUploadUrl: string;
    applicationPackages: PackageEntry[];
  }>;
  deleteSubmission: (id: string) => Promise<void>;
  uploadPackageZip: (fileUploadUrl: string, zipPath: string) => Promise<void>;
  updateSubmission: (id: string, applicationPackages: PackageEntry[]) => Promise<void>;
  commitSubmission: (id: string) => Promise<void>;
  getSubmissionStatus: (id: string) => Promise<{ status: string; errors?: unknown }>;
}

/**
 * Builds a zip with `msixPath` at its root — what the Store upload endpoint expects, matching a
 * manual "browse your files" upload of a single package. Shells out to `zip` (present on every
 * GitHub-hosted runner) rather than hand-rolling the zip format for one file.
 */
export function buildPackageZip(msixPath: string, destZipPath: string): void {
  const result = Bun.spawnSync(["zip", "-j", destZipPath, msixPath]);
  if (result.exitCode !== 0) {
    throw new Error(`zip exited ${result.exitCode}: ${new TextDecoder().decode(result.stderr)}`);
  }
}

export interface PollOptions {
  /** Total attempts before giving up and handing off (default 10). */
  maxAttempts?: number;
  /** Delay between polls, ms (default 30_000). */
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Polls status until it becomes terminal or the attempt budget runs out — whichever first. Running
 * out of attempts is NOT a failure: certification legitimately takes hours to days, so "still in
 * progress" after the poll window is the expected, successful outcome for most releases.
 */
export async function pollUntilSettled(
  client: Pick<StoreClient, "getSubmissionStatus">,
  submissionId: string,
  { maxAttempts = 10, intervalMs = 30_000, sleep = (ms) => Bun.sleep(ms) }: PollOptions = {},
): Promise<{ status: string; errors?: unknown; settled: boolean }> {
  let last = { status: "CommitStarted", errors: undefined as unknown };
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    last = await client.getSubmissionStatus(submissionId);
    if (isTerminalStatus(last.status)) {
      return { ...last, settled: true };
    }
    if (attempt < maxAttempts - 1) {
      await sleep(intervalMs);
    }
  }
  return { ...last, settled: false };
}

export interface SubmitOptions {
  msixPath: string;
  forceReplacePending: boolean;
  buildZip?: typeof buildPackageZip;
  poll?: PollOptions;
}

export type SubmitOutcome =
  | { kind: "refused-pending-submission" }
  | { kind: "failed"; status: string; errors?: unknown }
  | { kind: "committed"; settled: boolean; status: string };

/**
 * The whole flow, with the network client injected so it is testable without a live Partner Center
 * account. `store-submit.ts`'s CLI entry point supplies the real `fetch`-backed client; tests
 * supply a fake one and assert on the calls it recorded.
 */
export async function submitToStore(
  client: StoreClient,
  { msixPath, forceReplacePending, buildZip = buildPackageZip, poll }: SubmitOptions,
): Promise<SubmitOutcome> {
  if (!existsSync(msixPath)) {
    throw new Error(`No such file: ${msixPath}`);
  }

  const pendingId = await client.getPendingSubmissionId();
  if (pendingId && !forceReplacePending) {
    return { kind: "refused-pending-submission" };
  }
  if (pendingId && forceReplacePending) {
    await client.deleteSubmission(pendingId);
  }

  const submission = await client.createSubmission();
  const fileName = msixPath.split("/").pop()!.split("\\").pop()!;

  const tmpDir = mkdtempSync(join(tmpdir(), "store-submit-"));
  const zipPath = join(tmpDir, "package.zip");
  try {
    buildZip(msixPath, zipPath);
    await client.uploadPackageZip(submission.fileUploadUrl, zipPath);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  const packages = mergePackages(submission.applicationPackages, fileName);
  await client.updateSubmission(submission.id, packages);
  await client.commitSubmission(submission.id);

  const result = await pollUntilSettled(client, submission.id, poll);
  if (isFailureStatus(result.status)) {
    return { kind: "failed", status: result.status, errors: result.errors };
  }
  return { kind: "committed", settled: result.settled, status: result.status };
}

/** The real client: talks to `manage.devcenter.microsoft.com` with an AAD client-credentials token. */
export function createLiveClient(creds: StoreCredentials): StoreClient {
  let token: string | null = null;

  async function getToken(): Promise<string> {
    if (token) {
      return token;
    }
    const res = await fetch(`https://login.microsoftonline.com/${creds.tenantId}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        resource: TOKEN_RESOURCE,
      }),
    });
    if (!res.ok) {
      throw new Error(`AAD token request failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { access_token: string };
    token = body.access_token;
    return token;
  }

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const accessToken = await getToken();
    const res = await fetch(`${API_ROOT}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (!res.ok) {
      throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}: ${await res.text()}`);
    }
    return res;
  }

  return {
    async getPendingSubmissionId() {
      const res = await call(`/applications/${creds.appId}`);
      const app = (await res.json()) as { pendingApplicationSubmission?: { id: string } };
      return app.pendingApplicationSubmission?.id ?? null;
    },

    async deleteSubmission(id) {
      await call(`/applications/${creds.appId}/submissions/${id}`, { method: "DELETE" });
    },

    async createSubmission() {
      const res = await call(`/applications/${creds.appId}/submissions`, { method: "POST" });
      return (await res.json()) as {
        id: string;
        fileUploadUrl: string;
        applicationPackages: PackageEntry[];
      };
    },

    async uploadPackageZip(fileUploadUrl, zipPath) {
      const body = await Bun.file(zipPath).arrayBuffer();
      const res = await fetch(fileUploadUrl, {
        method: "PUT",
        headers: { "x-ms-blob-type": "BlockBlob" },
        body,
      });
      if (!res.ok) {
        throw new Error(`Package upload failed: ${res.status} ${await res.text()}`);
      }
    },

    async updateSubmission(id, applicationPackages) {
      await call(`/applications/${creds.appId}/submissions/${id}`, {
        method: "PUT",
        body: JSON.stringify({ applicationPackages }),
      });
    },

    async commitSubmission(id) {
      await call(`/applications/${creds.appId}/submissions/${id}/commit`, { method: "POST" });
    },

    async getSubmissionStatus(id) {
      const res = await call(`/applications/${creds.appId}/submissions/${id}/status`);
      return (await res.json()) as { status: string; errors?: unknown };
    },
  };
}

if (import.meta.main) {
  const missing = missingCredentials(Bun.env);
  if (missing.length > 0) {
    console.log(
      `Microsoft Store credentials not configured (missing ${missing.join(", ")}); skipping ` +
        'automatic Store submission. See CLAUDE.md\'s "Microsoft Store Publishing" section.',
    );
    process.exit(0);
  }

  const { msixPath } = parseArgs(Bun.argv.slice(2));
  const creds = readCredentials(Bun.env)!;
  const client = createLiveClient(creds);
  const forceReplacePending = Bun.env.FORCE_REPLACE_PENDING === "true";

  const outcome = await submitToStore(client, { msixPath, forceReplacePending });

  switch (outcome.kind) {
    case "refused-pending-submission": {
      console.error(
        "A submission is already pending in Partner Center. Refusing to touch it — check " +
          "https://partner.microsoft.com and either commit/discard it by hand, or re-run with " +
          "FORCE_REPLACE_PENDING=true once you're sure it's safe to delete.",
      );
      process.exit(1);
      break;
    }
    case "failed": {
      console.error(
        `Submission failed at status ${outcome.status}:`,
        outcome.errors ?? "(no details)",
      );
      process.exit(1);
      break;
    }
    case "committed": {
      if (outcome.settled) {
        console.log(`Submission reached ${outcome.status}.`);
      } else {
        console.log(
          `Submission committed and still in progress (${outcome.status}) after the poll window. ` +
            "Certification can take hours to days — check Partner Center for the final result.",
        );
      }
      break;
    }
    default: {
      const exhaustive: never = outcome;
      throw new Error(`Unhandled outcome: ${JSON.stringify(exhaustive)}`);
    }
  }
}
