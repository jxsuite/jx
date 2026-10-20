// oxlint-disable typescript/await-thenable -- bun test .resolves/.rejects matchers are typed `void` but return real Promises at runtime; the await is required.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { JsonValue } from "@jxsuite/schema/types";

// ─── Configurable fake D-Bus session bus ───────────────────────────────────
//
// `openFileDialog` talks to the freedesktop FileChooser portal over D-Bus.
// We mock `dbus-ts` so each test can script the portal's behavior: what
// OpenFile returns, and how the Request object fires its "Response" event.

/** One `a{sv}` option the module passes to OpenFile: `[key, [signature, value]]`. */
type PortalOption = [string, [string, JsonValue]];

/** A Response's `results` as a test fires it: the raw `a{sv}` list, or a decoded `{ uris }` map. */
type PortalResults = [string, [string, string[]]][] | { uris?: string[] };

type ResponseHandler = (response: number, results: PortalResults) => void;

/** The arguments of the most recent OpenFile call, by parameter name. */
interface OpenFileCall {
  parent: string;
  title: string;
  options: PortalOption[];
}

interface FakeConfig {
  openFileError?: Error;
  openFileHandle?: string;
  respond?: (fire: ResponseHandler) => void;
}

let config: FakeConfig = {};
let endCalls = 0;
let openFileCall: OpenFileCall | null = null;
let requestPath: string | null = null;

const fakeBus = {
  connection: {
    end: () => {
      endCalls += 1;
    },
  },
  getInterface: (_service: string, path: string, iface: string) => {
    if (iface === "org.freedesktop.portal.FileChooser") {
      return Promise.resolve({
        OpenFile: (parent: string, title: string, options: PortalOption[]) => {
          openFileCall = { options, parent, title };
          if (config.openFileError) {
            return Promise.reject(config.openFileError);
          }
          return Promise.resolve([config.openFileHandle ?? "/org/fdo/portal/request/1"]);
        },
      });
    }
    // Org.freedesktop.portal.Request
    requestPath = path;
    return Promise.resolve({
      on: (event: string, handler: ResponseHandler) => {
        if (event === "Response") {
          config.respond?.(handler);
        }
      },
    });
  },
};

void mock.module("dbus-ts", () => ({
  sessionBus: () => Promise.resolve(fakeBus),
}));

const { openFileDialog, openDirectoryDialog } = await import("../src/chromium/utils");

/** The arguments the module last passed to OpenFile, failing the test when it never called it. */
function lastOpenFile(): OpenFileCall {
  if (!openFileCall) {
    throw new Error("OpenFile was never called");
  }
  return openFileCall;
}

beforeEach(() => {
  config = {};
  endCalls = 0;
  openFileCall = null;
  requestPath = null;
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("openFileDialog (chromium / D-Bus portal)", () => {
  test("resolves the selected file path from nested array response format", async () => {
    config.respond = (fire) => {
      fire(0, [["uris", ["as", ["file:///home/user/projects/site/project.json"]]]]);
    };
    const result = await openFileDialog(undefined, "linux");
    expect(result).toBe("/home/user/projects/site/project.json");
  });

  test("resolves the selected file path from object response format", async () => {
    config.respond = (fire) => {
      fire(0, { uris: ["file:///tmp/demo/project.json"] });
    };
    const result = await openFileDialog(undefined, "linux");
    expect(result).toBe("/tmp/demo/project.json");
  });

  test("passes title, modal options and a handle token to OpenFile", async () => {
    config.respond = (fire) => fire(0, { uris: ["file:///a/b.json"] });
    await openFileDialog(undefined, "linux");
    const { parent, title, options } = lastOpenFile();
    expect(parent).toBe("");
    expect(title).toBe("Open project.json");
    const keys = options.map(([key]) => key);
    expect(keys).toEqual(["directory", "modal", "handle_token", "filters"]);
    const tokenEntry = options.find(([key]) => key === "handle_token");
    expect(tokenEntry?.[1][0]).toBe("s");
    expect(String(tokenEntry?.[1][1])).toStartWith("bun_");
  });

  test("listens on the Request object at the handle returned by OpenFile", async () => {
    config.openFileHandle = "/org/fdo/portal/request/custom_42";
    config.respond = (fire) => fire(0, { uris: ["file:///a/b.json"] });
    await openFileDialog(undefined, "linux");
    expect(requestPath).toBe("/org/fdo/portal/request/custom_42");
  });

  test("returns null when the user cancels (non-zero response code)", async () => {
    config.respond = (fire) => fire(1, { uris: ["file:///ignored.json"] });
    const result = await openFileDialog(undefined, "linux");
    expect(result).toBeNull();
  });

  test("returns null when the response contains no uris", async () => {
    config.respond = (fire) => fire(0, { uris: [] });
    const result = await openFileDialog(undefined, "linux");
    expect(result).toBeNull();
  });

  test("returns null when the response results are an empty object", async () => {
    config.respond = (fire) => fire(0, {});
    const result = await openFileDialog(undefined, "linux");
    expect(result).toBeNull();
  });

  test("returns null when the uri is not a parseable URL", async () => {
    config.respond = (fire) => fire(0, { uris: ["not a valid url"] });
    const result = await openFileDialog(undefined, "linux");
    expect(result).toBeNull();
  });

  test("closes the bus connection after a successful selection", async () => {
    config.respond = (fire) => fire(0, { uris: ["file:///x/y.json"] });
    await openFileDialog(undefined, "linux");
    expect(endCalls).toBe(1);
  });

  test("closes the bus connection even when OpenFile fails", async () => {
    config.openFileError = new Error("portal unavailable");
    await expect(openFileDialog(undefined, "linux")).rejects.toThrow("portal unavailable");
    expect(endCalls).toBe(1);
  });

  test("fires asynchronously after registration still resolves the path", async () => {
    config.respond = (fire) => {
      setTimeout(() => fire(0, { uris: ["file:///delayed/project.json"] }), 5);
    };
    const result = await openFileDialog(undefined, "linux");
    expect(result).toBe("/delayed/project.json");
  });

  test("resolves null via the cancel timeout when the portal never responds", async () => {
    // Config.respond stays unset: the Request registers its handler but "Response" never fires,
    // So only the cancel timeout (shortened from its 60s default) can settle the promise.
    const result = await openFileDialog(5, "linux");
    expect(result).toBeNull();
    expect(endCalls).toBe(1);
  });
});

describe("openDirectoryDialog (chromium / D-Bus portal)", () => {
  test("resolves the chosen folder path", async () => {
    config.respond = (fire) => fire(0, { uris: ["file:///home/user/projects"] });
    const result = await openDirectoryDialog("linux");
    expect(result).toBe("/home/user/projects");
  });

  test("requests a directory and omits the *.json filter", async () => {
    config.respond = (fire) => fire(0, { uris: ["file:///home/user/x"] });
    await openDirectoryDialog("linux");
    const { title, options } = lastOpenFile();
    expect(title).toBe("Choose a folder for your new project");
    const directoryEntry = options.find(([key]) => key === "directory");
    expect(directoryEntry?.[1][1]).toBe(true);
    expect(options.map(([key]) => key)).not.toContain("filters");
  });

  test("returns null when the user cancels", async () => {
    config.respond = (fire) => fire(1, {});
    expect(await openDirectoryDialog("linux")).toBeNull();
  });
});
