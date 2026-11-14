/**
 * Submits the Mac App Store build that `mas-publish.yml` just uploaded to App Review, so a desktop
 * release reaches the store the way a Windows release reaches the Microsoft Store
 * (`store-publish.yml`) and an Ubuntu one the Snap Store (`snap-publish.ts`): with nothing left for
 * a person to click.
 *
 * `altool` uploads the package and stops there; the build then processes for a few minutes, and
 * only a build that has processed can be attached to a version. Apple's own client has no verb for
 * the rest, so this speaks the App Store Connect API directly (JWT, ES256, the same API key the
 * upload uses). The steps are the ones a person takes in the console:
 *
 * 1. Wait for the build (`version` and build number) to finish processing.
 * 2. Take the app's editable version, renaming it to this release if it carries another number (a
 *    rejected version keeps its record, and there can be only one), or create it.
 * 3. Attach the build, and fill in "What's New" where it is empty.
 * 4. Add the version to a review submission and submit it.
 *
 * What the script adds to that is policy:
 *
 * - **A re-run is not an error.** A version already waiting, in review or live is the work done.
 * - **A version already in flight is not a failure either.** Apple allows one at a time, so when a
 *   different version is waiting or in review the build stays in TestFlight, a warning says so, and
 *   the next release carries on from there.
 * - **It never answers for the build's export compliance.** That is the build's own declaration
 *   (`ITSAppUsesNonExemptEncryption` in `electron-builder.yml`); a processed build that still has
 *   no answer fails here, naming it, rather than being declared on the person's behalf.
 *
 *   bun scripts/mas-submit.ts --build <number> [--version <x.y.z>] [--release-type
 *   MANUAL|AFTER_APPROVAL] [--whats-new <text>]
 *
 * Credentials come from the environment: `APPLE_API_KEY_ID`, `APPLE_API_ISSUER_ID`, and the key
 * itself at `APPLE_API_KEY_PATH` (default `~/.appstoreconnect/private_keys/AuthKey_<id>.p8`, where
 * `mas-publish.yml` writes it).
 */

import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { CliReport } from "./lib/cli-report.ts";

export const API_ORIGIN = "https://api.appstoreconnect.apple.com";
export const BUNDLE_ID = "com.jxsuite.studio";
export const DEFAULT_WHATS_NEW = "Bug fixes and improvements.";
const PLATFORM = "MAC_OS";

export type ReleaseType = "MANUAL" | "AFTER_APPROVAL";

/** States in which a version can still be edited and (re)submitted. */
const EDITABLE_STATES = new Set([
  "PREPARE_FOR_SUBMISSION",
  "READY_FOR_REVIEW",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "INVALID_BINARY",
  "WAITING_FOR_EXPORT_COMPLIANCE",
]);
/** States in which a version is with Apple, or waiting for the person to release it. */
const IN_FLIGHT_STATES = new Set([
  "WAITING_FOR_REVIEW",
  "IN_REVIEW",
  "PROCESSING_FOR_APP_STORE",
  "PENDING_APPLE_RELEASE",
  "PENDING_DEVELOPER_RELEASE",
]);

export class AscError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AscError";
    this.status = status;
  }
}

/** A JSON:API request body, as App Store Connect takes one. */
export interface AscDocument {
  data: {
    attributes?: Record<string, string | boolean>;
    id?: string;
    relationships?: Record<string, { data: { id: string; type: string } }>;
    type: string;
  };
}

/**
 * The API, injected so the policy is testable without an Apple account. `T` is the JSON:API
 * document Apple documents for the endpoint asked, and the one place it is taken on trust is the
 * real client below.
 */
export interface AscClient {
  request: <T>(method: "GET" | "POST" | "PATCH", path: string, body?: AscDocument) => Promise<T>;
}

interface Resource<A> {
  attributes: A;
  id: string;
}
interface Collection<A> {
  data: Resource<A>[];
}
interface Single<A> {
  data: Resource<A>;
}

interface BuildAttributes {
  expired: boolean;
  processingState: string;
  usesNonExemptEncryption: boolean | null;
  version: string;
}
interface VersionAttributes {
  appStoreState: string;
  releaseType: string | null;
  versionString: string;
}
interface LocalizationAttributes {
  locale: string;
  whatsNew: string | null;
}
interface SubmissionAttributes {
  state: string;
}

interface JwtHeader {
  alg: "ES256";
  kid: string;
  typ: "JWT";
}
interface JwtClaims {
  aud: "appstoreconnect-v1";
  exp: number;
  iat: number;
  iss: string;
}

/** An App Store Connect JWT: ES256, valid for ten minutes (Apple allows twenty). */
export function createToken(options: {
  issuerId: string;
  keyId: string;
  now: Date;
  privateKey: string;
}): string {
  const issuedAt = Math.floor(options.now.getTime() / 1000);
  const encode = (value: JwtHeader | JwtClaims) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const signingInput = `${encode({ alg: "ES256", kid: options.keyId, typ: "JWT" })}.${encode({
    aud: "appstoreconnect-v1",
    exp: issuedAt + 600,
    iat: issuedAt,
    iss: options.issuerId,
  })}`;
  // JWT wants the raw r||s signature, not the DER encoding Node produces by default.
  const signature = sign("sha256", Buffer.from(signingInput), {
    dsaEncoding: "ieee-p1363",
    key: createPrivateKey(options.privateKey),
  });
  return `${signingInput}.${signature.toString("base64url")}`;
}

/** The one call the real client makes, named so a test can stand in for it without all of `fetch`. */
export type AscFetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * The real client: `fetch` with a fresh token per request, since a build can take longer to process
 * than a token lives.
 */
export function createClient(options: {
  fetch?: AscFetch;
  issuerId: string;
  keyId: string;
  now?: () => Date;
  privateKey: string;
}): AscClient {
  const doFetch: AscFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => new Date());
  return {
    async request(method, path, body) {
      const token = createToken({
        issuerId: options.issuerId,
        keyId: options.keyId,
        now: now(),
        privateKey: options.privateKey,
      });
      const headers = new Headers({ authorization: `Bearer ${token}` });
      const init: RequestInit = { headers, method };
      if (body !== undefined) {
        headers.set("content-type", "application/json");
        init.body = JSON.stringify(body);
      }
      const response = await doFetch(`${API_ORIGIN}${path}`, init);
      const text = await response.text();
      if (!response.ok) {
        throw new AscError(response.status, describeFailure(method, path, response.status, text));
      }
      /* SAFETY: the response is the JSON:API document Apple documents for this endpoint, which the
       * caller named as `T`; a field it reads that the document lacks is handled where it is read. */
      // A 204 (attaching the build, submitting) has no body.
      return JSON.parse(text === "" ? "{}" : text) as never;
    },
  };
}

/**
 * Apple's error documents carry a `detail` per problem; the status alone never says which item is
 * missing.
 */
function describeFailure(method: string, path: string, status: number, text: string): string {
  let detail = text.slice(0, 500);
  try {
    // SAFETY: Apple's error body, `{ errors: [{ title, detail }] }`; anything else falls to the raw text.
    const parsed = JSON.parse(text) as { errors?: { detail?: string; title?: string }[] };
    const lines = (parsed.errors ?? []).map((error) => error.detail ?? error.title ?? "");
    if (lines.some(Boolean)) {
      detail = lines.filter(Boolean).join("; ");
    }
  } catch {
    // Not JSON: the raw text stands.
  }
  return `${method} ${path} -> ${status}: ${detail}`;
}

export interface SubmitOptions {
  buildNumber: string;
  /** How often the build is looked up while it processes. */
  intervalMs?: number;
  releaseType: ReleaseType;
  /** Injected so a test does not wait. */
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for the build to process before giving up. */
  timeoutMs?: number;
  version: string;
  whatsNew: string;
}

async function list<A>(client: AscClient, path: string): Promise<Resource<A>[]> {
  const response = await client.request<Collection<A>>("GET", path);
  return response.data;
}

async function create<A>(client: AscClient, path: string, body: AscDocument): Promise<Resource<A>> {
  const response = await client.request<Single<A>>("POST", path, body);
  return response.data;
}

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** Wait for `version (buildNumber)` to reach the API and finish processing. */
export async function waitForBuild(
  client: AscClient,
  appId: string,
  options: Pick<SubmitOptions, "buildNumber" | "intervalMs" | "sleep" | "timeoutMs" | "version">,
): Promise<Resource<BuildAttributes>> {
  const interval = options.intervalMs ?? 30_000;
  const sleep = options.sleep ?? realSleep;
  const deadline = (options.timeoutMs ?? 45 * 60_000) / interval;
  const query = new URLSearchParams({
    "filter[app]": appId,
    "filter[preReleaseVersion.platform]": PLATFORM,
    "filter[preReleaseVersion.version]": options.version,
    "filter[version]": options.buildNumber,
    limit: "1",
  });
  for (let attempt = 0; attempt <= deadline; attempt += 1) {
    const [build] = await list<BuildAttributes>(client, `/v1/builds?${query}`);
    if (build) {
      const { processingState } = build.attributes;
      if (processingState === "VALID") {
        return build;
      }
      if (processingState !== "PROCESSING") {
        throw new Error(
          `Build ${options.version} (${options.buildNumber}) is ${processingState}; App Store ` +
            `Connect will not accept it, and the email it sent says why.`,
        );
      }
    }
    await sleep(interval);
  }
  throw new Error(
    `Build ${options.version} (${options.buildNumber}) was still not processed after ` +
      `${Math.round((options.timeoutMs ?? 45 * 60_000) / 60_000)} minutes.`,
  );
}

type VersionOutcome =
  | { kind: "ready"; created: boolean; id: string; renamedFrom: string | null }
  | { kind: "done"; state: string }
  | { kind: "blocked"; state: string; versionString: string };

/** The version this release goes in: the one already there, the editable one renamed, or a new one. */
async function ensureVersion(
  client: AscClient,
  appId: string,
  options: Pick<SubmitOptions, "releaseType" | "version">,
): Promise<VersionOutcome> {
  const query = new URLSearchParams({ "filter[platform]": PLATFORM, limit: "50" });
  const versions = await list<VersionAttributes>(
    client,
    `/v1/apps/${appId}/appStoreVersions?${query}`,
  );

  const same = versions.find((entry) => entry.attributes.versionString === options.version);
  if (same && !EDITABLE_STATES.has(same.attributes.appStoreState)) {
    return { kind: "done", state: same.attributes.appStoreState };
  }
  const blocker = versions.find((entry) => IN_FLIGHT_STATES.has(entry.attributes.appStoreState));
  if (blocker) {
    return {
      kind: "blocked",
      state: blocker.attributes.appStoreState,
      versionString: blocker.attributes.versionString,
    };
  }
  const editable =
    same ?? versions.find((entry) => EDITABLE_STATES.has(entry.attributes.appStoreState));
  if (editable) {
    const previous = editable.attributes.versionString;
    if (previous !== options.version) {
      await client.request("PATCH", `/v1/appStoreVersions/${editable.id}`, {
        data: {
          attributes: { versionString: options.version },
          id: editable.id,
          type: "appStoreVersions",
        },
      });
    }
    return {
      created: false,
      id: editable.id,
      kind: "ready",
      renamedFrom: previous === options.version ? null : previous,
    };
  }
  const created = await create<VersionAttributes>(client, "/v1/appStoreVersions", {
    data: {
      attributes: {
        platform: PLATFORM,
        releaseType: options.releaseType,
        versionString: options.version,
      },
      relationships: { app: { data: { id: appId, type: "apps" } } },
      type: "appStoreVersions",
    },
  });
  return { created: true, id: created.id, kind: "ready", renamedFrom: null };
}

/** "What's New" is required on an update, and is not copied from the version before it. */
async function fillWhatsNew(client: AscClient, versionId: string, text: string): Promise<number> {
  const localizations = await list<LocalizationAttributes>(
    client,
    `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`,
  );
  let filled = 0;
  for (const localization of localizations) {
    if (!localization.attributes.whatsNew) {
      await client.request("PATCH", `/v1/appStoreVersionLocalizations/${localization.id}`, {
        data: {
          attributes: { whatsNew: text },
          id: localization.id,
          type: "appStoreVersionLocalizations",
        },
      });
      filled += 1;
    }
  }
  return filled;
}

/** A draft submission left by an earlier run is reused; a second would be refused. */
async function openSubmission(client: AscClient, appId: string): Promise<string> {
  const query = new URLSearchParams({
    "filter[platform]": PLATFORM,
    "filter[state]": "READY_FOR_REVIEW",
  });
  const [draft] = await list<SubmissionAttributes>(
    client,
    `/v1/apps/${appId}/reviewSubmissions?${query}`,
  );
  if (draft) {
    return draft.id;
  }
  const created = await create<SubmissionAttributes>(client, "/v1/reviewSubmissions", {
    data: {
      attributes: { platform: PLATFORM },
      relationships: { app: { data: { id: appId, type: "apps" } } },
      type: "reviewSubmissions",
    },
  });
  return created.id;
}

/**
 * Attach the uploaded build to the release's version and submit it to App Review.
 *
 * Throws on an API failure or a build that cannot be submitted; returns the notices for what was
 * done and for the cases that are not failures.
 */
export async function submitToReview(
  client: AscClient,
  options: SubmitOptions,
): Promise<CliReport> {
  const label = `${options.version} (${options.buildNumber})`;
  const lines: string[] = [];

  const [app] = await list<{ bundleId: string }>(
    client,
    `/v1/apps?${new URLSearchParams({ "filter[bundleId]": BUNDLE_ID })}`,
  );
  if (!app) {
    throw new Error(`The API key sees no app with the bundle ID ${BUNDLE_ID}.`);
  }

  const build = await waitForBuild(client, app.id, options);
  if (build.attributes.expired) {
    throw new Error(`Build ${label} has expired and cannot be submitted.`);
  }
  if (build.attributes.usesNonExemptEncryption === null) {
    throw new Error(
      `Build ${label} has no export compliance answer. The build declares it itself: set ` +
        `ITSAppUsesNonExemptEncryption in electron-builder.yml (packages/desktop/AGENTS.md, ` +
        `"Mac App Store Publishing"), or answer it for this build in App Store Connect.`,
    );
  }

  const version = await ensureVersion(client, app.id, options);
  if (version.kind === "done") {
    lines.push(`Version ${options.version} is already ${version.state}; nothing to submit.`);
    return { failed: false, lines };
  }
  if (version.kind === "blocked") {
    lines.push(
      `::warning::Build ${label} is processed and in TestFlight, but version ${version.versionString} ` +
        `is ${version.state}, and the store takes one version at a time. Submit ${options.version} ` +
        `from App Store Connect once that one is out of review.`,
    );
    return { failed: false, lines };
  }
  lines.push(
    version.created
      ? `Created version ${options.version} (${options.releaseType}).`
      : version.renamedFrom === null
        ? `Using version ${options.version}.`
        : `Renamed version ${version.renamedFrom} to ${options.version}.`,
  );

  await client.request("PATCH", `/v1/appStoreVersions/${version.id}/relationships/build`, {
    data: { id: build.id, type: "builds" },
  });
  lines.push(`Attached build ${label}.`);

  const filled = await fillWhatsNew(client, version.id, options.whatsNew);
  if (filled > 0) {
    lines.push(`Set "What's New" for ${filled} localization(s).`);
  }

  const submissionId = await openSubmission(client, app.id);
  await client.request("POST", "/v1/reviewSubmissionItems", {
    data: {
      relationships: {
        appStoreVersion: { data: { id: version.id, type: "appStoreVersions" } },
        reviewSubmission: { data: { id: submissionId, type: "reviewSubmissions" } },
      },
      type: "reviewSubmissionItems",
    },
  });
  await client.request("PATCH", `/v1/reviewSubmissions/${submissionId}`, {
    data: { attributes: { submitted: true }, id: submissionId, type: "reviewSubmissions" },
  });
  lines.push(`Submitted ${label} to App Review.`);
  return { failed: false, lines };
}

export interface Args {
  buildNumber: string;
  releaseType: ReleaseType;
  version: string | null;
  whatsNew: string;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    buildNumber: "",
    releaseType: "MANUAL",
    version: null,
    whatsNew: DEFAULT_WHATS_NEW,
  };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} needs a value`);
    }
    switch (flag) {
      case "--build": {
        args.buildNumber = value;
        break;
      }
      case "--version": {
        args.version = value;
        break;
      }
      case "--release-type": {
        if (value !== "MANUAL" && value !== "AFTER_APPROVAL") {
          throw new Error(
            `--release-type is MANUAL or AFTER_APPROVAL, not ${JSON.stringify(value)}`,
          );
        }
        args.releaseType = value;
        break;
      }
      case "--whats-new": {
        args.whatsNew = value;
        break;
      }
      default: {
        throw new Error(`Unknown option: ${flag}`);
      }
    }
  }
  if (!/^\d+$/.test(args.buildNumber)) {
    throw new Error("--build <number> is required, and is the build number the upload carried");
  }
  return args;
}

if (import.meta.main) {
  const keyId = Bun.env.APPLE_API_KEY_ID;
  const issuerId = Bun.env.APPLE_API_ISSUER_ID;
  if (!keyId || !issuerId) {
    console.log(
      "App Store Connect credentials not configured (APPLE_API_KEY_ID, APPLE_API_ISSUER_ID); " +
        "nothing to submit.",
    );
    process.exit(0);
  }
  const args = parseArgs(Bun.argv.slice(2));
  const keyPath =
    Bun.env.APPLE_API_KEY_PATH ??
    join(homedir(), ".appstoreconnect/private_keys", `AuthKey_${keyId}.p8`);
  const version =
    args.version ??
    // SAFETY: the desktop package's own manifest, whose `version` electron-builder stamps into the app.
    (
      JSON.parse(
        readFileSync(join(import.meta.dir, "../packages/desktop/package.json"), "utf8"),
      ) as {
        version: string;
      }
    ).version;
  const client = createClient({ issuerId, keyId, privateKey: readFileSync(keyPath, "utf8") });
  const report = await submitToReview(client, {
    buildNumber: args.buildNumber,
    releaseType: args.releaseType,
    version,
    whatsNew: args.whatsNew,
  }).catch((error: Error): CliReport => ({ failed: true, lines: [`::error::${error.message}`] }));
  for (const line of report.lines) {
    console.log(line);
  }
  process.exit(report.failed ? 1 : 0);
}
