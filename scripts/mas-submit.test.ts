/**
 * `scripts/mas-submit.ts` against a fake App Store Connect: an in-memory store of the app's
 * versions, builds and submissions that answers the endpoints the script uses, so each test is one
 * state Apple can be in and the assertion is which calls the script then makes.
 */

import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, verify } from "node:crypto";

import type { AscClient, AscDocument, AscFetch, SubmitOptions } from "./mas-submit.ts";
import {
  API_ORIGIN,
  AscError,
  createClient,
  createToken,
  parseArgs,
  submitToReview,
  waitForBuild,
} from "./mas-submit.ts";

interface FakeVersion {
  id: string;
  state: string;
  versionString: string;
  /** One entry per localization: its "What's New", or null when it is empty. */
  whatsNew: (string | null)[];
}

interface FakeResource {
  attributes: Record<string, string | boolean | null>;
  id: string;
}
interface FakeDocument {
  data?: FakeResource | FakeResource[];
}

interface FakeAscState {
  app: boolean;
  attached: string | null;
  bodies: Record<string, AscDocument | undefined>;
  /** The processing states a build reports on successive lookups; the last one repeats. */
  buildStates: string[];
  /** Calls the script made, as `METHOD path`. */
  calls: string[];
  drafts: string[];
  encryption: boolean | null;
  expired: boolean;
  submitted: boolean;
  versions: FakeVersion[];
}

/** Resolve the document the script asked for; the generic is the script's own claim about it. */
function reply<T>(document: FakeDocument): Promise<T> {
  /* SAFETY: each document below is the shape of the endpoint it answers, which the script names as
   * `T` at the call; the fake is the only place that claim is not checked by Apple. */
  return Promise.resolve(document as never);
}

function fakeAsc(overrides: Partial<FakeAscState> = {}) {
  const state: FakeAscState = {
    app: true,
    attached: null,
    bodies: {},
    buildStates: ["VALID"],
    calls: [],
    drafts: [],
    encryption: false,
    expired: false,
    submitted: false,
    versions: [],
    ...overrides,
  };
  let lookups = 0;
  const client: AscClient = {
    request<T>(method: string, path: string, body?: AscDocument): Promise<T> {
      const route = path.split("?")[0] ?? path;
      state.calls.push(`${method} ${route}`);
      state.bodies[`${method} ${route}`] = body;
      if (route === "/v1/apps") {
        return reply({
          data: state.app ? [{ attributes: { bundleId: "com.jxsuite.studio" }, id: "app1" }] : [],
        });
      }
      if (route === "/v1/builds") {
        const index = Math.min(lookups, state.buildStates.length - 1);
        lookups += 1;
        return reply({
          data: [
            {
              attributes: {
                expired: state.expired,
                processingState: state.buildStates[index] ?? "VALID",
                usesNonExemptEncryption: state.encryption,
                version: "500",
              },
              id: "build1",
            },
          ],
        });
      }
      if (route === "/v1/apps/app1/appStoreVersions") {
        return reply({
          data: state.versions.map((entry) => ({
            attributes: { appStoreState: entry.state, versionString: entry.versionString },
            id: entry.id,
          })),
        });
      }
      if (method === "POST" && route === "/v1/appStoreVersions") {
        state.versions.push({
          id: "v-new",
          state: "PREPARE_FOR_SUBMISSION",
          versionString: "x",
          whatsNew: [null],
        });
        return reply({ data: { attributes: {}, id: "v-new" } });
      }
      if (route.endsWith("/relationships/build")) {
        state.attached = body?.data.id ?? null;
        return reply({});
      }
      const localizations = /^\/v1\/appStoreVersions\/([^/]+)\/appStoreVersionLocalizations$/.exec(
        route,
      );
      if (localizations) {
        const target = state.versions.find((entry) => entry.id === localizations[1]);
        return reply({
          data: (target?.whatsNew ?? []).map((whatsNew, index) => ({
            attributes: { locale: "en-US", whatsNew },
            id: `loc${index}`,
          })),
        });
      }
      if (route === "/v1/apps/app1/reviewSubmissions") {
        return reply({ data: state.drafts.map((id) => ({ attributes: {}, id })) });
      }
      if (method === "POST" && route === "/v1/reviewSubmissions") {
        return reply({ data: { attributes: {}, id: "sub-new" } });
      }
      if (method === "PATCH" && route.startsWith("/v1/reviewSubmissions/")) {
        state.submitted = true;
      }
      return reply({});
    },
  };
  return { client, state };
}

const OPTIONS = {
  buildNumber: "500",
  releaseType: "MANUAL",
  sleep: () => Promise.resolve(),
  version: "8.0.2",
  whatsNew: "Fixes.",
} satisfies SubmitOptions;

/**
 * What a promise rejected with, or null when it resolved: `await expect(...).rejects` is not
 * awaitable under the types.
 */
const rejection = (promise: Promise<unknown>): Promise<Error | null> =>
  promise.then(
    () => null,
    (error: Error) => error,
  );

describe("submitToReview", () => {
  test("creates the version, attaches the build and submits it", async () => {
    const { client, state } = fakeAsc();
    const report = await submitToReview(client, OPTIONS);

    expect(report.failed).toBe(false);
    expect(report.lines.at(-1)).toBe("Submitted 8.0.2 (500) to App Review.");
    expect(state.calls).toContain("POST /v1/appStoreVersions");
    expect(state.bodies["POST /v1/appStoreVersions"]?.data.attributes).toEqual({
      platform: "MAC_OS",
      releaseType: "MANUAL",
      versionString: "8.0.2",
    });
    expect(state.attached).toBe("build1");
    expect(state.calls).toContain("POST /v1/reviewSubmissionItems");
    expect(state.submitted).toBe(true);
  });

  test("renames the editable version of an earlier number instead of creating a second", async () => {
    const { client, state } = fakeAsc({
      versions: [
        { id: "v-old", state: "REJECTED", versionString: "8.0.1", whatsNew: [null] },
        { id: "v-live", state: "READY_FOR_SALE", versionString: "8.0.0", whatsNew: ["Live"] },
      ],
    });
    const report = await submitToReview(client, OPTIONS);

    expect(report.lines).toContain("Renamed version 8.0.1 to 8.0.2.");
    expect(state.calls).not.toContain("POST /v1/appStoreVersions");
    expect(state.bodies["PATCH /v1/appStoreVersions/v-old"]?.data.attributes).toEqual({
      versionString: "8.0.2",
    });
    expect(state.submitted).toBe(true);
  });

  test("fills What's New only where it is empty", async () => {
    const { client, state } = fakeAsc({
      versions: [
        {
          id: "v1",
          state: "PREPARE_FOR_SUBMISSION",
          versionString: "8.0.2",
          whatsNew: [null, "Kept"],
        },
      ],
    });
    const report = await submitToReview(client, OPTIONS);

    expect(report.lines).toContain('Set "What\'s New" for 1 localization(s).');
    expect(state.bodies["PATCH /v1/appStoreVersionLocalizations/loc0"]?.data.attributes).toEqual({
      whatsNew: "Fixes.",
    });
    expect(state.calls).not.toContain("PATCH /v1/appStoreVersionLocalizations/loc1");
  });

  test("reuses a draft review submission rather than opening a second", async () => {
    const { client, state } = fakeAsc({ drafts: ["sub-draft"] });
    await submitToReview(client, OPTIONS);

    expect(state.calls).not.toContain("POST /v1/reviewSubmissions");
    expect(state.calls).toContain("PATCH /v1/reviewSubmissions/sub-draft");
  });

  test.each(["WAITING_FOR_REVIEW", "IN_REVIEW", "READY_FOR_SALE", "PENDING_DEVELOPER_RELEASE"])(
    "a version that is already %s is the work done",
    async (appStoreState) => {
      const { client, state } = fakeAsc({
        versions: [{ id: "v1", state: appStoreState, versionString: "8.0.2", whatsNew: ["x"] }],
      });
      const report = await submitToReview(client, OPTIONS);

      expect(report.failed).toBe(false);
      expect(report.lines).toEqual([
        `Version 8.0.2 is already ${appStoreState}; nothing to submit.`,
      ]);
      expect(state.attached).toBeNull();
      expect(state.submitted).toBe(false);
    },
  );

  test("a different version in review leaves the build in TestFlight with a warning, not a failure", async () => {
    const { client, state } = fakeAsc({
      versions: [{ id: "v1", state: "IN_REVIEW", versionString: "8.0.1", whatsNew: ["x"] }],
    });
    const report = await submitToReview(client, OPTIONS);

    expect(report.failed).toBe(false);
    expect(report.lines[0]).toStartWith(
      "::warning::Build 8.0.2 (500) is processed and in TestFlight",
    );
    expect(report.lines[0]).toContain("8.0.1 is IN_REVIEW");
    expect(state.calls).not.toContain("POST /v1/appStoreVersions");
    expect(state.submitted).toBe(false);
  });

  test("waits for a build that is still processing", async () => {
    const { client } = fakeAsc({ buildStates: ["PROCESSING", "PROCESSING", "VALID"] });
    const slept: number[] = [];
    const report = await submitToReview(client, {
      ...OPTIONS,
      intervalMs: 1000,
      sleep: (ms) => {
        slept.push(ms);
        return Promise.resolve();
      },
    });

    expect(slept).toEqual([1000, 1000]);
    expect(report.failed).toBe(false);
  });

  test("refuses a build with no export compliance answer instead of declaring one", async () => {
    const { client, state } = fakeAsc({ encryption: null });
    const failure = await rejection(submitToReview(client, OPTIONS));

    expect(failure?.message).toMatch(/no export compliance answer.*ITSAppUsesNonExemptEncryption/s);
    expect(state.calls).not.toContain("POST /v1/appStoreVersions");
  });

  test("refuses an expired build", async () => {
    const { client } = fakeAsc({ expired: true });
    const failure = await rejection(submitToReview(client, OPTIONS));
    expect(failure?.message).toMatch(/has expired/);
  });

  test("names the bundle ID when the key sees no app", async () => {
    const { client } = fakeAsc({ app: false });
    const failure = await rejection(submitToReview(client, OPTIONS));
    expect(failure?.message).toMatch(/com\.jxsuite\.studio/);
  });
});

describe("waitForBuild", () => {
  test("fails on a build Apple rejected", async () => {
    const { client } = fakeAsc({ buildStates: ["INVALID"] });
    const failure = await rejection(waitForBuild(client, "app1", OPTIONS));
    expect(failure?.message).toMatch(/is INVALID/);
  });

  test("gives up when the build never processes", async () => {
    const { client } = fakeAsc({ buildStates: ["PROCESSING"] });
    const failure = await rejection(
      waitForBuild(client, "app1", { ...OPTIONS, intervalMs: 1000, timeoutMs: 3000 }),
    );
    expect(failure?.message).toMatch(/still not processed after/);
  });
});

describe("parseArgs", () => {
  test("takes the build number and defaults to a manual release", () => {
    expect(parseArgs(["--build", "500"])).toEqual({
      buildNumber: "500",
      releaseType: "MANUAL",
      version: null,
      whatsNew: "Bug fixes and improvements.",
    });
  });

  test("takes every option", () => {
    expect(
      parseArgs([
        "--build",
        "7",
        "--version",
        "1.2.3",
        "--release-type",
        "AFTER_APPROVAL",
        "--whats-new",
        "Hi",
      ]),
    ).toEqual({
      buildNumber: "7",
      releaseType: "AFTER_APPROVAL",
      version: "1.2.3",
      whatsNew: "Hi",
    });
  });

  test.each([
    [[], /--build <number> is required/],
    [["--build", "x"], /--build <number> is required/],
    [["--build"], /--build needs a value/],
    [["--build", "1", "--release-type", "NOW"], /MANUAL or AFTER_APPROVAL/],
    [["--build", "1", "--bogus", "x"], /Unknown option: --bogus/],
  ])("rejects %j", (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });
});

describe("the client", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const now = new Date("2026-11-13T12:00:00Z");
  const credentials = { issuerId: "issuer", keyId: "KEY", privateKey: pem };
  const answering =
    (response: () => Response): AscFetch =>
    () =>
      Promise.resolve(response());

  test("signs an ES256 token the public key verifies, valid for ten minutes", () => {
    const token = createToken({ ...credentials, now });
    const [header = "", claims = "", signature = ""] = token.split(".");

    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "ES256",
      kid: "KEY",
      typ: "JWT",
    });
    const decoded = JSON.parse(Buffer.from(claims, "base64url").toString());
    expect(decoded).toEqual({
      aud: "appstoreconnect-v1",
      exp: decoded.iat + 600,
      iat: Math.floor(now.getTime() / 1000),
      iss: "issuer",
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${claims}`),
        { dsaEncoding: "ieee-p1363", key: publicKey },
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
  });

  test("sends the token and the body, and reads the JSON back", async () => {
    const seen: { init: RequestInit; url: string }[] = [];
    const client = createClient({
      ...credentials,
      fetch: (url, init) => {
        seen.push({ init, url });
        return Promise.resolve(Response.json({ data: [] }));
      },
      now: () => now,
    });

    const result = await client.request("POST", "/v1/reviewSubmissions", {
      data: { type: "reviewSubmissions" },
    });

    expect(result).toEqual({ data: [] });
    expect(seen[0]?.url).toBe(`${API_ORIGIN}/v1/reviewSubmissions`);
    const headers = new Headers(seen[0]?.init.headers);
    expect(headers.get("authorization")).toStartWith("Bearer ");
    expect(headers.get("content-type")).toBe("application/json");
    expect(seen[0]?.init.body).toBe('{"data":{"type":"reviewSubmissions"}}');
  });

  test("reads an empty 204 as an empty document", async () => {
    const client = createClient({
      ...credentials,
      fetch: answering(() => new Response(null, { status: 204 })),
    });
    expect(await client.request("PATCH", "/v1/x")).toEqual({});
  });

  test("turns Apple's error document into the message, so the missing item is named", async () => {
    const client = createClient({
      ...credentials,
      fetch: answering(() =>
        Response.json(
          {
            errors: [
              { detail: "You must provide a description.", title: "Bad" },
              { title: "Second" },
            ],
          },
          { status: 409 },
        ),
      ),
    });

    const failure = await rejection(client.request("POST", "/v1/reviewSubmissions"));

    expect(failure).toBeInstanceOf(AscError);
    expect(failure instanceof AscError && failure.status).toBe(409);
    expect(failure?.message).toBe(
      "POST /v1/reviewSubmissions -> 409: You must provide a description.; Second",
    );
  });

  test("falls back to the raw body when it is not JSON", async () => {
    const client = createClient({
      ...credentials,
      fetch: answering(() => new Response("gateway down", { status: 502 })),
    });
    const failure = await rejection(client.request("GET", "/v1/apps"));
    expect(failure?.message).toBe("GET /v1/apps -> 502: gateway down");
  });
});
